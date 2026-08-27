---
title: InnoDB刷脏页机制与性能优化
date: 2026-08-27
description: 理解 Buffer Pool、checkpoint、脏页淘汰及相关 I/O 参数的调优方法
domain: database
tags: [mysql, 数据库]
status: growing
draft: false
subcategory: backend
term: database
order: 12
---

InnoDB 不会在每次更新时立刻把数据页写回磁盘。它先在 Buffer Pool 中修改页面，并用 redo log 保证崩溃恢复能力，再选择合适的时机批量将修改后的数据页写入数据文件。这个过程就是通常所说的 **flush 脏页**。

这种“先写日志、延后写数据页”的策略将事务提交与数据页写盘解耦。redo log 更适合顺序写，而数据页可能分散在不同位置；延迟并合并数据页写入，可以减少前台事务等待和随机 I/O，但也要求 InnoDB 持续控制脏页数量与 checkpoint 进度。

## 什么是脏页

Buffer Pool 是 `mysqld` 服务端进程管理的一块内存区域，用来缓存 InnoDB 的数据页和索引页。页面大致可以分为三种状态：

1. **空闲页**：尚未存放有效数据，可以直接分配；
2. **干净页**：内存内容与磁盘数据文件一致，可以直接淘汰并复用；
3. **脏页**：页面已在内存中被修改，内容比磁盘版本更新，淘汰前必须先写回数据文件。

长时间运行且负载稳定的实例通常会尽量利用 Buffer Pool，完全空闲的页面可能不多，但这并不意味着 Buffer Pool 一满就要同步刷盘。后台 page cleaner 会持续把部分脏页变成干净页，为后续淘汰和 checkpoint 推进做好准备。

### 刷脏页后页面还在内存吗

“刷脏页”只表示把内存中的最新页面写入数据文件，使它从脏页变成干净页，**并不必然把页面移出 Buffer Pool**。

- 后台预刷时，页面写盘后通常仍保留在 Buffer Pool 中，可以继续命中；
- 如果刷盘是为了回收空间，页面变干净后可以被淘汰，其内存位置再分配给新页面；
- 干净页也不会立即释放，只有在需要空间且它成为淘汰候选时才会被复用。

因此，**刷盘**和**淘汰**是两个不同动作，只是在内存紧张时可能连续发生。

### 客户端内存里有什么

Buffer Pool 位于运行 MySQL Server 的服务器内存中，属于 `mysqld` 进程，不在客户端机器上。

客户端内存通常只保存连接状态、SQL 文本、协议收发缓冲区以及已经接收或正在处理的结果集。客户端不会持有可供 InnoDB 管理的数据页，也不会参与脏页刷盘。若使用 ORM 或应用缓存，客户端或应用进程可能缓存业务对象，但那与 InnoDB Buffer Pool 是两个独立层次。

## 哪些情况会触发刷脏页

### 1. redo log 空间压力推动 checkpoint

redo log 的可用容量有限。InnoDB 只有确认某段 redo 所对应的脏页已经持久化到数据文件后，才能推进 checkpoint 并安全复用更早的日志空间。

checkpoint 不是“内存中的刷盘位置”，而是一个 **LSN（Log Sequence Number，日志序列号）边界**：在该边界之前的修改已经具备从数据文件恢复的条件。当 redo 占用持续增长并逼近日志容量上限时，InnoDB 必须加快刷脏页以推进 checkpoint。

自适应刷盘的目标就是提前消化这种压力，避免日志真正耗尽。如果后台刷盘长期跟不上 redo 生成速度，前台写入会遭遇明显停顿，极端情况下更新吞吐会骤降。与其说“redo 一满立即停止所有更新”，更准确的描述是：**checkpoint 无法及时推进时，新的写入可能被迫等待日志空间**。

### 2. Buffer Pool 需要淘汰页面

当查询需要读取一个不在 Buffer Pool 中的数据页时，InnoDB 要先找到可以复用的内存页：

- 如果存在空闲页，直接使用；
- 如果淘汰候选是干净页，可以直接移出并复用；
- 如果淘汰候选是脏页，需要先完成写盘，之后才能安全复用。

InnoDB 确实使用 LRU 思路管理淘汰候选，但并不是最简单的严格 LRU。Buffer Pool 的 LRU 列表分成 young 和 old 两部分，新读入的页面从中间位置进入 old 区，以减少全表扫描把热点页面全部挤出的风险。

此外，脏页还会进入按最老修改 LSN 组织的 flush list。两套结构服务于不同目标：LRU list 主要解决内存页淘汰，flush list 主要帮助 checkpoint 按日志年龄推进。

### 3. 后台自适应及空闲刷盘

InnoDB 的 page cleaner 会在后台持续刷脏页。自适应刷盘会综合考虑 redo 生成速度、checkpoint 压力、当前脏页比例以及已配置的 I/O 能力，动态调整每秒刷页数量。

系统空闲时也可以利用剩余 I/O 能力进行刷盘，避免脏页积累到业务高峰再集中处理。MySQL 8.0.18 及以上还可以通过 `innodb_idle_flush_pct` 限制空闲期间的刷盘强度。

后台刷盘通常比前台被迫等待更平滑，但不能绝对认为它“不会影响性能”。如果参数设置过高，后台刷盘仍可能抢占前台查询所需的 I/O 带宽。

### 4. MySQL 正常关闭

正常关闭 InnoDB 时，服务端会处理内存中的脏页和相关日志，使下一次启动不必进行大量崩溃恢复。脏页越多，关闭过程可能越久。

具体行为还受 `innodb_fast_shutdown` 影响。例如使用类似崩溃关闭的快速模式时，可以跳过部分数据页刷盘，把恢复工作留到下次启动。因此，“关闭时一定刷完所有脏页”只适用于正常、非崩溃式的关闭路径，不能概括所有关闭模式。

## 为什么刷脏页会让 SQL 变慢

刷脏页本身是 InnoDB 的正常后台工作，真正影响延迟的通常是刷盘不够及时或刷盘突发：

1. Buffer Pool 没有可立即复用的页面，前台线程需要等待脏页先刷盘，查询响应时间随之增加；
2. redo 生成速度长期超过 checkpoint 推进速度，引擎被迫进行激进刷盘，甚至让写入等待日志空间；
3. 一次刷盘占用过多设备 IOPS 和带宽，与业务查询争抢存储资源；
4. 存储尾延迟较高，少量同步等待也可能放大成明显的 SQL 延迟抖动。

如果 `Innodb_buffer_pool_wait_free` 持续增加，说明 InnoDB 曾因找不到可立即使用的干净页而等待，这通常是判断 Buffer Pool 回收压力的重要信号。

## InnoDB 如何决定刷多快

可以用下面的概念模型理解自适应刷盘：

```
脏页比例 M ──> 脏页压力 F1 ──┐
                              ├─> R = max(F1, F2) ──> 目标刷盘强度
redo / checkpoint 压力 N ─> F2 ─┘
```

- 当前脏页比例越接近目标上限，`F1` 越大；
- checkpoint age 越接近可用 redo 容量，且 redo 生成越快，`F2` 越大；
- 引擎需要同时照顾两种压力，因此可将最终强度理解为取两者中更紧迫的一方。

早期资料常用 `R = max(F1, F2)`，再以 `innodb_io_capacity × R%` 描述刷盘速度。这个模型适合理解方向，但**不是当前版本实现的精确公式**。现代 InnoDB 还会考虑历史刷盘速率、redo 生成速率、低水位、`innodb_io_capacity_max` 等因素；当 checkpoint 压力很高且 `innodb_flush_sync=ON` 时，还可能突破配置的常规 I/O 上限。

## 配置 innodb_io_capacity

`innodb_io_capacity` 告诉 InnoDB：存储系统大约能为后台任务提供多少次 I/O 操作每秒。它会影响刷脏页和 change buffer merge 等后台工作。

### 什么是 IOPS

**IOPS（Input/Output Operations Per Second）**表示存储设备每秒能够完成多少次读写操作。它衡量的是操作次数，不等同于吞吐量：

- IOPS 更关注大量小块随机读写的处理能力；
- 吞吐量通常以 MB/s 或 GB/s 表示，更关注单位时间传输了多少数据；
- 延迟表示一次 I/O 从提交到完成需要多久。

数据库可能同时受 IOPS、吞吐量和尾延迟限制。例如顺序写大文件时吞吐量更重要，大量随机访问数据页时 IOPS 和延迟通常更关键。

### 如何根据服务器环境取值

官方建议将 `innodb_io_capacity` 设为存储系统大致能够提供的 IOPS，并保持在“足以让后台任务不落后”的前提下尽量合理，而不是盲目填入设备宣传的峰值。

推荐按以下步骤配置：

1. **确认真实存储边界**：云盘使用已配置或承诺的稳定 IOPS，本地盘和 RAID 使用阵列实际能力，不要只看单块盘标称值；
2. **在等价环境压测**：使用接近 InnoDB 数据页访问特征的随机读写、并发度和块大小测得可持续 IOPS；不要直接在繁忙生产数据盘上进行破坏性压力测试；
3. **为前台业务预留空间**：如果磁盘还要服务查询、binlog、redo、其他实例或操作系统，不应把全部设备 IOPS 都分给后台任务；
4. **先保守设置再观察**：关注脏页比例、checkpoint 压力、I/O 利用率、SQL 延迟和 `Innodb_buffer_pool_wait_free`，逐步调整；
5. **设置突发上限**：`innodb_io_capacity_max` 可先取 `innodb_io_capacity` 的两倍，再根据设备突发能力和业务延迟目标修正。这也是 MySQL 8.4 的默认关系。

查看当前设置：

```sql
SHOW VARIABLES WHERE Variable_name IN (
    'innodb_io_capacity',
    'innodb_io_capacity_max',
    'innodb_flush_sync'
);
```

动态调整示例：

```sql
SET GLOBAL innodb_io_capacity = 8000;
SET GLOBAL innodb_io_capacity_max = 16000;
```

示例数字不能直接照搬。以 MySQL 8.4 为例，`innodb_io_capacity` 默认值为 `10000`，而较早版本的默认值可能明显更低。升级或迁移后应先查看当前实例的实际值，再根据存储和负载校准。

一个常见诊断信号是：写入速度和 TPS 很低、脏页或 checkpoint 压力不断累积，但磁盘实际利用率和延迟仍很低。这时可以检查 `innodb_io_capacity` 是否明显低估了设备能力。不过，也要同时排除锁等待、日志刷盘延迟、CPU 瓶颈和复制限速等其他原因。

## 控制脏页比例

`innodb_max_dirty_pages_pct` 是脏页比例的目标上限，而不是直接指定每秒刷多少页。MySQL 8.4 的默认值为 `90`，旧资料中常见的 `75` 来自较早版本；具体应以目标实例为准：

```sql
SHOW VARIABLES WHERE Variable_name IN (
    'innodb_max_dirty_pages_pct',
    'innodb_max_dirty_pages_pct_lwm',
    'innodb_adaptive_flushing',
    'innodb_adaptive_flushing_lwm'
);
```

`innodb_max_dirty_pages_pct_lwm` 是预刷脏页的低水位。提前、平滑地开始刷盘，通常比等到脏页逼近上限后突发刷盘更有利于延迟稳定性。

### 查询当前脏页比例

MySQL 8.x 可以从 `performance_schema.global_status` 查询：

```sql
SELECT ROUND(
    100 * MAX(
        CASE WHEN VARIABLE_NAME = 'Innodb_buffer_pool_pages_dirty'
             THEN VARIABLE_VALUE END
    ) / NULLIF(MAX(
        CASE WHEN VARIABLE_NAME = 'Innodb_buffer_pool_pages_total'
             THEN VARIABLE_VALUE END
    ), 0),
    2
) AS dirty_page_pct
FROM performance_schema.global_status
WHERE VARIABLE_NAME IN (
    'Innodb_buffer_pool_pages_dirty',
    'Innodb_buffer_pool_pages_total'
);
```

也可以直接查看页数和字节数：

```sql
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_pages_dirty';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_pages_total';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_bytes_dirty';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_pages_flushed';
SHOW GLOBAL STATUS LIKE 'Innodb_buffer_pool_wait_free';
```

不要只盯着某个固定百分比。合理范围取决于 redo 容量、存储性能、写入速率和可接受的恢复时间；更重要的是观察比例是否长期攀升、是否伴随等待，以及业务延迟是否出现周期性尖峰。

## 是否要连带刷新邻居页

`innodb_flush_neighbors` 控制刷新一个脏页时，是否顺带刷新同一 extent 中的其他脏页：

- `0`：只刷新选中的页面，不主动寻找邻居；
- `1`：刷新同一 extent 中连续的脏页；
- `2`：刷新同一 extent 中的所有脏页。

在机械硬盘上，磁头寻道使随机 I/O 成本很高，合并相邻页面写入可能减少寻道次数，提高整体吞吐。SSD 和高性能云盘的随机 IOPS 更高，连带刷新邻居反而可能写入当前并不急需刷新的页面，扩大单次 I/O 并增加 SQL 延迟。

MySQL 8.0 和 8.4 中该参数默认值为 `0`。SSD 通常保持 `0`；机械硬盘可在真实负载下对比 `1` 或 `2`，但不应只凭设备类型直接修改生产参数。

```sql
SHOW VARIABLES LIKE 'innodb_flush_neighbors';
```

## 排查清单

当写入慢、TPS 低或 SQL 延迟周期性抖动时，可以依次检查：

1. 脏页比例是否持续上升并接近目标上限；
2. `Innodb_buffer_pool_wait_free` 是否增长；
3. checkpoint 与当前 LSN 的距离是否持续扩大；
4. 存储设备的 IOPS、吞吐量、平均延迟和高分位延迟是否达到瓶颈；
5. `innodb_io_capacity` 是否与实际可用 IOPS 匹配；
6. `innodb_io_capacity_max` 是否允许引擎应对短时写入突发；
7. redo 容量是否与峰值写入速率匹配；
8. SSD 环境是否仍开启了不必要的邻居刷新；
9. 是否存在大批量写入、长事务或 checkpoint 尖峰。

刷脏页无法也不应该被彻底消除。调优的目标是让后台刷盘长期跟得上写入速度，同时给前台 SQL 保留足够的 I/O 能力，避免从平稳后台工作演变成前台等待和突发 checkpoint。

## 参考资料

- [MySQL 8.4 Reference Manual：Configuring InnoDB I/O Capacity](https://dev.mysql.com/doc/refman/8.4/en/innodb-configuring-io-capacity.html)
- [MySQL 8.4 Reference Manual：InnoDB Checkpoints](https://dev.mysql.com/doc/refman/8.4/en/innodb-checkpoints.html)
- [MySQL 8.0 Reference Manual：Configuring Buffer Pool Flushing](https://dev.mysql.com/doc/refman/8.0/en/innodb-buffer-pool-flushing.html)
- [MySQL 8.4 Reference Manual：Buffer Pool LRU](https://dev.mysql.com/doc/refman/8.4/en/innodb-performance-midpoint_insertion.html)
- [MySQL 8.4 Reference Manual：InnoDB System Variables](https://dev.mysql.com/doc/refman/8.4/en/innodb-parameters.html)
