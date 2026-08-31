---
title: MySQL count(*) 为什么慢：实现原理与计数方案
date: 2026-08-31
description: 从 MVCC、索引扫描到业务计数器，理解 InnoDB 统计行数的成本与设计选择
domain: database
tags: [mysql, 数据库]
status: growing
draft: false
subcategory: backend
term: database
order: 15
---

统计一张表有多少行，看上去只是一个简单问题：

```sql
SELECT COUNT(*) FROM operation_log;
```

但随着数据量增长，这条 SQL 的耗时通常也会增长。为什么 InnoDB 不直接保存一个表的总行数？为什么 `SHOW TABLE STATUS` 能很快返回 `Rows`，却不能替代 `COUNT(*)`？当业务页面频繁需要“总数 + 最新记录”时，应该使用 Redis、数据库计数表，还是每次现场统计？

这些问题背后涉及存储引擎、MVCC、索引组织、事务一致性和并发热点。本文从 `COUNT()` 的语义开始，逐层梳理执行原理与业务设计方案。

## 先弄清楚 COUNT 的语义

`COUNT()` 是聚合函数，但不同参数表达的含义并不完全相同。

| 写法 | 统计含义 | 是否忽略 NULL |
| --- | --- | --- |
| `COUNT(*)` | 结果集中的行数 | 不涉及字段判空，所有行都计数 |
| `COUNT(1)` | 常量 `1` 非 NULL 的行数 | 所有行都计数 |
| `COUNT(primary_key)` | 主键值非 NULL 的行数 | 主键不允许 NULL，因此通常等价于总行数 |
| `COUNT(column)` | 指定字段非 NULL 的行数 | 忽略该字段为 NULL 的行 |
| `COUNT(DISTINCT column)` | 指定字段非 NULL 的不同值数量 | 忽略 NULL，并执行去重 |

如果目标就是统计符合条件的记录总数，最清晰的写法是：

```sql
SELECT COUNT(*) FROM t WHERE status = 'SUCCESS';
```

不要为了所谓的“避免读取所有列”而改成 `COUNT(id)`。`COUNT(*)` 并不会真的把每行的所有字段取出来，它在 MySQL 中有专门的计数语义。`COUNT(column)` 则应当只在业务确实需要统计非 NULL 值时使用。

## 不同存储引擎为什么表现不同

### MyISAM 可以保存精确总行数

对于没有 `WHERE` 条件的 `COUNT(*)`，MyISAM 可以直接利用表元数据中维护的行数，因此返回很快。

但这个优势有明确边界：

- 加上过滤条件后，仍要根据条件寻找并统计记录；
- MyISAM 不具备 InnoDB 的事务、行级并发控制和崩溃恢复能力；
- 不能为了一个无条件计数查询，就放弃业务表所需的事务安全。

### InnoDB 不能只维护一个全局精确数字

InnoDB 支持事务和 MVCC。同一时刻，不同事务可能拥有不同的 Read View，因此“这张表有多少行”并不是实例级别唯一的答案，而是**相对于当前事务可见性**的答案。

假设表中原本有 10000 行：

1. 事务 A 建立一致性快照；
2. 事务 B 插入一行但尚未提交；
3. 事务 C 插入一行并提交；
4. A、B、C 分别执行 `COUNT(*)`。

三个会话可能得到不同结果：

- A 的旧快照可能仍然只能看到 10000 行；
- B 能看到自己尚未提交的插入；
- 新启动的一致性读可以看到 C 已提交的记录。

如果 InnoDB 只保存一个全局行数，它无法同时回答这些基于不同快照的查询。因此，InnoDB 不维护可以直接返回给所有事务的精确表行数，而是在执行 `COUNT(*)` 时判断索引记录对当前事务是否可见。

这也是事务能力带来的成本：计数结果是准确的，但准确性建立在逐条判断可见版本之上。

有关 Read View 和可见性规则，可以结合站内文章 [《事务隔离和MVCC》](/knowledge/backend/database/事务隔离和mvcc/) 阅读。

## InnoDB 怎样执行无条件 COUNT(*)

InnoDB 是索引组织表：

- 聚簇索引叶子节点保存完整行数据；
- 普通二级索引叶子节点主要保存索引列和主键值；
- 二级索引通常比聚簇索引占用更少页面。

对于不带 `WHERE`、`GROUP BY` 等附加子句的：

```sql
SELECT COUNT(*) FROM t;
```

MySQL 会优先遍历最小的可用二级索引；如果没有二级索引，才扫描聚簇索引。因为无论遍历哪一棵完整索引树，逻辑上都能覆盖表中所有记录，选择更小的树可以减少读取的数据页。

这里的“优化”仍然没有把 O(n) 变成 O(1)。随着可见记录和索引页增多，扫描成本依然会上升。实际耗时还受到以下因素影响：

- 目标索引有多少页面；
- 页面是否已经位于 Buffer Pool；
- 存储设备的随机与顺序读取能力；
- 当前系统是否存在 I/O 竞争；
- undo 版本链长度和可见性判断成本；
- 并发查询与后台任务造成的资源争用。

第一次执行明显慢、随后执行变快，常见原因是索引页从磁盘读入了 Buffer Pool。第二次查询可以直接命中内存，但这不代表计数已经变成了读取某个缓存数字。

### 不要为了 COUNT(*) 盲目创建索引

额外创建一个很窄的二级索引，可能让全表计数扫描更少页面，但索引会增加：

- 磁盘空间；
- 插入、删除和更新的维护成本；
- redo log、binlog 和复制流量；
- Buffer Pool 占用；
- DDL 的执行与运维风险。

只有当精确全表计数非常频繁、评估后收益明确，并且该索引还能服务其他查询时，才值得考虑。多数业务更应该减少实时全表计数次数，或者重新设计计数方式。

## SHOW TABLE STATUS 为什么快但不准确

下面的命令也会返回一个 `Rows` 值：

```sql
SHOW TABLE STATUS LIKE 'operation_log';
```

对于 InnoDB，这个值来自统计信息，是优化器使用的粗略估算，并不是基于当前事务 Read View 逐行计算出的精确结果。它适合：

- 判断表的大致规模；
- 监控容量变化趋势；
- 对精度要求不高的运维展示。

它不适合：

- 余额、库存、配额等正确性判断；
- 分页总数等用户可感知的精确结果；
- 需要与当前事务内其他查询保持一致的业务逻辑。

因此，`SHOW TABLE STATUS` 与 `COUNT(*)` 不是快慢不同的同一种答案，而是**近似统计**与**事务可见精确统计**两种不同产品。

## COUNT(*)、COUNT(1) 和 COUNT(主键) 怎么选

早期经验经常给出类似下面的细微性能排序：

```
COUNT(column) < COUNT(primary_key) < COUNT(1) ≈ COUNT(*)
```

这个结论可以帮助理解引擎是否需要取字段值以及是否需要判断 NULL，但不应当被当成跨版本、跨数据分布都成立的性能定律。优化器、执行器实现、索引选择和缓存状态都会影响实际结果，而 `COUNT(1)` 与 `COUNT(*)` 的微小差异通常不是性能问题的主要矛盾。

更实用的选择规则是：

- 统计行数：使用 `COUNT(*)`；
- 统计某字段非 NULL 的记录数：使用 `COUNT(column)`；
- 统计不同值数量：使用 `COUNT(DISTINCT column)`；
- 性能问题：检查扫描范围、访问索引和业务调用频率，而不是反复替换 `COUNT(*)` 与 `COUNT(1)`。

带有过滤条件时，优化重点通常是为过滤条件设计合适索引：

```sql
SELECT COUNT(*)
FROM orders
WHERE tenant_id = 1001
  AND status = 'PAID';
```

此时 `(tenant_id, status)` 等符合查询模式的联合索引，通常比纠结 `COUNT(*)` 还是 `COUNT(1)` 更有价值。仍然需要用 `EXPLAIN` 检查实际访问路径，并评估符合条件的记录数量。

## 方案一：把计数放在 Redis

当业务需要高频读取总数时，一个直观方案是在 Redis 中保存计数器：

```
插入业务记录 -> INCR counter
删除业务记录 -> DECR counter
读取总数     -> GET counter
```

它的读写速度快，也能显著减轻数据库扫描压力，但默认只能提供最终一致性。

### 崩溃与更新丢失

数据库写入成功后，如果 Redis 更新尚未完成或尚未持久化，缓存异常可能造成计数落后。可以通过重放消息、CDC 或定期执行真实统计来校准，但在校准完成前，数值并不精确。

### 双写顺序解决不了原子性

先写 MySQL 再更新 Redis，存在“数据已经可见、计数还没更新”的窗口；先更新 Redis 再写 MySQL，则存在“计数已经增加、数据还没写入或最终回滚”的窗口。

简单交换顺序无法消除这个问题，因为 MySQL 与 Redis 不在同一个本地事务中。要获得更可靠的最终一致性，可以使用：

- 本地消息表或 Transactional Outbox；
- 基于 binlog 的 CDC；
- 可重试且幂等的事件消费者；
- 定期对账与自动修复；
- 为计数记录版本、更新时间和数据来源。

即使消息绝不丢失，异步处理仍然存在传播延迟。因此 Redis 适合“允许短暂偏差、读取非常频繁”的场景，而不是要求与业务记录处于同一事务快照的精确计数。

## 方案二：在 MySQL 中维护计数表

如果业务需要精确计数，可以在 MySQL 中创建单独的计数表：

```sql
CREATE TABLE business_counter (
  counter_key VARCHAR(128) NOT NULL,
  counter_value BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL
    DEFAULT CURRENT_TIMESTAMP
    ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (counter_key)
) ENGINE = InnoDB;
```

插入业务记录和增加计数必须位于同一个事务：

```sql
START TRANSACTION;

INSERT INTO operation_log(user_id, action, created_at)
VALUES (1001, 'PAY', NOW());

INSERT INTO business_counter(counter_key, counter_value)
VALUES ('operation_log:total', 1)
ON DUPLICATE KEY UPDATE counter_value = counter_value + 1;

COMMIT;
```

删除记录时，也要在同一事务中减少计数。这样可以利用 InnoDB 的原子性保证：业务记录和计数要么一起提交，要么一起回滚；其他事务不会看到只完成一半的中间状态。

### 写入原子并不等于多次读取一定一致

计数表方案经常被忽略的一个边界是：如果页面先查询计数，再用另一个 autocommit 语句查询最新 100 条记录，两次查询之间仍可能有新事务提交。页面看到的两个结果可能来自不同时间点。

如果业务要求它们严格对应同一个快照，可以在默认 `REPEATABLE READ` 隔离级别下使用只读一致性事务：

```sql
START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY;

SELECT counter_value
FROM business_counter
WHERE counter_key = 'operation_log:total';

SELECT id, user_id, action, created_at
FROM operation_log
ORDER BY id DESC
LIMIT 100;

COMMIT;
```

在同一个 RR 事务中，普通一致性读复用同一 Read View，计数和记录才能基于同一个数据库快照。若使用 `READ COMMITTED`，每条一致性读会建立新的快照，仍需根据业务要求评估结果是否可接受。

## 计数表的热点行问题

计数表把 O(n) 的实时扫描转化成 O(1) 的读取，但代价是每次写入都要更新同一行。高并发时，这一行会成为锁竞争热点。

### 尽量最后更新计数

如果事务中既要插入业务记录，又要更新公共计数行，通常可以先完成互不冲突的业务记录插入，再更新计数：

```
插入业务记录 -> 更新公共计数行 -> COMMIT
```

计数行从被更新到事务提交之间的时间更短，可以减少其他事务等待这把行锁的时长。事务原子性不受语句顺序影响，但锁持有时间和并发吞吐会受影响。

### 将一个计数拆成多个分片

写入量很大时，可以把一个逻辑计数拆成多个 bucket：

```sql
CREATE TABLE sharded_counter (
  counter_key VARCHAR(128) NOT NULL,
  bucket_id INT NOT NULL,
  counter_value BIGINT NOT NULL,
  PRIMARY KEY (counter_key, bucket_id)
) ENGINE = InnoDB;
```

写入时按照主键哈希或随机方式选择 bucket，读取时求和：

```sql
SELECT SUM(counter_value)
FROM sharded_counter
WHERE counter_key = 'operation_log:total';
```

这种设计用更高的读取成本换取更低的写锁冲突。bucket 数量不宜无限增加，还要处理初始化、删除扣减、对账与扩容规则。

### 按业务维度拆分计数

如果查询本来就按租户、日期或状态统计，可以直接维护更细粒度的计数：

```
orders:tenant:1001:status:PAID
orders:date:2026-08-31
```

这既能降低单行热点，也能服务带条件计数。但维度组合越多，写放大和维护复杂度越高，不能为每种临时查询都预建计数。

## 不同业务应该选择哪种方案

| 业务需求 | 推荐方案 | 一致性与成本 |
| --- | --- | --- |
| 偶尔查询精确总数 | 直接 `COUNT(*)` | 精确，查询成本随数据量增长 |
| 高频查询精确总数，写入量适中 | MySQL 计数表，同事务更新 | 强一致，可能产生热点行 |
| 高频写入且允许短暂误差 | Redis、消息或 CDC 更新计数 | 读取快，最终一致，需要对账 |
| 只需要容量趋势 | `SHOW TABLE STATUS` 或监控指标 | 快速但近似 |
| 按固定维度频繁统计 | 汇总表、分桶计数 | 读快，但增加写放大与维护成本 |
| 分页只需判断是否还有下一页 | 多取一条或游标分页 | 避免计算完整总数 |

很多产品页面并不真正需要精确总页数。把“共 1032847 条”改成“查看更多”，使用基于游标的分页并多取一条判断 `has_more`，往往比维护复杂计数系统更简单可靠。

## 排查 COUNT(*) 慢的步骤

遇到计数查询变慢时，可以依次检查：

1. **确认语义**：需要精确值、近似值，还是只需判断是否存在更多记录；
2. **查看条件**：无条件全表计数，还是带 `WHERE`、`JOIN`、`GROUP BY`；
3. **检查执行计划**：确认扫描的索引、估算行数和过滤比例；
4. **观察真实扫描量**：查看慢日志或 Performance Schema 的扫描行数；
5. **判断冷热状态**：对比 Buffer Pool 命中与磁盘 I/O；
6. **评估调用频率**：单次 100ms 每分钟执行一次，和每秒执行 1000 次是完全不同的问题；
7. **检查事务版本负担**：关注长事务、undo 历史和 purge 延迟；
8. **选择业务方案**：优化索引、减少频率、接受近似或维护计数器。

不要只在数据库内部寻找答案。一个慢计数真正需要解决的问题，可能是产品根本不需要精确总数，或者应用在每次刷新、每个分页请求中重复执行了同一条全表统计。

## 小结

- `COUNT(*)` 统计结果集行数，`COUNT(column)` 只统计该字段非 NULL 的记录；
- InnoDB 因为 MVCC 无法维护适用于所有事务的唯一精确行数；
- 无条件 `COUNT(*)` 会遍历最小可用二级索引，没有二级索引时扫描聚簇索引；
- `SHOW TABLE STATUS` 返回的是近似行数，不能替代事务可见的精确统计；
- 统计行数时优先写 `COUNT(*)`，不要把微小语法差异当作主要优化方向；
- Redis 计数读取快，但跨系统双写默认只能做到最终一致，需要消息、重试和对账；
- MySQL 计数表可以与业务记录在同一事务中原子更新，但可能产生热点行；
- 页面同时读取计数和明细时，若要求严格一致，还要让两次读取共享同一快照；
- 高并发下可以缩短计数行锁持有时间、分桶或按业务维度拆分计数；
- 最有效的优化有时是取消不必要的精确总数，而不是让全表扫描再快一点。

## 参考资料

- [极客时间《MySQL 实战 45 讲》：count(*) 这么慢，我该怎么办？](https://time.geekbang.com/column/article/72775)
- [MySQL 8.4：Aggregate Function Descriptions](https://dev.mysql.com/doc/refman/8.4/en/aggregate-functions.html)
- [MySQL 8.4：SHOW TABLE STATUS](https://dev.mysql.com/doc/refman/8.4/en/show-table-status.html)
- [MySQL 8.4：Consistent Nonlocking Reads](https://dev.mysql.com/doc/refman/8.4/en/innodb-consistent-read.html)
- [MySQL 8.4：START TRANSACTION、COMMIT 和 ROLLBACK](https://dev.mysql.com/doc/refman/8.4/en/commit.html)
