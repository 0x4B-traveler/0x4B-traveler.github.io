---
title: '《Fluent Python》：对象引用、可变性与垃圾回收'
date: '2026-09-07'
description: '从身份、相等性、共享传参、浅拷贝、深拷贝、弱引用到垃圾回收，理解 Python 对象模型中的引用关系与可变性边界。'
domain: reading
tags: [python, object-model, memory, fluent-python]
status: growing
draft: false
subcategory: python
order: 22
---

Python 变量并不是装值的盒子，更准确地说，它们是对象的引用或名称绑定。第 6 章围绕一个容易产生误解的问题展开：当多个变量、容器或函数参数指向同一个对象时，修改其中一个名字所指向的对象，会不会影响其他地方？

理解这个问题，需要把“对象身份”“对象的值”“对象是否可变”以及“对象何时被回收”区分开。否则，浅拷贝、默认参数、元组嵌套列表和多线程共享状态都会产生看似奇怪的结果。

## 变量保存的是引用，不是对象本身

```python
numbers = [1, 2, 3]
alias = numbers

alias.append(4)

print(numbers)       # [1, 2, 3, 4]
print(alias)         # [1, 2, 3, 4]
print(numbers is alias)  # True
```

`numbers` 和 `alias` 是两个名字，但它们绑定到同一个列表对象。`append` 修改的是对象本身，所以通过任意一个名字都能观察到变化。

如果重新绑定其中一个名字，情况就不同：

```python
alias = ['new']

print(numbers)       # [1, 2, 3, 4]
print(alias)         # ['new']
print(numbers is alias)  # False
```

重新绑定只是让 `alias` 指向另一个对象，并没有修改原列表。可以把“修改对象”和“改变名字绑定”看作两种不同操作。

## `is` 与 `==`：身份和相等性不是一回事

`is` 比较两个引用是否指向同一个对象；`==` 比较两个对象的值是否相等，并且可以通过 `__eq__` 自定义：

```python
left = [1, 2, 3]
right = [1, 2, 3]

print(left == right)  # True，内容相同
print(left is right)  # False，不是同一个列表
```

比较单例时，最常见的场景是判断 `None`：

```python
value = None

if value is None:
    print('没有提供值')
```

不要用 `value == None` 代替 `value is None`。`==` 可能被用户自定义的 `__eq__` 重载，而 `None` 是唯一的单例对象，`is` 表达的是准确的身份判断。

### 不要依赖整数和字符串的驻留

CPython 可能会驻留部分字符串和小整数，以减少重复对象的创建：

```python
a = 'python'
b = 'python'
print(a == b)  # True
```

但这属于解释器的优化细节，不应作为业务逻辑依据。对字符串和数值比较内容时使用 `==`，只有确实要判断同一对象时才使用 `is`。

## 可变与不可变：不可变的是对象结构，不一定是嵌套对象

常见不可变对象包括 `int`、`float`、`str`、`tuple` 和 `frozenset`；`list`、`dict`、`set` 以及大多数用户自定义类的实例默认是可变的。

```python
name = 'Alice'
original_id = id(name)
name += ' Smith'

print(name)                 # Alice Smith
print(id(name) == original_id)  # False
```

字符串不能原地追加，`+=` 会创建新字符串并让变量重新绑定。

列表则通常会原地修改：

```python
items = [1, 2]
original_id = id(items)
items += [3]

print(items)                   # [1, 2, 3]
print(id(items) == original_id)  # True
```

元组的不可变性也需要精确理解。元组不能替换其中保存的引用，但引用指向的对象仍然可能可变：

```python
record = ('Alice', ['Python'])
record[1].append('SQL')

print(record)  # ('Alice', ['Python', 'SQL'])
```

这里没有改变元组第二个位置保存的引用，只改变了引用所指向的列表。真正需要递归不可变的数据结构时，嵌套部分也应该使用元组、字符串或 `frozenset` 等不可变对象。

## 函数参数是“共享传参”

Python 函数参数接收的是实参引用的副本。形参和实参是两个名字，但它们开始时可能指向同一个对象：

```python
def add_item(items: list[str]) -> None:
    items.append('new')


names = ['Alice']
add_item(names)
print(names)  # ['Alice', 'new']
```

函数可以修改传入的可变对象，但不能通过重新绑定形参替换调用方的变量：

```python
def replace_items(items: list[str]) -> None:
    items = ['inside']


names = ['outside']
replace_items(names)
print(names)  # ['outside']
```

这不是“按引用传递”或“按值传递”二选一能完整描述的规则。更准确的说法是：函数获得了对象引用的副本，因此可以通过这份引用修改可变对象，但重新绑定形参不会影响调用方的名字。

### API 要明确是否会修改调用者的数据

如果函数会原地修改参数，调用者必须能够预期这一点：

```python
def normalize_in_place(values: list[str]) -> None:
    values[:] = [value.strip().lower() for value in values]


values = [' Python ', ' SQL ']
normalize_in_place(values)
print(values)  # ['python', 'sql']
```

如果调用方可能希望保留原数据，可以返回一个新对象：

```python
def normalized(values: list[str]) -> list[str]:
    return [value.strip().lower() for value in values]
```

这体现了“最少惊讶原则”：函数的副作用越明显、越容易改变调用方状态，就越应该在命名、文档和返回值上表达清楚。

## 可变默认参数是经典陷阱

函数默认参数只在函数定义时计算一次，因此不能把可变对象直接作为默认值：

```python
def add_tag(tag: str, tags: list[str] = []) -> list[str]:
    tags.append(tag)
    return tags


print(add_tag('python'))  # ['python']
print(add_tag('sql'))     # ['python', 'sql']，共享了上一次调用的数据
```

正确做法是使用 `None` 作为哨兵，在每次调用中创建新的列表：

```python
def add_tag(tag: str, tags: list[str] | None = None) -> list[str]:
    if tags is None:
        tags = []
    tags.append(tag)
    return tags
```

这里的 `None` 不是业务上的标签列表，而是“调用者没有提供参数”的明确标记。它把默认对象的创建时间推迟到了函数调用时。

## 浅拷贝：只复制最外层

构造函数、切片和 `copy.copy` 通常创建的是浅拷贝：外层容器是新的，内部元素仍然共享：

```python
import copy

source = [['a'], ['b']]
by_slice = source[:]
by_copy = copy.copy(source)

source[0].append('changed')

print(source)    # [['a', 'changed'], ['b']]
print(by_slice)  # [['a', 'changed'], ['b']]
print(by_copy)   # [['a', 'changed'], ['b']]
print(source is by_slice)       # False
print(source[0] is by_slice[0]) # True
```

浅拷贝适合内部元素本来就应该共享，或者只需要复制容器结构的场景，例如复制一份待处理队列但共享其中不可变的任务描述。

## 深拷贝：递归复制，但不是默认答案

`copy.deepcopy` 会递归复制嵌套对象：

```python
import copy

source = [['a'], ['b']]
clone = copy.deepcopy(source)

source[0].append('changed')

print(source)  # [['a', 'changed'], ['b']]
print(clone)   # [['a'], ['b']]
```

深拷贝可以解决嵌套可变对象的共享问题，但会消耗更多 CPU 和内存，也可能复制不该复制的资源。文件句柄、线程锁、数据库连接和包含外部资源的对象都不适合简单地交给 `deepcopy`。

更稳妥的选择顺序通常是：

1. 优先使用不可变对象，减少共享状态；
2. 如果结构简单，显式构造需要的副本；
3. 确实需要通用递归复制时再使用 `deepcopy`；
4. 对复杂类通过 `__copy__` 和 `__deepcopy__` 明确复制策略。

### 显式复制通常比盲目深拷贝更清晰

```python
from dataclasses import dataclass


@dataclass
class Job:
    name: str
    tags: list[str]


def copy_job(job: Job) -> Job:
    return Job(job.name, list(job.tags))
```

这个函数只复制真正需要独立拥有的列表，并明确表达了哪些字段共享、哪些字段复制。

## 引用计数与循环引用

在 CPython 中，垃圾回收主要依靠引用计数。对象不再有任何强引用时，引用计数归零，通常会立即释放：

```python
class Resource:
    def __del__(self) -> None:
        print('resource released')


resource = Resource()
del resource
# 通常会看到 resource released
```

但循环引用会让简单的引用计数失效：

```python
class Node:
    pass


left = Node()
right = Node()
left.other = right
right.other = left

del left
del right
```

两个对象互相引用，即使外部已经没有名字指向它们，计数也不一定直接归零。CPython 的分代垃圾回收器会额外检测这类不可达的引用循环并回收它们。

实际开发中不要依赖 `__del__` 管理文件、锁或数据库连接。显式关闭资源更可靠，文件资源尤其应该使用 `with`：

```python
with open('data.txt', encoding='utf-8') as file:
    content = file.read()
```

即使读取或处理过程中抛出异常，`with` 也会执行上下文管理器的清理逻辑。

## 弱引用：引用对象，但不阻止回收

强引用会延长对象生命周期；弱引用只观察对象，不增加引用计数。缓存是弱引用常见的使用场景：缓存不应为了保留索引而阻止对象被回收。

```python
import weakref


class Image:
    pass


image = Image()
cache = weakref.WeakValueDictionary()
cache['logo'] = image

print('logo' in cache)  # True
del image
print('logo' in cache)  # False，目标对象没有其他强引用后被移除
```

`WeakValueDictionary`、`WeakKeyDictionary`、`WeakSet` 和 `weakref.finalize` 都建立在这个机制之上。弱引用不是“更安全的普通引用”，而是用于表达“只要对象还有其他使用者，就暂存；对象自然消失时，关联记录也应消失”的关系。

## 多线程中的可变对象

可变对象共享方便，但也会增加并发编程的复杂度。一个线程正在读取列表时，另一个线程可能修改它；缺少同步会导致数据竞争，过度加锁又可能造成死锁。

```python
from threading import Lock


balance = 0
lock = Lock()


def deposit(amount: int) -> None:
    global balance
    with lock:
        balance += amount
```

更好的设计往往不是到处加锁，而是减少共享可变状态：使用不可变消息、线程安全队列、单一所有者或清晰的状态转移边界。

## 小结

第 6 章可以归纳为几条实践规则：

- `is` 比较身份，`==` 比较值；判断 `None` 使用 `is None`；
- 变量和参数是对象的引用，重新绑定与修改对象是两件事；
- 函数参数采用共享传参，传入可变对象时要明确副作用；
- 不要使用可变对象作为默认参数；
- 浅拷贝只复制外层，深拷贝递归复制但成本更高；
- 元组不可变的是其中保存的引用，嵌套可变对象仍然可以改变；
- CPython 主要依靠引用计数，同时用分代回收处理循环引用；
- 文件等外部资源使用 `with` 显式管理，不要依赖垃圾回收时机；
- 弱引用适合缓存和观察关系，不适合替代所有普通引用。

真正成熟的 API 设计，不是完全禁止可变对象，而是让“谁拥有对象、谁可以修改、修改是否可见、何时释放资源”都变得明确。
