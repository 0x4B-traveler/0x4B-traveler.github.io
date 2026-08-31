---
title: MySQL慢查询与突发高负载应急处理
date: 2026-08-31
description: 从紧急加索引、查询重写到流量止血，梳理 MySQL 性能故障的应急方案与风险
domain: database
tags: [mysql, 数据库]
status: growing
draft: false
subcategory: backend
term: database
order: 14
---

MySQL 出现性能问题时，我们很容易把所有现象都归结为“慢查询”。实际上，数据库压力升高通常来自两类问题：一种是**单条 SQL 执行得很慢**，另一种是**单条 SQL 并不慢，但 QPS 突然暴涨**。前者需要减少一次查询消耗的资源，后者需要控制单位时间进入数据库的工作量。

常见原因可以归纳为四类：

1. **索引设计不合理**：缺少索引、联合索引顺序不合适，或者索引选择性太差；
2. **SQL 写法不合理**：条件不可索引、读取无用列、关联或排序方式不当；
3. **优化器选错执行计划**：统计信息过期、数据分布不均或代价估算偏差；
4. **请求量异常**：业务高峰、应用 Bug、重试风暴或批处理任务导致某类 SQL 的 QPS 突增。

前三种关注的是单次查询成本，第四种关注的是调用频率。线上故障往往是两者叠加：原本勉强可接受的 SQL 在 QPS 放大后迅速压垮数据库。

本文讨论的是生产环境已经出现压力时，怎样用紧急加索引、查询重写和流量隔离进行止血，以及这些方案为什么不能代替长期治理。

## 先确认慢在哪里

任何应急操作之前，都应该先保留最基本的现场信息：

- 数据库 CPU、I/O、内存和连接数；
- `Threads_connected` 与 `Threads_running`；
- 当前运行 SQL、锁等待和长事务；
- Performance Schema 中按 digest 聚合的执行次数、总耗时和扫描行数；
- 慢查询日志中的 `Query_time`、`Lock_time`、`Rows_sent` 与 `Rows_examined`；
- 应用侧的 SQL QPS、错误率、超时率和重试次数。

一个查询响应慢，不一定是执行计划差。它也可能正在等待行锁、MDL、磁盘 I/O 或可用连接。如果还没有分清是在“执行”还是在“等待”，直接加索引或强制索引可能完全无效。

`Rows_examined` 是非常有用的线索：返回很少的记录却扫描大量行，通常意味着访问路径需要优化。但它不是唯一标准。一次扫描行数不高的随机 I/O、文件排序、临时表或锁等待，同样可能产生很高延迟。

## 情况一：索引没有设计好

如果已经通过执行计划确认缺少关键索引，最直接的办法是创建索引：

```sql
ALTER TABLE orders
  ADD INDEX idx_user_status_created (user_id, status, created_at),
  ALGORITHM = INPLACE,
  LOCK = NONE;
```

现代 InnoDB 创建普通二级索引通常支持 in-place Online DDL，执行期间可以继续读写。不过，“Online”并不意味着没有成本：操作仍要扫描数据、排序并构建索引，会消耗 CPU、I/O、Buffer Pool 和临时磁盘空间，开始和结束阶段还需要取得 MDL。

显式指定 `ALGORITHM` 和 `LOCK` 的好处是：如果当前版本、表结构或索引类型不支持这个并发级别，语句会直接失败，而不是悄悄退化成影响更大的执行方式。添加 `FULLTEXT`、`SPATIAL` 索引以及某些特殊表结构的并发能力不同，必须查对应版本的支持矩阵。

执行前还要确认：

1. 索引能否真正改善目标 SQL，而不是只凭字段出现在 `WHERE` 中就创建；
2. 新索引会增加多少存储空间和写放大；
3. 数据目录与临时目录是否有足够空间；
4. 是否存在会阻塞 MDL 的长事务；
5. 主库负载和复制延迟能否承受 DDL；
6. 失败、中止和回滚路径是否已经演练。

有关 Online DDL 和 MDL 的实现，可结合站内文章 [《InnoDB表空间、数据空洞与Online DDL》](/knowledge/backend/database/innodb表空间数据空洞与online-ddl/) 阅读。

### 历史方案：先在备库创建索引

在 Online DDL 尚不成熟、主库无法承受建索引负载的年代，常见的一主一备应急方案是：

1. 主库为 A，备库为 B；
2. 在 B 的专用会话执行 `SET SESSION sql_log_bin = OFF`；
3. 在 B 上创建索引并等待复制追平；
4. 检查数据一致性、复制状态和业务只读验证；
5. 执行主备切换，让 B 成为新主库；
6. 在旧主库 A 上同样关闭当前会话的 binlog，并创建相同索引；
7. 再次确认两边结构一致和复制正常。

`sql_log_bin` 是 session 变量，只影响当前连接。关闭后，该会话产生的 DDL 不会写入 binlog；在 GTID 模式下，这些操作也不会获得对应的新 GTID。因此，这个流程本质上是**绕过复制，在每个实例独立执行结构变更**。

这不是一个可以照抄的通用方案，其风险包括：

- 切换期间两台实例的表结构暂时不一致；
- DDL 会与备库 SQL 线程争夺 CPU 和 I/O，扩大复制延迟；
- 操作遗漏、索引定义不一致会形成永久的 schema drift；
- GTID 历史不会记录这次本地变更，审计和故障恢复更复杂；
- 主备切换本身存在短暂中断、数据追平和回切风险；
- 不适用于 Group Replication、InnoDB Cluster 等要求成员结构一致的拓扑；
- 云数据库可能不允许关闭 binlog、直接切换或执行相同的管理操作。

如果必须采用这种方式，应该先在同版本、同数据量的环境演练，自动比对表结构，并确保切换前备库已经追平。对现代 MySQL，更常见的选择是评估原生 Online DDL、`gh-ost`、`pt-online-schema-change` 或云厂商提供的在线变更能力，而不是默认通过主备切换规避 DDL 压力。

## 情况二：SQL 写法不合理

下面的条件在索引列上做了运算，通常不利于直接使用 `id` 的索引定位：

```sql
SELECT * FROM t WHERE id + 1 = 10000;
```

更合适的写法是把运算移动到常量一侧：

```sql
SELECT * FROM t WHERE id = 10000 - 1;
```

正确做法当然是修改应用代码并正常发布。但在短时间内无法发版、错误 SQL 又持续冲击数据库时，可以把查询重写作为临时止血工具。

## 使用 Rewriter 插件紧急改写 SQL

MySQL 5.7 引入了 Rewriter 查询重写插件，MySQL 8.x 仍然支持。它在服务端解析 SQL 后，根据内存中的规则匹配并改写语句。当前版本可以处理 `SELECT`、`INSERT`、`REPLACE`、`UPDATE` 和 `DELETE`，但视图定义或存储程序内部的语句不参与改写。

Rewriter 不是默认即可使用的 SQL 语法功能。首先要确认插件已经安装并启用：

```sql
SHOW GLOBAL VARIABLES LIKE 'rewriter_enabled';
SHOW GLOBAL STATUS LIKE 'Rewriter%';
```

官方 MySQL 发行包在 `share` 目录提供 `install_rewriter.sql` 和 `uninstall_rewriter.sql`。插件即使被禁用也可能带来少量开销，不应为了某一次故障临时安装后便长期无人维护。

### 添加改写规则

可以用下面的规则改写前面的 SQL：

```sql
INSERT INTO query_rewrite.rewrite_rules
  (pattern, replacement, pattern_database)
VALUES
  (
    'SELECT * FROM t WHERE id + 1 = ?',
    'SELECT * FROM t WHERE id = ? - 1',
    'db1'
  );

CALL query_rewrite.flush_rewrite_rules();
```

这里只把 `?` 当作字面量参数标记，不能用它匹配表名、列名、函数或 SQL 关键字，也不要在规则中给 `?` 加引号。`pattern_database` 用于约束未带库名的表，避免其他数据库中同名表的语句被误匹配。

插入规则并不会立即生效，必须调用 `flush_rewrite_rules()`，把表中的规则加载到插件内存。如果加载失败，需要查看规则的 `message` 字段和 `Rewriter_reload_error`：

```sql
SELECT
  id,
  enabled,
  message,
  normalized_pattern,
  pattern_digest
FROM query_rewrite.rewrite_rules;

SHOW GLOBAL STATUS LIKE 'Rewriter%';
```

### 确认规则已经命中

执行目标 SQL 后立即在同一会话运行：

```sql
SHOW WARNINGS;
```

规则命中时，MySQL 会返回 Note 1105，说明原始语句被改写成了什么。截图中的查询被改写为 `id = 10000 - 1`，最终返回 `id = 9999` 的记录。

![Rewriter 插件通过 SHOW WARNINGS 显示查询改写结果](/images/mysql/query-rewriter-show-warnings.png)

除了单次 `SHOW WARNINGS`，还应该持续观察：

```sql
SHOW GLOBAL STATUS LIKE 'Rewriter_number_loaded_rules';
SHOW GLOBAL STATUS LIKE 'Rewriter_number_rewritten_queries';
SHOW GLOBAL STATUS LIKE 'Rewriter_reload_error';
```

验证不能只看“规则命中了”，还要比较改写前后的返回列、数据类型、行数、执行计划和业务结果。

### 快速停用规则

每条临时规则都必须在创建前准备撤销语句：

```sql
UPDATE query_rewrite.rewrite_rules
SET enabled = 'NO'
WHERE id = 123;

CALL query_rewrite.flush_rewrite_rules();
```

不要只删除表里的记录却忘记重新加载规则。规则需要记录负责人、故障单、创建时间、预计失效时间和回滚验证结果，避免一次临时止血变成长期隐患。

## 情况三：MySQL 选错索引

如果 SQL 本身没有明显问题，但优化器因为统计信息或代价估算选择了不合适的索引，应该先尝试：

1. 使用 `EXPLAIN` 或 `EXPLAIN ANALYZE` 对比执行计划；
2. 检查索引选择性与数据分布；
3. 通过 `ANALYZE TABLE` 更新统计信息；
4. 必要时创建直方图或调整索引设计；
5. 最后才考虑使用索引提示固定执行计划。

短期内无法修改应用时，也可以通过 Rewriter 加入索引提示：

```sql
INSERT INTO query_rewrite.rewrite_rules
  (pattern, replacement, pattern_database)
VALUES
  (
    'SELECT * FROM t WHERE c = ?',
    'SELECT * FROM t FORCE INDEX (idx_c) WHERE c = ?',
    'db1'
  );

CALL query_rewrite.flush_rewrite_rules();
```

`FORCE INDEX` 会让优化器认为全表扫描代价极高，尽量从指定索引中选择访问路径，但它不是绝对保证，索引无法使用时仍可能扫描表。更重要的是，今天合适的索引在数据分布变化后可能变成错误选择，所以强制计划必须有监控与到期复查。

MySQL 8.4 已提供 `INDEX`、`JOIN_INDEX` 等索引级优化器 Hint，并说明它们将取代传统 `FORCE INDEX`、`USE INDEX` 和 `IGNORE INDEX`。在新版本中，可以评估将 SQL 重写成带优化器 Hint 的形式，而不是继续依赖可能在未来弃用的语法。

优化器为什么会选错索引，以及统计信息、采样和代价估算如何影响选择，适合在《MySQL为什么选错索引》中单独展开。本文只讨论故障期间的临时干预。

## 上线前发现慢 SQL

缺少索引和 SQL 写法问题，大多可以在上线前发现。在隔离的测试环境中，可以临时打开慢查询日志，并把阈值设为 0，让所有执行完成且符合记录条件的语句进入日志：

```sql
SET GLOBAL slow_query_log = ON;
SET GLOBAL log_output = 'FILE';
SET GLOBAL long_query_time = 0;
SET GLOBAL min_examined_row_limit = 0;
```

`long_query_time` 同时具有 global 和 session 作用域。修改 global 值后，已经存在的连接仍保留原来的 session 值，因此回归测试客户端应重新连接，或者在测试会话中显式设置：

```sql
SET SESSION long_query_time = 0;
```

这个方案只适合测试环境或短时间、受控的诊断窗口。在生产环境将阈值设为 0 会产生大量日志 I/O、迅速占满磁盘，并使问题更加严重。

高质量回归测试不只是“插入很多行”，还要尽可能模拟线上数据分布：热点值比例、NULL 比例、时间范围、租户大小差异和字段相关性都会影响优化器选择。测试步骤可以是：

1. 导入脱敏或生成的近似线上数据；
2. 更新表和索引统计信息；
3. 执行完整业务回归与典型并发压测；
4. 按 SQL digest 聚合同类语句；
5. 对比 `Rows_examined`、`Rows_sent`、执行时间和锁等待；
6. 对扫描行数异常的语句检查执行计划；
7. 将关键 SQL 的执行计划或性能基线纳入发布检查。

`Rows_examined / Rows_sent` 比例很高通常值得关注，但不要机械地把某个比例作为唯一门槛。聚合、报表和批处理本来就可能扫描大量数据，应结合业务目标与运行频率判断。

## 情况四：SQL 的 QPS 突然暴涨

一条 5ms 的 SQL 如果突然从每秒执行 100 次变成 10000 次，同样可能耗尽数据库资源。这种问题的第一处理位置应该是应用或流量入口：

- 通过功能开关关闭故障功能；
- 在网关、服务或连接池处限流；
- 暂停非核心批处理和定时任务；
- 关闭无上限重试并加入指数退避与抖动；
- 对可缓存结果启用应用缓存；
- 通过熔断和降级减少进入数据库的工作量。

从数据库端“下掉功能”属于最后一道防线，通常有以下两类方案。

### 方案一：隔离新业务账号或访问来源

如果新功能使用独立数据库账号、独立服务和明确的访问白名单，可以先从网络或代理层撤销它的访问来源，也可以临时锁定专用账号：

```sql
ALTER USER 'feature_user'@'app_host' ACCOUNT LOCK;
```

账号锁定只阻止新连接，不会自动关闭已经建立的会话。确认影响范围后，还要找出现有连接并逐个终止。`DROP USER` 同样不会自动断开现有会话，而且会永久删除账号及授权，还可能受到存储对象 `DEFINER` 的约束；作为临时止血，`ACCOUNT LOCK` 通常比直接删除账号更容易回滚。

这种方案依赖规范的账号隔离。如果新功能与核心业务共用账号、连接池和部署单元，就无法只在数据库侧禁止新功能而不误伤主体业务。

### 方案二：把高压 SQL 改写成降级结果

当应用来不及发布、账号又无法隔离时，可以用 Rewriter 把压力最大的查询改成快速返回，例如改写为 `SELECT 1`。这是所有方案中优先级最低、风险最高的一种。

它至少有以下副作用：

- 规则按照规范化 SQL 模板匹配，其他功能使用同一模板时会被一起改写；
- `SELECT 1` 的列数、列名和数据类型可能与原结果不一致，ORM 或反序列化逻辑会直接报错；
- 即使返回结构兼容，伪造结果也可能让后续业务逻辑做出错误判断；
- 一个业务请求通常包含多条 SQL，只改写其中一条可能造成部分成功、部分失败；
- 如果目标是写语句，改写会改变事务语义、影响行数和幂等判断；
- 规则覆盖范围评估不足时，止血操作本身可能扩大故障。

如果确实只能这样处理，应尽量让降级结果保持与原查询相同的列结构和类型，并先在影子流量或单独账号上验证。规则必须有明确失效时间、命中计数、业务确认人和一键回滚脚本。

## 一套更稳妥的止血顺序

发生慢 SQL 或突发 QPS 故障时，可以按照下面的顺序决策：

1. **保留现场**：记录 SQL digest、执行计划、QPS、扫描行数、锁等待和系统负载；
2. **入口减压**：限流、暂停非核心任务、关闭重试风暴；
3. **终止异常来源**：通过功能开关、白名单或独立账号隔离问题业务；
4. **修正统计信息或 SQL**：能安全发布时优先修复根因；
5. **Online DDL 添加索引**：评估资源和 MDL 风险后执行；
6. **查询重写或固定计划**：应用来不及发布时的临时桥接方案；
7. **伪造降级结果**：只有确认业务影响并准备快速回滚时才使用；
8. **故障后清理**：撤销临时规则、恢复参数、复查索引并沉淀监控。

数据库应急的目标不是让所有请求继续按原方式运行，而是用最小的业务损失把系统拉回可处理的负载区间。越靠近数据库底层的强制手段，覆盖范围通常越大，越需要谨慎评估误伤和回滚成本。

## 小结

- 慢 SQL 常见根因包括索引设计、SQL 写法和执行计划，数据库过载还可能只是 QPS 异常；
- 添加普通二级索引优先评估原生 Online DDL，备库建索引再切换是拓扑相关、风险较高的历史方案；
- `sql_log_bin = OFF` 只影响当前会话，并会让操作脱离 binlog 和 GTID 历史；
- Rewriter 能在无法及时发版时修正 SQL 或加入索引提示，但必须完成安装确认、规则加载、命中验证、监控和撤销闭环；
- `SHOW WARNINGS` 可以确认单次查询的改写结果，`Rewriter%` 状态变量适合观察整体运行情况；
- 测试环境可以临时使用 `long_query_time = 0` 收集全部语句，生产环境不应长期开启；
- SQL QPS 暴涨时应优先在应用和入口限流，数据库侧账号隔离或查询改写只是最后防线；
- 所有临时止血措施都要有负责人、失效时间和回滚脚本。

## 参考资料

- [MySQL 8.4：Rewriter Query Rewrite Plugin](https://dev.mysql.com/doc/refman/8.4/en/rewriter-query-rewrite-plugin.html)
- [MySQL 8.4：使用 Rewriter 插件](https://dev.mysql.com/doc/refman/8.4/en/rewriter-query-rewrite-plugin-usage.html)
- [MySQL 8.4：安装 Rewriter 插件](https://dev.mysql.com/doc/refman/8.4/en/rewriter-query-rewrite-plugin-installation.html)
- [MySQL 8.4：SET sql_log_bin](https://dev.mysql.com/doc/refman/8.4/en/set-sql-log-bin.html)
- [MySQL 8.4：Online DDL 操作](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)
- [MySQL 8.4：慢查询日志](https://dev.mysql.com/doc/refman/8.4/en/slow-query-log.html)
- [MySQL 8.4：Index Hints](https://dev.mysql.com/doc/refman/8.4/en/index-hints.html)
- [MySQL 8.4：Optimizer Hints](https://dev.mysql.com/doc/refman/8.4/en/optimizer-hints.html)
- [MySQL 8.0：DROP USER](https://dev.mysql.com/doc/refman/8.0/en/drop-user.html)
