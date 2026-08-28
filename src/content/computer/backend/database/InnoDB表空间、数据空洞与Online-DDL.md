---
title: InnoDB表空间、数据空洞与Online DDL
date: 2026-08-28
description: 理解 InnoDB 表文件、数据空洞、表重建及 Online DDL 的实现与风险
domain: database
tags: [mysql, 数据库]
status: growing
draft: false
subcategory: backend
term: database
order: 13
---

一个 InnoDB 表在逻辑上包含两类信息：一类是列、索引、约束等**表结构定义**，另一类是记录和索引等**表数据**。理解它们在磁盘上的组织方式，是分析“为什么删除数据后文件没有变小”以及“怎样安全地重建大表”的基础。

## 表结构与表数据存在哪里

### MySQL 8.0 之前的 `.frm`

在 MySQL 5.7 及更早版本中，每张表都有一个以 `.frm` 结尾的文件，用于保存表格式和表定义。`.frm` 通常被称为 **table format file**，可以把它理解为表定义文件；官方文档并没有把 `frm` 定义成需要逐字展开的正式缩写。

对 InnoDB 来说，情况还要更复杂一些：除了 Server 层的 `.frm` 文件，InnoDB 自己的内部数据字典中也保存着表的元数据。因此，不能只复制 `.frm` 文件就认为完整迁移了一张 InnoDB 表。

### MySQL 8.0 的事务型数据字典

MySQL 8.0 移除了基于 `.frm` 等文件的元数据存储，改用统一、事务型的数据字典。表、列、索引等字典信息由 MySQL 管理，并保存在 InnoDB 数据字典表中，因此 DDL 元数据更新具备更好的事务性和崩溃安全能力。

与此同时，InnoDB 还会在表空间文件中保存序列化字典信息，即 **SDI（Serialized Dictionary Information）**。SDI 是 JSON 格式的元数据副本，用于提供冗余，并不意味着 MySQL 8.0 又恢复了过去以 `.frm` 为核心的元数据管理方式。

### `.ibd` 和系统表空间

InnoDB 的表数据与索引放在哪里，默认由 `innodb_file_per_table` 控制。注意，正确的参数名是 `innodb_file_per_table`，不是 `innodb_file_pre_table`。

- `ON`：新建表默认使用独立表空间，数据和索引存放在该表对应的 `.ibd` 文件中；
- `OFF`：新建表默认放入 InnoDB 系统表空间，通常对应 `ibdata1` 等文件；
- 显式使用 `TABLESPACE` 子句时，可以覆盖上述默认选择，将表放入独立表空间、通用表空间或系统表空间。

`.ibd` 可以理解为 **InnoDB tablespace data file**，它保存 InnoDB 表空间中的数据页和索引页；在 MySQL 8.0 中，除临时表空间和 undo 表空间外，InnoDB 表空间文件通常还包含 SDI。

从 MySQL 5.6.7 开始，`innodb_file_per_table` 默认开启。独立表空间的一个重要优势是：执行 `TRUNCATE TABLE`、`DROP TABLE` 或重建表后，释放的文件空间可以返还给操作系统。系统共享表空间中的空闲空间通常只能由 InnoDB 后续复用，`ibdata` 文件不会因为删除或重建某一张表而自动缩小。

可以用下面的语句确认当前默认配置：

```sql
SHOW VARIABLES LIKE 'innodb_file_per_table';
```

该参数主要决定**之后新建表的默认位置**，修改它不会自动迁移已经存在的表。

## 为什么删除数据后文件没有变小

### 删除通常只是标记空间可复用

InnoDB 的数据以页为单位组织，默认页大小通常是 16KB。执行 `DELETE` 删除记录后，记录最终会从索引中清理，其占用的位置可以被后续数据复用，但表空间文件通常不会立即截断，因此从操作系统看到的 `.ibd` 文件大小不会随之减小。

这里需要区分两个概念：

- **逻辑空闲**：空间已经没有有效记录，InnoDB 可以在表内再次使用；
- **物理回收**：文件实际缩小，空间被返还给操作系统。

普通 `DELETE` 主要产生前一种效果。即使执行：

```sql
DELETE FROM table_a;
```

所有数据最终都被删除，原来占用的数据页也通常只是成为可复用空间，文件本身不会自动缩小。如果业务语义允许清空整张表，`TRUNCATE TABLE table_a` 通常更直接；对于独立表空间，它会重新创建表空间，从而释放原 `.ibd` 文件占用的空间，但它属于 DDL，事务语义、锁与权限也不同于 `DELETE`。

### 记录复用和数据页复用不同

索引页中的单条记录被删除后，留下的位置受 B+ 树键值顺序和页内组织方式约束，通常适合被相邻键值范围内的新记录复用；而一个数据页整体变成可复用页后，它可以用于索引树中其他合适的位置，复用范围更大。

如果相邻页的利用率都很低，InnoDB 可能进行页合并，把记录集中到其中一个页，释放另一个页供表内复用。但页合并仍不等于缩小表空间文件。

### 插入和更新也会制造空洞

空洞并不只由删除产生。

- 如果记录按照聚簇索引键递增插入，数据页通常能以较紧凑的方式追加；
- 如果主键或索引键随机分布，新记录需要插入到已有页的中间，页面空间不足时会触发**页分裂**；
- 页分裂会把部分记录移动到新页，为后续插入预留空间，短期内可能降低页面填充率；
- 更新索引列可以近似理解为删除旧索引项并插入新索引项，也可能引起页分裂、页合并和碎片。

所以，“文件大于当前有效数据量”并不必然表示异常，它可能是 InnoDB 为后续写入保留的可复用空间。只有确认空间长期不会再次使用，或者碎片已经明显影响扫描和缓存效率时，才值得考虑重建。

## 使用表重建整理空洞

可以通过下面的“空操作重建”让 InnoDB 重新组织数据和索引：

```sql
ALTER TABLE table_a ENGINE = InnoDB;
```

对现代 MySQL 的 InnoDB 表，这通常使用 in-place 算法完成重建。这里的 **in-place** 不等于“原地修改文件且不需要额外空间”，而是指不使用 Server 层传统的 `ALGORITHM=COPY` 表复制方式。需要重建数据的 in-place DDL 仍可能创建中间表文件、排序文件和在线变更日志，磁盘峰值空间可能接近原表及其索引的大小，甚至更高。

重建大致完成以下工作：

1. 扫描原表的聚簇索引数据；
2. 按新表结构重新组织数据并构建索引；
3. 将重建期间允许并发执行的 DML 记录到在线日志；
4. 在结束阶段应用这些变更，使新数据文件与原表的逻辑状态一致；
5. 短暂取得排他元数据锁，提交新的表定义并切换数据文件。

重建会让有效记录重新紧凑排列，从而消除大量逻辑空闲。对于独立 `.ibd` 表空间，旧文件被替换后，多余空间通常可以归还操作系统；对于系统共享表空间，重建释放的空间仍留在系统表空间中供 InnoDB 复用，`ibdata1` 不会因此缩小。

## Online DDL 是怎样允许并发写入的

MySQL 5.6 开始逐步完善 InnoDB Online DDL。在支持 `ALGORITHM=INPLACE, LOCK=NONE` 的重建操作中，核心思路可以概括为：一边构建新的表或索引结构，一边记录并发 DML，最后再应用这些变更。

在线日志的容量由 `innodb_online_alter_log_max_size` 限制。如果重建时间很长、并发写入量又很大，日志超过上限，DDL 会以 `DB_ONLINE_LOG_TOO_BIG` 错误失败。增大该参数能容纳更多并发修改，但也会延长结束阶段应用日志、持锁完成切换的时间。

因此，Online DDL 的“Online”不是完全无锁，更不代表对业务没有影响：

- 初始化和提交表定义时仍需要元数据锁；
- 重建会持续消耗 CPU、磁盘 I/O、Buffer Pool 和临时磁盘空间；
- 并发 DML 会增加在线日志与最终重放成本；
- 长事务持有的元数据锁可能让 DDL 一直等待；
- DDL 等待排他 MDL 时，后续访问还可能排在它后面，形成阻塞队列。

## MDL 是什么

**MDL（Metadata Lock，元数据锁）**用于保护数据库对象的定义，避免一个会话正在使用表时，另一个会话同时修改或删除其结构。

Online DDL 的元数据锁可以理解为三个阶段：

1. **初始化阶段**：取得可升级的共享 MDL，判断存储引擎能力以及 `ALGORITHM`、`LOCK` 是否可用；
2. **执行阶段**：在允许的情况下维持较低级别的锁，使查询或 DML 可以并发执行；某些准备动作仍可能短暂需要排他 MDL；
3. **提交阶段**：升级为排他 MDL，替换旧定义并提交新定义，正常情况下持续时间较短。

因此，把它简单描述为“先取得 MDL 写锁，再退化成读锁”并不准确。更合适的说法是：Online DDL 使用可升级的元数据锁，并在开始或结束阶段短暂取得排他锁。共享元数据锁既允许受支持的并发访问，也会阻止其他冲突 DDL 同时修改表结构。

如果表上存在未结束的长事务，DDL 可能在开始或提交阶段等待 MDL；而一旦排他 MDL 请求进入等待队列，新的查询也可能被阻塞。执行前应先检查长事务，并为线上变更设置合理的 `lock_wait_timeout`。

## Online、In-place 和 Instant 的关系

这几个概念描述的不是同一个维度，不能简单画等号：

- `ALGORITHM=INSTANT`：只修改数据字典元数据，不重建表，通常耗时最短；
- `ALGORITHM=INPLACE`：由存储引擎内部执行，不走传统 Server 层整表复制，但可能仍要重建数据；
- `ALGORITHM=COPY`：创建新表并复制数据，通常会阻塞并发 DML；
- `LOCK=NONE`：允许并发查询和 DML；
- `LOCK=SHARED`：允许查询，但阻塞 DML；
- `LOCK=EXCLUSIVE`：查询和 DML 都会被阻塞。

所以，**in-place 不一定 online**：某些 in-place 操作不能使用 `LOCK=NONE`，例如创建 InnoDB `FULLTEXT` 索引和 `SPATIAL` 索引时会限制并发 DML。反过来，“Online”更适合用来描述操作期间允许何种并发访问，而不应仅根据算法名称判断。

可以显式指定期望的算法和并发级别，让不满足条件的操作直接报错，而不是静默退化为影响更大的方式：

```sql
ALTER TABLE table_a
  ENGINE = InnoDB,
  ALGORITHM = INPLACE,
  LOCK = NONE;
```

具体支持情况与 MySQL 版本、DDL 类型、索引类型和表特征有关，执行前应查对应版本的 Online DDL 支持矩阵。

## ANALYZE、OPTIMIZE 与重建表

三个常见命令的作用并不相同：

### `ANALYZE TABLE`

```sql
ANALYZE TABLE table_a;
```

它主要重新采样并更新优化器使用的表和索引统计信息，不重建表，也不负责回收数据空洞。执行期间会取得元数据锁，具体并发影响需要结合版本和统计方式判断。

### `OPTIMIZE TABLE`

```sql
OPTIMIZE TABLE table_a;
```

对 InnoDB 来说，`OPTIMIZE TABLE` 会映射为 `ALTER TABLE ... FORCE`，重建表以重新组织聚簇索引、更新索引统计信息并释放未使用空间。因此，把它概括为“重建表 + analyze”有助于记忆，但更准确的语义是：InnoDB 通过表重建完成数据与索引整理，同时更新统计信息。

存在 `FULLTEXT` 索引等特殊情况时，算法和并发能力可能不同。执行前不能仅凭命令名称假设它一定完全在线。

### `ALTER TABLE ... ENGINE=InnoDB`

对已经是 InnoDB 的表再次指定同一引擎，会触发一次 null rebuild，适合明确表达“重建这张表”。在支持条件满足时，它可以使用 `ALGORITHM=INPLACE, LOCK=NONE`。

## 大表重建的生产风险

表重建需要扫描原表并构造新的数据和索引结构。即使允许并发 DML，也可能明显影响线上负载：

- 消耗大量磁盘吞吐和 CPU；
- 挤占 Buffer Pool，导致热点页被淘汰；
- 需要足够的中间文件、排序文件和在线日志空间；
- 复制环境中可能带来延迟或额外压力；
- 结束阶段需要排他 MDL，可能被长事务阻塞；
- 异常中止后需要时间清理临时文件或回滚操作。

执行前至少应确认：

1. 当前版本是否支持目标操作的 `ALGORITHM` 与 `LOCK` 组合；
2. 是否有长事务、未提交会话或其他 DDL 持有 MDL；
3. 数据目录和临时目录是否有足够空间；
4. 主库、从库的 I/O 余量与复制延迟是否可接受；
5. 是否已经准备限流、监控、超时与中止方案；
6. 重建后能否真正把空间返还给操作系统。

对于超大表或对延迟敏感的业务，可以评估 `gh-ost` 等在线表结构变更工具。`gh-ost` 创建影子表、分批复制数据，并从 binlog 获取增量变更，最后通过原子重命名完成切换。它能提供限流、暂停和状态观察能力，但仍需要额外磁盘空间，也无法消除最终切换时的 MDL 风险；是否比原生 Online DDL 更合适，需要结合拓扑、外键、触发器、binlog 配置和变更类型判断。

## 小结

- MySQL 5.7 及以前使用 `.frm` 保存 Server 层表定义；MySQL 8.0 改用事务型数据字典，并在 InnoDB 表空间中保存 SDI 副本；
- `.ibd` 是 InnoDB 表空间数据文件，通常包含表数据、索引以及 SDI；
- `DELETE` 主要把空间变成表内可复用状态，不会自动让文件缩小；
- 删除、随机插入、索引列更新和页分裂都可能形成碎片或空洞；
- 重建表能重新组织数据，但只有可独立回收的表空间通常能将多余空间返还给操作系统；
- Online DDL 依靠在线日志接收并发 DML，但仍有资源消耗和短暂 MDL；
- `INPLACE` 描述执行算法，`LOCK` 描述并发能力，二者不能混为一谈；
- 对大表执行 DDL 前，应同时评估磁盘空间、系统负载、长事务、复制延迟和最终切换风险。

## 参考资料

- [MySQL 8.4：数据字典](https://dev.mysql.com/doc/refman/8.4/en/data-dictionary.html)
- [MySQL 8.4：序列化字典信息（SDI）](https://dev.mysql.com/doc/refman/8.4/en/serialized-dictionary-information.html)
- [MySQL 8.4：CREATE TABLE 创建的文件](https://dev.mysql.com/doc/refman/8.4/en/create-table-files.html)
- [MySQL 8.4：InnoDB 系统表空间](https://dev.mysql.com/doc/refman/8.4/en/innodb-system-tablespace.html)
- [MySQL 8.4：Online DDL 操作支持矩阵](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-operations.html)
- [MySQL 8.4：Online DDL 性能与并发](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-performance.html)
- [MySQL 8.4：Online DDL 空间需求](https://dev.mysql.com/doc/refman/8.4/en/innodb-online-ddl-space-requirements.html)
- [MySQL 8.4：元数据锁](https://dev.mysql.com/doc/refman/8.4/en/metadata-locking.html)
- [MySQL 8.4：OPTIMIZE TABLE](https://dev.mysql.com/doc/refman/8.4/en/optimize-table.html)
- [MySQL 5.7：CREATE TABLE 创建的文件](https://dev.mysql.com/doc/refman/5.7/en/create-table-files.html)
