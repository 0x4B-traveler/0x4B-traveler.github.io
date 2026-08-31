---
title: 排序与Join优化
date: 2026-08-26
updated: 2026-08-31
description: 从 sort_buffer、全字段排序和 rowid 排序出发，理解 MySQL ORDER BY 的执行过程、诊断方法与索引优化策略
domain: database
tags: [mysql, 数据库]
status: growing
draft: false
subcategory: backend
term: database
order: 9
---

`ORDER BY` 写起来很简单，但它背后可能是一次顺序读取，也可能包含回表、内存排序、磁盘临时文件和再次回表。理解这些路径，才能解释为什么有些排序只需要几毫秒，有些却会随着数据量增长迅速变慢。

本文先聚焦排序：MySQL 在什么时候可以直接利用索引顺序，什么时候必须执行 `filesort`，全字段排序与 rowid 排序有何取舍，以及应该怎样诊断和优化。

## 从一条查询开始

假设有下面这张 InnoDB 表：

```sql
CREATE TABLE t (
    id   INT NOT NULL,
    city VARCHAR(16) NOT NULL,
    name VARCHAR(16) NOT NULL,
    age  INT NOT NULL,
    addr VARCHAR(128),
    PRIMARY KEY (id),
    KEY idx_city (city)
) ENGINE = InnoDB;
```

现在查询杭州用户，并按照姓名返回前 1000 条：

```sql
SELECT city, name, age
FROM t
WHERE city = '杭州'
ORDER BY name
LIMIT 1000;
```

`idx_city` 可以快速定位 `city = '杭州'` 的记录，但同一个城市内的记录并不保证按照 `name` 排列。因此，MySQL 读取候选行以后还要增加一个排序阶段。

执行 `EXPLAIN` 时，如果 `Extra` 中出现 `Using filesort`，就表示 MySQL 不能直接利用索引顺序完成 `ORDER BY`，需要额外排序：

```sql
EXPLAIN
SELECT city, name, age
FROM t
WHERE city = '杭州'
ORDER BY name
LIMIT 1000;
```

需要注意：**`filesort` 是 MySQL 对额外排序算法的名称，并不等于一定在磁盘上排序。** 数据量能放入排序缓冲区时，排序可以完全在内存中完成；内存不足时才会借助磁盘临时文件。

## sort_buffer：排序发生在哪里

需要执行 `filesort` 时，MySQL Server 层会为执行排序的会话使用一块排序缓冲区，即 `sort_buffer`。它的上限由会话变量 `sort_buffer_size` 控制。

```sql
SHOW SESSION VARIABLES LIKE 'sort_buffer_size';
```

排序数据未超过可用缓冲区时，可以在内存中完成；数据过多时，MySQL 会把数据分成若干批次分别排序，再通过外部归并将临时文件合并为最终结果。

```
候选行
  │
  ├─ 能放入 sort_buffer ──> 内存排序 ──> 返回结果
  │
  └─ 放不下 ──> 分批排序并写临时文件 ──> 归并 ──> 返回结果
```

因此，排序成本不只由最终的 `LIMIT 1000` 决定，更取决于：

- `WHERE` 条件产生了多少候选行；
- 每个排序元组占用多少字节；
- `sort_buffer_size` 有多大；
- 是否需要写临时文件以及执行多少次归并；
- 排序完成后是否还需要回表。

MySQL 8.0.12 以前，排序缓冲区按照配置值一次性分配；从 8.0.12 开始，MySQL 会从较小的内存开始按需增长，最大不超过 `sort_buffer_size`。不过它仍然是会话级资源：高并发场景下盲目调大全局值，可能放大总体内存占用。

## 全字段排序

一种排序方式是把查询需要返回的字段全部放入 `sort_buffer`。对于示例 SQL，可以概括为以下过程：

1. 初始化 `sort_buffer`，准备存放 `city`、`name` 和 `age`；
2. 从 `idx_city` 找到第一条 `city = '杭州'` 的记录，取得主键 `id`；
3. 根据 `id` 回到聚簇索引，读取完整记录；
4. 把需要返回的三个字段写入 `sort_buffer`；
5. 继续扫描 `idx_city`，直到不再满足城市条件；
6. 在 `sort_buffer` 中按照 `name` 排序；
7. 取前 1000 行返回客户端。

```
idx_city 定位候选行
        │
        ▼
根据主键回表读取 city、name、age
        │
        ▼
写入 sort_buffer 并按 name 排序
        │
        ▼
直接返回前 1000 行
```

它的优势是：排序完成后，返回结果所需的字段已经全部在排序元组中，不必再次访问原表。

它的代价也很直接：查询字段越多、字段越长，每个排序元组就越大。同样大小的 `sort_buffer` 能容纳的行数会减少，更容易产生磁盘临时文件和多轮归并。

## rowid 排序

为了减小单个排序元组，MySQL 也可以只把排序键和行定位信息放入 `sort_buffer`。对于 InnoDB，行定位信息通常就是主键值。示例 SQL 的执行过程变为：

1. 初始化 `sort_buffer`，只准备存放 `name` 和 `id`；
2. 使用 `idx_city` 找到候选记录；
3. 回表取出 `name` 和 `id`，写入 `sort_buffer`；
4. 对所有候选记录按照 `name` 排序；
5. 取排序结果中的前 1000 个 `id`；
6. 再根据这些 `id` 回表读取 `city`、`name` 和 `age`，依次返回客户端。

```
idx_city 定位候选行
        │
        ▼
写入 name + id
        │
        ▼
在 sort_buffer 中排序
        │
        ▼
按前 1000 个 id 再次回表
        │
        ▼
返回 city、name、age
```

rowid 排序缩小了排序元组，同样的内存能够容纳更多记录，通常可以减少临时文件数量和归并成本；代价是排序后还要再次回表，增加随机访问。

两种方式的核心取舍如下：

| 对比项 | 全字段排序 | rowid 排序 |
| --- | --- | --- |
| `sort_buffer` 中保存的内容 | 排序键和查询需要的字段 | 排序键和行定位信息 |
| 单个排序元组 | 较大 | 较小 |
| 排序后再次回表 | 不需要 | 需要 |
| 主要收益 | 减少表访问 | 减少排序内存和临时文件 |
| 主要风险 | 宽行导致外部排序 | 二次回表带来随机 I/O |

### 一个容易过时的参数结论

在 MySQL 5.7 和早期 8.0 版本中，`max_length_for_sort_data` 会影响优化器在“携带额外字段”和“只携带 rowid”之间的选择。很多旧资料会通过调小这个参数演示 rowid 排序。

但从 **MySQL 8.0.20** 开始，`max_length_for_sort_data` 已被弃用，并且对优化器不再产生作用。新版本中不要继续依赖这个参数切换排序方式，而应通过优化器跟踪中的 `sort_mode` 观察实际排序元组：

- `<sort_key, rowid>`：排序键加行定位信息；
- `<sort_key, additional_fields>`：排序键加查询所需字段；
- `<sort_key, packed_additional_fields>`：与上一种类似，但附加字段使用紧凑格式。

## “Using filesort” 与 “Using temporary” 不是一回事

这两个执行计划提示经常被混为一谈：

- `Using filesort`：需要额外的排序阶段；
- `Using temporary`：查询处理过程中建立了内部临时表。

一次 `filesort` 可能完全在内存中完成，也可能使用磁盘临时文件，但这并不意味着 `EXPLAIN` 必然同时显示 `Using temporary`。反过来，`GROUP BY`、`DISTINCT`、派生表或窗口函数等操作可能建立内部临时表，却不一定对应当前讨论的排序路径。

## 最有效的优化：让索引本身提供顺序

排序是因为通过 `idx_city` 取出的候选行在 `name` 维度上无序。如果建立联合索引：

```sql
ALTER TABLE t ADD INDEX idx_city_name (city, name);
```

在 B+ 树中，记录先按 `city` 排列，在 `city` 相同的范围内再按 `name` 排列。因此，当 `city = '杭州'` 固定以后，顺序扫描这段索引得到的记录天然满足 `ORDER BY name`，可以避免额外排序。

此时执行过程变成：

1. 定位联合索引中第一条 `city = '杭州'` 的记录；
2. 按照索引顺序连续读取；
3. 回表取得 `age`；
4. 读满 1000 行后即可停止。

如果查询固定且读取频繁，还可以让索引覆盖所有需要的列：

```sql
ALTER TABLE t ADD INDEX idx_city_name_age (city, name, age);
```

这样既不需要排序，也不需要回表。不过覆盖索引并非越宽越好。更宽的索引会占用更多空间，并增加插入、删除、更新、redo log 和复制的维护成本。应结合查询频率、返回列稳定性和写入压力决定是否值得。

## LIMIT 并不总能让排序变得便宜

`LIMIT 1000` 只表示最终返回 1000 行，并不必然意味着 MySQL 只读取或只处理 1000 行。如果没有可提供顺序的索引，MySQL 通常仍需要检查所有符合 `WHERE` 条件的候选行，才能判断哪 1000 行排在最前面。

对于 `ORDER BY ... LIMIT N`，优化器可能使用优先队列等方式，只在内存中保留当前最优的 N 行，从而避免完整排序或归并文件；但它仍然需要遍历候选记录。因此优化重点通常是：

1. 用更有选择性的条件减少候选行；
2. 建立与过滤条件和排序顺序匹配的联合索引；
3. 避免返回不必要的宽字段；
4. 对深分页使用游标翻页，而不是不断增大的 `OFFSET`。

例如，为了稳定地分页，排序条件最好包含唯一列：

```sql
SELECT city, name, age, id
FROM t
WHERE city = '杭州'
  AND (name, id) > (?, ?)
ORDER BY name, id
LIMIT 1000;
```

仅使用 `ORDER BY name` 时，同名记录之间的顺序没有保证，不同执行计划或不同次查询可能给出不同的相对次序。加入唯一主键既能让结果确定，也便于使用上一页末尾的 `(name, id)` 继续向后读取。索引是否完整支持该写法，应使用当前版本的 `EXPLAIN` 验证。

## 如何判断排序是否落盘

`EXPLAIN` 只能告诉我们是否使用了 `filesort`，不能直接区分排序是在内存完成还是使用了磁盘文件。进一步诊断可以使用优化器跟踪：

```sql
SET optimizer_trace = 'enabled=on';

SELECT city, name, age
FROM t
WHERE city = '杭州'
ORDER BY name
LIMIT 1000;

SELECT TRACE
FROM information_schema.OPTIMIZER_TRACE;

SET optimizer_trace = 'enabled=off';
```

重点关注 `filesort_summary` 中的信息，例如：

- `rows`、`examined_rows`：进入排序或被检查的行数；
- `number_of_tmp_files`：排序产生的临时文件数量；
- `peak_memory_used`：排序过程的内存峰值；
- `sort_mode`：排序元组保存的是 rowid 还是附加字段。

还可以观察实例级状态：

```sql
SHOW GLOBAL STATUS LIKE 'Sort_merge_passes';
SHOW GLOBAL STATUS LIKE 'Sort_rows';
SHOW GLOBAL STATUS LIKE 'Sort_scan';
SHOW GLOBAL STATUS LIKE 'Sort_range';
```

`Sort_merge_passes` 持续快速增长，说明存在较多需要归并的排序。但这些指标是实例累计值，不能只看某一时刻的绝对数字；应关注单位时间增量，并与慢查询、执行计划和业务流量一起分析。

## sort_buffer_size 应该怎样调整

如果确认 SQL 无法通过索引消除排序，并且大量排序确实因为内存不足而发生多轮归并，可以在压测后针对会话适当提高 `sort_buffer_size`：

```sql
SET SESSION sort_buffer_size = 2 * 1024 * 1024;
```

不建议看到 `Using filesort` 就直接调大全局值，原因包括：

- `Using filesort` 可能本来就在内存中完成；
- 排序缓冲区是会话级资源，高并发时总体内存消耗会被放大；
- 更大的缓冲区不能减少需要扫描的候选行；
- 索引设计或 SQL 形态有问题时，调参只是掩盖根因；
- 在部分平台上，过大的缓冲区还可能降低内存分配效率。

推荐的处理顺序是：**先减少扫描行数，再尝试用索引提供顺序，然后缩小返回字段，最后才评估会话级调参。**

## 排序优化检查清单

遇到慢 `ORDER BY` 时，可以依次检查：

1. `EXPLAIN` 是否出现 `Using filesort`；
2. 过滤条件预计产生多少候选行，实际 `rows` 是否偏差很大；
3. 是否存在满足“等值过滤列在前、排序列在后”的联合索引；
4. 是否能利用覆盖索引减少回表；
5. 查询是否返回了过多、过宽的字段；
6. `LIMIT` 是否伴随很大的 `OFFSET`；
7. 相同排序键之间是否需要用唯一列保证稳定顺序；
8. 优化器跟踪中的 `sort_mode`、临时文件数量和内存峰值；
9. `Sort_merge_passes` 是否在问题时段异常增长；
10. 是否经过压测后，仅对目标会话调整 `sort_buffer_size`。

## 小结

`ORDER BY` 的执行可以归纳为两条主路径：

- **索引有序**：沿索引顺序读取，通常可以提前在 `LIMIT` 处停止；
- **额外排序**：读取候选行写入 `sort_buffer`，采用全字段或 rowid 类型的排序元组，必要时借助磁盘临时文件完成归并。

全字段排序用更多内存换取少一次回表；rowid 排序缩小排序数据，却需要在排序后再次取行。真正稳定且收益最大的优化，通常不是一味增大排序缓冲区，而是让联合索引同时服务过滤条件与排序顺序，并控制扫描量和返回宽度。

## Join 原理与优化

Join 的驱动表选择、Index Nested-Loop Join、Block Nested-Loop Join、Hash Join 与连接缓冲区将在后续笔记中继续补充。

## 参考资料

- [极客时间：MySQL 实战 45 讲——“order by”是怎么工作的？](https://time.geekbang.com/column/article/73479)
- [MySQL 8.0 Reference Manual：ORDER BY Optimization](https://dev.mysql.com/doc/refman/8.0/en/order-by-optimization.html)
- [MySQL 8.4 Reference Manual：ORDER BY Optimization](https://dev.mysql.com/doc/refman/8.4/en/order-by-optimization.html)
- [MySQL 8.0 Reference Manual：LIMIT Query Optimization](https://dev.mysql.com/doc/refman/8.0/en/limit-optimization.html)
