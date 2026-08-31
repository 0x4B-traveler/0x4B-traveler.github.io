---
title: '《Fluent Python》：字典、集合与映射协议'
date: '2026-08-31'
description: '整理《Fluent Python》第3章关于字典、集合、哈希、映射协议、缺失键、字典视图和专用映射类型的阅读笔记，并回答阅读中的疑问。'
domain: reading
tags: [python]
status: growing
draft: false
subcategory: python
order: 30
---

字典和集合都建立在哈希表之上，但字典表达“键到值的映射”，集合表达“唯一元素的集合”。理解哈希、映射协议和集合运算之后，很多原本需要循环与条件判断的代码，都可以写成更直接的声明式表达式。

## 字典与集合的共同基础：哈希表

字典的键和集合的元素都必须是可哈希对象。一个对象要成为可靠的哈希表元素，需要满足两个条件：

1. 在对象生命周期内，哈希值保持不变；
2. 如果两个对象相等，它们的哈希值也必须相等。

整数、字符串、字节串通常是可哈希的；列表、集合和包含不可哈希元素的元组不是：

```python
print(hash(('user-1', 42)))  # 可以计算哈希值

try:
    hash(['user-1', 42])
except TypeError as error:
    print(error)  # unhashable type: 'list'
```

不同 Python 进程中的哈希值不一定相同。字符串等类型可能启用哈希随机化，因此不能把 `hash(value)` 当作持久化 ID 或跨进程通信协议的一部分；它的主要用途是当前进程内的哈希表定位。

自定义类型默认通常可哈希，因为继承了基于对象身份的 `__hash__` 和 `__eq__`。如果重写 `__eq__`，就必须保证 `__hash__` 仍然符合规则，而且参与比较与哈希的属性在对象作为键期间不能改变：

```python
class User:
    def __init__(self, user_id):
        self.user_id = user_id

    def __eq__(self, other):
        return isinstance(other, User) and self.user_id == other.user_id

    def __hash__(self):
        return hash(self.user_id)


users = {User(1): 'Alice'}
print(users[User(1)])  # Alice
```

如果 `user_id` 在对象成为字典键后被修改，字典可能再也无法通过新的或旧的键找到它。因此，哈希键应尽量由不可变状态定义。

## 映射协议与鸭子类型

函数通常不必要求参数必须是具体的 `dict`。如果函数只需要“通过键读取值”这一能力，可以依赖 `collections.abc.Mapping` 所代表的映射接口：

```python
from collections.abc import Mapping


def read_host(config: Mapping):
    return config['host']


print(read_host({'host': 'localhost'}))  # localhost
```

这种写法表达的是能力，而不是实现类型。只要对象满足映射接口，就有机会被函数使用；这通常比 `type(config) is dict` 或只接受具体 `dict` 更灵活。

映射的构造和 `update()` 也体现了鸭子类型：如果参数有 `keys()` 方法，就按映射处理；否则会尝试把它当作键值对可迭代对象：

```python
config = dict([('host', 'localhost'), ('port', 3306)])
config.update({'debug': True})
config.update([('timeout', 3)])

print(config)
# {'host': 'localhost', 'port': 3306, 'debug': True, 'timeout': 3}
```

因此，`dict()` 和 `update()` 不只接受另一个字典，也接受映射、键值对序列和关键字参数。

## 字典推导式

字典推导式从可迭代对象生成键值对，适合把已有数据转换成查找表：

```python
words = ['python', 'go', 'rust']
lengths = {word: len(word) for word in words}

print(lengths)  # {'python': 6, 'go': 2, 'rust': 4}
```

如果多个元素产生同一个键，后面的值会覆盖前面的值。因此，使用字典推导式时要确认键是否真的应该唯一。

## 缺失键：`defaultdict` 与 `__missing__`

普通字典通过 `d[key]` 访问不存在的键时会抛出 `KeyError`。`collections.defaultdict` 可以接受一个可调用对象作为 `default_factory`，在 `__getitem__` 遇到缺失键时创建默认值：

```python
from collections import defaultdict

groups = defaultdict(list)
for name, department in [('Alice', 'infra'), ('Bob', 'app')]:
    groups[department].append(name)

print(groups['infra'])  # ['Alice']
print(groups['missing'])  # []，访问时创建了这个键
```

访问 `groups['missing']` 会完成三步：调用 `list()` 创建列表，把列表放入字典，再返回这个列表的引用。`default_factory` 只服务于 `d[key]`：

```python
groups = defaultdict(list)
print(groups.get('missing'))  # None，不创建键
print('missing' in groups)    # False
groups['missing']
print('missing' in groups)    # True
```

`dict` 子类还可以通过定义 `__missing__` 定制缺失键行为：

```python
class WordLengths(dict):
    def __missing__(self, word):
        length = len(word)
        self[word] = length
        return length


lengths = WordLengths()
print(lengths['Python'])  # 6
print(lengths)            # {'Python': 6}
```

这里 `d[key]` 会触发 `__missing__`，但 `get()` 是否触发它取决于具体映射类的实现。继承 `dict`、`collections.UserDict` 或 `collections.abc.Mapping` 时，相关方法的调用链并不完全相同，不能只看方法名称猜测行为。

## 字典视图：动态且支持集合运算

`dict.keys()`、`dict.values()` 和 `dict.items()` 返回的是动态视图，不是创建时的静态列表。原字典更新后，已有视图也会看到变化：

```python
prices = {'book': 30}
keys = prices.keys()
prices['pen'] = 5

print(keys)  # dict_keys(['book', 'pen'])
```

`dict_keys` 和 `dict_items` 还支持许多集合运算，因此可以直接比较两个字典的键：

```python
left = {'id': 1, 'name': 'Alice', 'role': 'admin'}
right = {'id': 1, 'name': 'Alice', 'email': 'a@example.com'}

print(left.keys() & right.keys())
# {'id', 'name'}
print(left.keys() - right.keys())
# {'role'}
```

键一定是可哈希的，所以 `dict_keys` 总能参与集合运算；`dict_items` 只有在所有值也可哈希时，才能安全地参与需要哈希元素的集合运算。

## 字典顺序与去重

现代 Python 的普通 `dict` 保留插入顺序，但这不改变它作为映射的主要用途。要去除重复项并保留首次出现顺序，可以利用字典键的唯一性：

```python
items = ['go', 'python', 'go', 'rust', 'python']
unique = list(dict.fromkeys(items))

print(unique)  # ['go', 'python', 'rust']
```

这里不需要手写“是否见过”的集合和循环，字典负责唯一性，插入顺序负责保留首次出现的位置。

## 专用映射类型

### `OrderedDict` 与 LRU 缓存

普通字典保留插入顺序，但 `OrderedDict` 提供了更直接的重新排序操作，例如 `move_to_end()` 和可指定方向的 `popitem()`。因此，当“频繁调整顺序”本身是核心需求时，`OrderedDict` 仍然有价值。

LRU（Least Recently Used，最近最少使用）缓存会优先淘汰最久没有访问的数据：

```python
from collections import OrderedDict


cache = OrderedDict()


def remember(key, value, limit=2):
    cache[key] = value
    cache.move_to_end(key)
    if len(cache) > limit:
        cache.popitem(last=False)


remember('a', 1)
remember('b', 2)
remember('a', 10)  # a 被访问，移动到末端
remember('c', 3)   # b 最久未使用，被淘汰
print(cache)       # OrderedDict([('a', 10), ('c', 3)])
```

这也是“适合构建 LRU 缓存”的原因：重新排列和从两端删除是它的直接操作目标。

### `ChainMap` 与嵌套作用域

`ChainMap` 不复制输入映射，而是保存多个映射的引用；查找时按传入顺序从前往后查找，更新和插入默认只作用于第一个映射：

```python
from collections import ChainMap

defaults = {'theme': 'light', 'timeout': 30}
local = {'theme': 'dark'}
settings = ChainMap(local, defaults)

print(settings['theme'])    # dark
print(settings['timeout'])  # 30
settings['timeout'] = 10
print(defaults['timeout'])  # 30
print(local['timeout'])     # 10
```

这种行为很适合模拟解释器中的嵌套作用域：内层映射覆盖外层映射，但写入只改变当前作用域。

### `Counter`：计数映射

`Counter` 是以元素为键、以出现次数为值的映射，也可以理解为多重集：

```python
from collections import Counter

counts = Counter('banana')
print(counts['a'])       # 3
print(counts.most_common(2))  # [('a', 3), ('n', 2)]
```

它还支持计数的加减，适合词频统计、资源清单和 Top-N 计数问题。

### `MappingProxyType`：动态只读代理

`types.MappingProxyType` 把一个映射包装成只读代理。代理不能直接修改数据，但会动态反映原映射的变化：

```python
from types import MappingProxyType

settings = {'debug': False}
view = MappingProxyType(settings)
settings['debug'] = True

print(view['debug'])  # True
try:
    view['debug'] = False
except TypeError as error:
    print(error)  # 'mappingproxy' object does not support item assignment
```

它是只读视图，不是深层不可变副本；如果原映射仍然可修改，代理看到的内容也会变化。

### `UserDict` 与 `shelve`

如果要扩展映射行为，`collections.UserDict` 通过组合内部 `data` 字典实现，通常比直接继承内置 `dict` 更容易控制方法之间的调用关系，也能减少内置实现捷径带来的意外递归。

需要持久化简单键值数据时，标准库的 `shelve` 提供了类似字典的接口：键必须是字符串，值通过 `pickle` 序列化，并且 `Shelf` 支持上下文管理器：

```python
import shelve

with shelve.open('settings.db') as shelf:
    shelf['theme'] = {'name': 'dark'}

with shelve.open('settings.db') as shelf:
    print(shelf['theme'])  # {'name': 'dark'}
```

`shelve` 适合简单的本地持久化，不应直接当作并发数据库或不可信数据的安全反序列化方案。

## 集合：唯一性与集合论运算

`set` 和 `frozenset` 也基于哈希表。`set` 可变，`frozenset` 不可变且可哈希，所以 `frozenset` 可以作为另一个集合的元素：

```python
groups = {frozenset({'read', 'write'}), frozenset({'read'})}
print(frozenset({'read'}) in groups)  # True
```

集合运算可以把算法意图直接写出来：

```python
a = {'python', 'go', 'rust'}
b = {'go', 'java', 'rust'}

print(a | b)  # 并集
print(a & b)  # 交集
print(a - b)  # 差集
print(a ^ b)  # 对称差集
```

方法形式还可以接受其他可迭代对象，例如 `a.union(list_b)`；中缀运算符通常要求两侧都是集合类型：

```python
print(a.union(['java', 'kotlin']))  # {'python', 'go', 'rust', 'java', 'kotlin'}
```

集合的成员测试通常很快，但集合没有序列式索引。添加元素后，哈希表扩容可能改变遍历顺序，因此不应依赖集合的显示顺序。

## 阅读疑问与标准答案

### 只有集合支持集合运算吗？列表支持吗？

标准答案：集合类型直接提供 `|`、`&`、`-`、`^` 等集合运算；列表没有这些集合运算符。列表可以通过转换为集合，或使用列表推导式实现类似逻辑，但会涉及顺序、重复元素和元素可哈希性等额外问题：

```python
left = [1, 2, 2, 3]
right = [2, 3, 4]

print(set(left) & set(right))  # {2, 3}
```

这个结果丢失了列表顺序和重复项。如果业务要求保留顺序，就不能无条件用 `set` 替代列表，需要明确选择去重规则。

### 同一个进程多次运行，集合的输出顺序是固定的吗？

标准答案：对于未改变的集合，在同一个进程中重复遍历时，顺序通常保持不变；但这不是集合提供的语义保证。添加或删除元素可能触发哈希表调整，导致已有元素的相对顺序变化；不同进程还可能因为哈希随机化得到不同顺序。

```python
values = {'apple', 'banana', 'cherry'}
print(list(values))
print(list(values))  # 当前状态未改变时通常相同，但不要依赖这一点
```

需要稳定顺序时，应使用列表、排序后的列表，或直接使用保序的数据结构；不要把集合遍历顺序当作业务逻辑。

### 什么是表驱动设计？

标准答案：表驱动设计是把“条件到行为”的规则放入字典、列表或其他数据表中，用查表替代大量 `if/elif` 或 `switch` 分支。它适合规则相对稳定、键和值关系清晰的场景：

```python
HANDLERS = {
    'GET': lambda path: f'read {path}',
    'DELETE': lambda path: f'delete {path}',
}


def dispatch(method, path):
    try:
        handler = HANDLERS[method]
    except KeyError:
        raise ValueError(f'unsupported method: {method}') from None
    return handler(path)


print(dispatch('GET', '/books'))  # read /books
```

表驱动设计的优点是新增规则时通常只需增加表项；缺点是规则复杂、需要顺序判断或存在大量副作用时，强行塞进字典可能反而降低可读性。

## 小结

本章可以归纳为四条经验：

1. 字典和集合依赖哈希表，键和元素必须满足可哈希契约；
2. 面向 `Mapping` 等抽象接口编程，比限定具体的 `dict` 更符合鸭子类型；
3. `defaultdict`、`__missing__`、字典视图、`ChainMap`、`Counter` 和 `MappingProxyType` 分别解决缺失键、动态观察、作用域、计数和只读代理问题；
4. 集合运算和表驱动设计可以减少循环与条件分支，但必须先确认是否允许丢失顺序和重复元素。

选择数据结构时，不仅要问“能不能存下这些数据”，还要问“主要操作是什么”：按键查找用字典，唯一性与成员测试用集合，频繁重新排序用 `OrderedDict`，嵌套配置查找用 `ChainMap`，计数用 `Counter`，简单本地持久化才考虑 `shelve`。
