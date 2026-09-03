---
title: redo log、binlog及两阶段提交
date: 2026-08-26
updated: 2026-09-03
description: 理解 MySQL 日志系统以及两阶段提交如何保证数据一致性
domain: database
tags: [mysql, 数据库]
status: growing
draft: false
subcategory: backend
term: database
order: 3
---

一次 MySQL 更新并不是“改完数据页就结束”。以 InnoDB 为例，执行器找到记录后，会先在缓冲池中修改数据页，再通过日志把这次修改可靠地记录下来。这里同时出现了两个日志：InnoDB 引擎层的 `redo log`，以及 Server 层的 `binlog`。

两者各自解决不同问题，又必须对同一事务保持一致；两阶段提交负责解决一致性，组提交则负责降低大量事务同时提交时的 I/O 成本。

## redo log：让数据页可以延迟落盘

InnoDB 采用 WAL（Write-Ahead Logging，预写日志）思想。更新数据时，先在 Buffer Pool 中修改数据页，并追加记录本次修改的 redo log；脏页可以稍后再由后台线程刷入数据文件。这样，事务提交不必等待每个随机数据页都完成落盘，磁盘写入也更容易批量化、顺序化。

redo log 是面向崩溃恢复的引擎日志。它记录的是足以重做页面修改的信息，并使用不断递增的 LSN（Log Sequence Number，日志序列号）标识位置。日志写入位置不能无限追上 checkpoint：checkpoint 之前的数据页已经刷入磁盘，对应的旧日志才可以被回收；如果 redo log 空间被耗尽，更新就必须等待刷脏页推进 checkpoint。

较早版本通常通过一组固定大小的 redo log 文件组成循环空间；较新的 MySQL 版本使用 `innodb_redo_log_capacity` 统一配置 redo 容量。增大容量可以减少高峰期因日志空间不足而被迫刷脏页的概率，但不能替代合理的磁盘、Buffer Pool 和刷脏页配置。

### 提交时 redo log 是否真正落盘

`innodb_flush_log_at_trx_commit` 控制提交时 redo log 的刷盘行为：

| 值 | 行为概览 | 取舍 |
| --- | --- | --- |
| `1` | 每次提交都写入并 `fsync` redo log | 持久性最强，提交成本最高 |
| `2` | 每次提交写入操作系统缓存，由后台线程定期 `fsync` | 数据库进程崩溃通常可恢复，操作系统崩溃可能丢失最近事务 |
| `0` | 提交时不主动写入，由后台线程定期写入并刷盘 | 性能较好，但故障窗口最大 |

这里要区分“写入”和“持久化”：`write` 可能只把数据交给操作系统页缓存，`fsync` 才是要求操作系统把内容提交到稳定存储介质。生产环境若优先保证已提交事务不丢失，通常选择 `1`，并使用有断电保护的存储设备。

## binlog：Server 层的逻辑归档

binlog 是 MySQL Server 层的归档日志，主要用于主从复制、按时间点恢复和审计。它以逻辑事件记录事务，例如行变更、语句事件以及事务边界；复制线程读取源库的 binlog，再在副本上重放这些事件。

事务执行期间，binlog 内容通常先进入当前线程的事务缓存；事务提交时，Server 层将缓存内容写入 binlog 文件并按配置刷盘。`sync_binlog=1` 表示每次事务提交都要求 binlog 同步到磁盘，持久性最好但 I/O 次数最多；更大的值或 `0` 可以降低刷盘频率，却会扩大异常宕机时可能丢失的 binlog 范围。

redo log 面向 InnoDB 的物理恢复，binlog 面向 Server 层的逻辑复制与归档。只依赖其中一个都不够：redo log 不能直接替代跨引擎、跨实例的复制日志，binlog 也不能代替 InnoDB 在崩溃后快速恢复未落盘数据页的能力。

## 为什么需要两阶段提交

如果先让 redo log 完成提交，再写 binlog，写 binlog 前宕机会出现“源库已经有修改、binlog 却没有该事务”的情况，副本和按 binlog 恢复的数据库会缺少这次修改。反过来，如果先写完 binlog，随后 redo log 没有提交，源库恢复后可能回滚，但副本已经重放了这次修改，结果同样不一致。

因此，Server 层和 InnoDB 通过 XID（事务标识）把同一个事务关联起来，采用以下顺序：

```text
执行器调用 InnoDB 修改数据页
        │
        ├─ 写 undo log，便于回滚和 MVCC
        ├─ 写 redo log，并将事务标记为 PREPARE
        │
        ├─ Server 层写入 binlog，并按配置刷盘
        │
        └─ InnoDB 将 redo log 标记为 COMMIT
                 │
              返回客户端
```

PREPARE 表示引擎已经做好提交准备，但最终提交要等 Server 层确认 binlog 已经完成。发生崩溃后，InnoDB 会检查处于 PREPARE 状态的事务：如果能在 binlog 中找到同一 XID 的完整事务，就继续提交；如果 binlog 中没有完整记录，就回滚。这样，redo log 和 binlog 对事务是否成功的判断就能保持一致。

## 组提交：把多次 fsync 合并成一次

`fsync` 往往比普通内存操作昂贵。高并发下，如果每个事务都独占一次 redo log 和 binlog 的刷盘，吞吐量很容易被磁盘 I/O 限制。组提交（group commit）会把同一时间窗口内处于提交阶段的多个事务组织成一组，统一写入并刷盘。

例如三个事务已经分别写到 LSN 50、120 和 160：

```text
事务 1：PREPARE，LSN=50  ┐
事务 2：PREPARE，LSN=120 ├─ 选出一个 leader，合并写入
事务 3：PREPARE，LSN=160 ┘
                         │
                  一次 fsync 到 LSN=160
                         │
                 三个事务分别完成 COMMIT
```

组提交的关键不是让事务共享数据，而是让多个事务共享一次昂贵的持久化操作。MySQL 5.6 开始支持 binary log group commit；后续版本进一步将提交过程拆成 flush、sync、commit 等阶段，使 binlog 和 redo log 的提交能够更好地协同。组提交通常提高整体吞吐量，但事务可能需要短暂等待同组事务，因而会引入少量提交延迟。

### 组提交相关参数

`binlog_group_commit_sync_delay` 可以让 Server 在 binlog sync 阶段等待一小段微秒数，以收集更多事务；`binlog_group_commit_sync_no_delay_count` 可以设置达到多少个事务后不再等待。它们适合在并发较高、fsync 成本明显的场景中压测调优。等待时间过长会直接增加提交延迟，低并发业务反而可能变慢，不能脱离实际负载照搬参数。

## 生产环境的配置与排查思路

如果目标是优先保证事务持久性，可以从以下组合开始评估：

```ini
innodb_flush_log_at_trx_commit = 1
sync_binlog = 1
```

随后根据监控和压测结果检查：

1. redo 写入位置与 checkpoint 的距离是否经常接近容量上限；
2. binlog、redo log 的 `fsync` 延迟和磁盘队列是否成为瓶颈；
3. 组提交是否确实形成了较大的提交批次；
4. 增大 redo 容量或 log buffer 后，是否只是把压力推迟到了刷脏页阶段；
5. 主库和副本的日志保留、传输、落盘策略是否满足恢复目标。

不要为了追求短期吞吐量而随意关闭 redo 或把两个刷盘参数设为非持久模式。应先明确 RPO（允许丢失多少数据）和故障模型，再用压测验证吞吐、P99 延迟以及宕机恢复结果。

## 小结

- redo log 让数据页可以延迟刷盘，并负责 InnoDB 崩溃恢复。
- binlog 保存 Server 层的逻辑变更，服务于复制和数据恢复。
- 两阶段提交用 PREPARE、binlog、COMMIT 的顺序，避免两份日志对同一事务产生分歧。
- 组提交把多个事务的刷盘操作合并，减少 `fsync` 次数，提高高并发吞吐。
- 持久性参数必须结合存储设备和业务 RPO 调整，不能只看单次 SQL 的执行速度。

## 参考资料

- [当前页面：redo log 与组提交相关内容](https://time.geekbang.com/column/article/76161)
- [MySQL 8.4 Redo Log](https://dev.mysql.com/doc/refman/8.4/en/innodb-redo-log.html)
- [MySQL 8.4 Binary Logging Options and Variables](https://dev.mysql.com/doc/refman/8.4/en/replication-options-binary-log.html)
- [MySQL 8.4 Optimizing InnoDB Redo Logging](https://dev.mysql.com/doc/refman/8.4/en/optimizing-innodb-logging.html)
