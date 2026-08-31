---
title: '《Fluent Python》：序列、拆包与模式匹配'
date: '2026-08-30'
description: '整理 Python 内置序列、推导式、元组、拆包、模式匹配、切片、增量赋值、排序和专用容器的核心知识。'
domain: reading
tags: [python]
status: growing
draft: false
subcategory: python
order: 20
---

Python 提供了统一的序列接口，也提供了 `list`、`tuple`、`array`、`deque` 等适合不同场景的实现。理解序列的存储方式、可变性和使用场景，有助于避免把所有数据都放进列表，也有助于理解拆包、切片和模式匹配等语法背后的协议。

## 序列类型的分类

Python 的序列可以从两个相互独立的维度理解。

按元素的存储方式划分：

- **容器序列**保存的是对象引用，例如 `list`、`tuple` 和 `collections.deque`，因此可以容纳不同类型的对象；
- **扁平序列**直接在自身内存中保存值，例如 `str`、`bytes` 和 `array.array`，通常只能保存一种基础类型，但内存更紧凑。

按是否允许修改划分：

- **可变序列**包括 `list`、`bytearray`、`array.array` 和 `deque`；
- **不可变序列**包括 `tuple`、`str` 和 `bytes`。

这两个维度不能混为一谈。元组是不可变的容器序列：元组保存的引用不能被替换，但引用指向的可变对象仍然可能发生变化。数组则是可变的扁平序列：其中的数值可以修改，但元素类型必须一致。

```python
record = (1, ['Python'])
record[1].append('Sequence')

print(record)  # (1, ['Python', 'Sequence'])
```

因此，选择序列时需要同时考虑数据是否同质、是否需要修改、是否在意连续内存，以及它承担的是记录还是集合的角色。

并不是所有“可以逐项遍历”的容器都是序列。`set` 也是可迭代对象，但没有稳定的整数索引；如果主要操作是判断成员是否存在，尤其是数据量较大时，集合通常比列表更合适：

```python
allowed = {'read', 'write', 'delete'}
print('write' in allowed)  # True

for operation in allowed:
    print(operation)  # 顺序不应作为程序逻辑的依据
```

集合基于哈希表优化成员检查，但不承诺像列表那样按插入位置提供序列访问。因此，“可迭代”与“序列”是两个不同的概念。

可以用同一组数据直观看到两种序列的修改方式：

```python
from array import array

items = [1, 2, 3]
numbers = array('i', items)

items[0] = 99
numbers[0] = 88
print(items)    # [99, 2, 3]
print(numbers)  # array('i', [88, 2, 3])
```

列表和数组都可变，但列表可以混合不同类型，数组则要求元素符合声明的类型码；这正是“通用性”和“紧凑存储”之间的取舍。

## 列表推导式与生成器表达式

列表推导式的目标很明确：从一个或多个可迭代对象构建新列表。

```python
symbols = '$¢£¥€¤'
codes = [ord(symbol) for symbol in symbols if ord(symbol) > 127]
```

它通常比 `map` 与 `filter` 的组合更直观，因为转换表达式和过滤条件都写在同一个语法结构中。推导式也有自己的局部作用域，循环变量不会泄漏到外层。

当推导式包含多个 `for` 子句时，可以表达笛卡儿积。子句顺序与等价的嵌套循环顺序一致：

```python
colors = ['black', 'white']
sizes = ['S', 'M', 'L']

tshirts = [
    (color, size)
    for color in colors
    for size in sizes
]
```

如果最终目标不是列表，或者不希望一次性创建全部结果，优先使用生成器表达式：

```python
codes = tuple(ord(symbol) for symbol in symbols)
```

生成器表达式逐项产出结果，可以直接交给 `tuple`、`array.array`、`sum` 等接收可迭代对象的构造器或函数。选择原则可以概括为：立即构建列表用列表推导式，按需消费或构建其他类型用生成器表达式。

## 元组的双重角色

元组既可以表示不可变序列，也可以表示没有字段名的记录。

作为记录时，每个位置都有独立含义，元素数量和顺序就是数据结构的一部分：

```python
traveler = ('Shanghai', 31.2304, 121.4737)
city, latitude, longitude = traveler
```

作为不可变序列时，元组更像不能增删元素的列表。它通常比同长度列表占用更少的浅层内存，而且解释器知道其长度固定。不过，只有当元组中的所有元素都可哈希时，元组本身才能作为字典键或集合元素。

```python
rgb = (255, 128, 0)
rgb[0] = 0  # TypeError: 'tuple' object does not support item assignment
```

不可变性保护的是元组中的元素引用，不能把第一个引用替换掉；它并不等于“递归冻结所有嵌套对象”。

当记录字段较多、需要跨函数传递，或者位置含义不够明显时，应考虑 `typing.NamedTuple` 或数据类，而不是让调用者记忆每个下标的语义。

## 序列和可迭代对象拆包

拆包可以让接收端变量直接表达数据结构，避免手动通过索引逐项提取。它适用于所有可迭代对象，并不要求对象支持 `[]` 索引。

```python
name, age, city = ('Alice', 30, 'Shanghai')
```

只要对象能够逐项产出值，就能参与拆包。这种写法减少了索引操作，也能让变量名称直接说明每个位置的含义。

因此，拆包不要求右侧对象支持整数索引，生成器也可以参与：

```python
def values():
    yield 'Alice'
    yield 30


name, age = values()
print(name, age)  # Alice 30
```

### 平行赋值与交换变量

```python
latitude, longitude = 31.2304, 121.4737
latitude, longitude = longitude, latitude
```

赋值语句右侧会先构建或计算结果，再把值拆给左侧目标，因此交换变量不需要临时变量。

### 使用星号捕获多余元素

普通拆包要求两侧元素数量一致。星号目标可以接收剩余元素，并且结果总是列表：

```python
first, *middle, last = range(6)

print(first)   # 0
print(middle)  # [1, 2, 3, 4]
print(last)    # 5
```

一个拆包表达式中只能有一个星号目标，但它可以出现在任意位置：

```python
head, *tail = range(4)
*head, tail = range(4)
```

### 在函数调用和字面量中使用星号

函数调用中的 `*` 会把可迭代对象拆成位置参数；`**` 会把映射拆成关键字参数：

```python
def point(x, y):
    return x, y

coordinates = (10, 20)
options = {'x': 30, 'y': 40}

point(*coordinates)
point(**options)
```

在序列字面量中，星号也可以拆开多个可迭代对象：

```python
numbers = [*range(3), 10, *range(20, 23)]
# [0, 1, 2, 10, 20, 21, 22]
```

### 嵌套拆包

只要左侧结构与数据结构一致，就可以一次拆出嵌套记录：

```python
metro = ('Tokyo', 'JP', (35.6897, 139.6922))
name, country, (latitude, longitude) = metro
```

嵌套拆包适合结构稳定的数据。面对外部输入或可能演化的协议时，应先验证结构，避免让晦涩的 `ValueError` 代替明确的输入检查。

## 序列模式匹配

Python 3.10 引入的 `match`/`case` 可以把序列拆包与分支判断结合起来。序列模式关注的是结构，而不要求被匹配对象必须是某个具体类型。

```python
def handle(command):
    match command:
        case ['GET', path]:
            return f'read {path}'
        case ['PUT', path, payload]:
            return f'write {payload!r} to {path}'
        case ['DELETE', path]:
            return f'delete {path}'
        case _:
            raise ValueError('unsupported command')
```

```python
print(handle(['GET', '/books']))           # read /books
print(handle(('DELETE', '/books/1')))      # delete /books/1
```

模式中的列表写法并不表示只接受 `list`；符合序列模式协议的元组等对象也能匹配。`str`、`bytes` 和 `bytearray` 会被当作原子值，不会按字符或字节自动拆成序列模式。

模式可以嵌套，也可以用 `*` 捕获剩余部分：

```python
def describe(record):
    match record:
        case [name, _, (latitude, longitude)] if longitude > 0:
            return f'{name}: eastern hemisphere'
        case [name, *details]:
            return f'{name}: {len(details)} extra fields'
        case _:
            return 'unknown record'
```

守卫条件 `if` 应当只补充结构模式难以表达的约束。模式从上到下匹配，因此具体分支应放在宽泛分支之前。

## 切片

Python 的切片和 `range` 都采用左闭右开区间，不包含终点。这个设计带来几个实际好处：

- 只给出终点时，切片长度就是终点值，例如 `items[:3]` 长度为 3；
- 同时给出起点和终点时，长度容易计算为 `stop - start`；
- 相邻切片可以在同一边界无缝分割，例如 `items[:3]` 与 `items[3:]`。

```python
items = list(range(10))

first_half = items[:5]
second_half = items[5:]
every_second = items[::2]

print(first_half)   # [0, 1, 2, 3, 4]
print(second_half)  # [5, 6, 7, 8, 9]
print(every_second) # [0, 2, 4, 6, 8]
```

第三个参数是步长。步长为负数时可以反向读取，例如 `items[::-1]` 会生成一个倒序的新列表；切片通常产生新对象，不会改变原列表。

### 切片对象

`a:b:c` 会被解释为 `slice(a, b, c)`。因此可以给常用字段区间命名，让固定宽度文本解析更容易阅读：

```python
NAME = slice(0, 10)
PRICE = slice(10, 16)

line = 'Keyboard  199.00'
name = line[NAME].strip()
price = line[PRICE].strip()
```

### 多维切片与省略号

表达式 `matrix[i, j]` 会把 `(i, j)` 这个元组交给对象的 `__getitem__`。NumPy 等库据此实现多维索引和切片。省略号 `...` 是内置的 `Ellipsis` 对象，可表示未明确写出的多个维度：

```python
# NumPy 风格示意
image[..., 0]  # 选取所有前置维度的第 0 个通道
```

原生 `list` 不支持多维索引；这里描述的是第三方数组或自定义类型可以实现的协议。

### 给切片赋值

可变序列允许通过切片一次替换、删除或插入多个元素：

```python
numbers = list(range(10))
numbers[2:5] = [20, 30]
del numbers[::2]
```

切片赋值右侧必须是可迭代对象。即使只插入一个值，也需要写成单元素列表或其他可迭代对象。

例如，整数 `100` 本身不可迭代，不能直接作为切片赋值的右侧对象；即使只替换为一个元素，也要把它放进单元素列表中：

```console
>>> l = [0, 1, 2, 3, 4, 22, 9]
>>> l[2:5] = 100  # ❶
Traceback (most recent call last):
   File "<stdin>", line 1, in <module>
TypeError: can only assign an iterable
>>> l[2:5] = [100]
>>> l
[0, 1, 100, 22, 9]
```

❶ 切片赋值会迭代右侧对象，并用迭代出的元素替换切片，因此右侧必须提供一个可迭代对象。单元素列表 `[100]` 满足这一要求；元组 `(100,)` 等其他可迭代对象也可以。

## 序列的加法和乘法

对序列使用 `+` 或 `*` 通常会创建新序列，不修改原对象：

```python
base = [1, 2]
combined = base + [3, 4]
repeated = base * 3
print(combined)  # [1, 2, 3, 4]
print(repeated)  # [1, 2, 1, 2, 1, 2]
```

这些操作是浅复制。重复嵌套的可变对象时，多个位置可能指向同一个对象，这是构建二维列表时最常见的陷阱：

```python
wrong_board = [['_'] * 3] * 3
wrong_board[0][0] = 'X'

# 三行的第一个位置都会改变，因为三行引用同一个列表。
```

正确做法是让每轮推导式创建一个独立列表：

```python
board = [['_'] * 3 for _ in range(3)]
board[0][0] = 'X'
print(board)  # [['X', '_', '_'], ['_', '_', '_'], ['_', '_', '_']]
```

## 序列的增量赋值

`+=` 会优先尝试调用 `__iadd__`。如果类型没有实现原地加法，解释器会回退到 `__add__`，创建新对象并重新绑定变量。

```python
numbers = [1, 2]
original_id = id(numbers)
numbers += [3]

assert id(numbers) == original_id
print(numbers)  # [1, 2, 3]
```

列表通常原地扩展，而元组等不可变序列会创建新对象。因此，对不可变序列反复使用 `+=` 可能不断复制已有内容。

这一节还有一个经典陷阱：

```python
data = (1, 2, [30, 40])
data[2] += [50, 60]
```

这条语句会抛出 `TypeError`，因为解释器最终试图给元组元素重新赋值；但内部列表可能已经被 `list.__iadd__` 修改。也就是说，操作报错却留下了部分副作用。应避免把可变对象嵌在不可变容器中后，再对该位置执行增量赋值。

这也解释了为什么 `list.sort()` 返回 `None`：它表示接收者已被就地修改，而不是产生了一个新的列表。

```python
names = ['Guido', 'Ada', 'luciano']
result = names.sort(key=str.casefold)

print(names)   # ['Ada', 'Guido', 'luciano']
print(result)  # None
```

返回 `None` 的约定会阻止这类容易误读的链式调用：`names.sort().append('Grace')`。相反，`str` 的方法通常返回新字符串，所以可以在需要时形成流式调用。

## `list.sort` 与 `sorted`

`list.sort()` 原地排序列表，并返回 `None`。返回 `None` 是 Python 对原地修改方法的常见约定，提醒调用者当前对象已经改变。

```python
names = ['Guido', 'luciano', 'Ada']
names.sort(key=str.casefold)
print(names)  # ['Ada', 'Guido', 'luciano']
```

`sorted()` 接受任意可迭代对象，返回一个新的列表，不修改原数据：

```python
names = ('Guido', 'luciano', 'Ada')
ordered = sorted(names, key=str.casefold, reverse=True)
print(ordered)  # ['luciano', 'Guido', 'Ada']
```

两者都支持 `key` 和 `reverse`，并采用稳定排序：键值相同的元素会保持原有相对顺序。稳定性允许通过多次排序组合复杂规则，通常应从次要条件排到主要条件。

`key` 函数接收一个元素并返回排序依据。Python 会在排序开始时为每个元素计算一次键，之后比较的是这些键，而不是反复调用 Python 层的双参数比较函数：

```python
values = ['10', 2, '3']
key_calls = []


def as_integer(value):
    key_calls.append(value)
    return int(value)


ordered = sorted(values, key=as_integer)
print(ordered)        # [2, '3', '10']
print(len(key_calls)) # 3，每个输入项只计算一次 key
```

因此，`key` 不仅能统一混合类型的比较规则，也适合把复杂对象映射为简单的可比较值。相比自己编写双参数比较函数，使用 `key` 通常更清晰，也更容易让排序实现进行优化。

### Python 默认排序算法：Timsort

在 CPython 中，列表的 `list.sort()` 和内置函数 `sorted()` 默认使用 Timsort。Timsort 是一种稳定的、自适应的混合排序算法，核心思想是结合归并排序和插入排序的优点：

- **发现已有顺序**：从左到右扫描数据，把已经连续有序的片段称为 *run*（运行段）保存下来；
- **处理短片段**：很短的运行段会用插入排序扩展到合适的长度，因为插入排序在短数组或基本有序的数据上开销很小；
- **合并运行段**：再像归并排序一样，把多个有序运行段合并成一个整体有序序列；
- **利用部分有序性**：如果输入本来就接近有序，算法可以少做很多比较和移动，最好情况下接近 `O(n)`；最坏情况下时间复杂度为 `O(n log n)`，合并时需要额外的辅助空间。

例如，下面的数据由三个已经排好序的片段组成。Timsort 能识别这些自然运行段，再进行合并：

```python
numbers = [1, 3, 5, 7, 2, 4, 6, 8, 0, 9]
numbers.sort()

print(numbers)  # [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
```

这里并不是说调用者可以直接观察到 Timsort 的每次合并；算法会自动扫描并管理运行段。这个例子想说明的是：输入中的已有顺序不会被完全浪费，Timsort 会把它作为排序过程的一部分利用起来。

Timsort 的“稳定”也很重要。稳定排序不会打乱键值相同元素的相对顺序：

```python
students = [
    {'name': 'Alice', 'class': 'A', 'score': 90},
    {'name': 'Bob', 'class': 'A', 'score': 90},
    {'name': 'Carol', 'class': 'B', 'score': 95},
    {'name': 'Dave', 'class': 'B', 'score': 90},
]

students.sort(key=lambda student: student['score'], reverse=True)

print([student['name'] for student in students])
# ['Carol', 'Alice', 'Bob', 'Dave']
```

`Alice` 和 `Bob` 的分数相同，排序后仍然保持原来的先后顺序。利用这个性质，可以先按次要条件排序，再按主要条件排序：

```python
students.sort(key=lambda student: student['name'])   # 次要条件：姓名
students.sort(key=lambda student: student['score'], reverse=True)  # 主要条件：分数

print([(student['score'], student['name']) for student in students])
# [(95, 'Carol'), (90, 'Alice'), (90, 'Bob'), (90, 'Dave')]
```

第二次排序按分数分组时，同分学生会保留第一次按姓名排序的结果，于是同时实现了“分数降序、同分按姓名升序”。实际项目中也可以直接使用元组键表达多个条件：

```python
students = sorted(
    students,
    key=lambda student: (-student['score'], student['name']),
)
```

这两种写法都依赖稳定排序；元组键通常更紧凑，而多次稳定排序在每个排序条件需要不同方向或规则时更灵活。无论使用哪种写法，都不需要手动实现 Timsort，Python 的排序 API 会负责算法细节。

## 列表之外的序列

列表通用、方便，但通用性也意味着它不总是最节省空间或最适合特定操作。

### `array.array`：大量同类型数值

数组直接保存 C 类型数值，不为每个元素单独保存 Python 对象引用。处理大量同类型数值时，它通常比列表更节省内存，也支持从文件高效读写。

```python
from array import array

measurements = array('d', (value / 10 for value in range(1000)))
```

类型码 `'d'` 表示双精度浮点数。数组适合紧凑存储，但不提供 NumPy 那样丰富的向量化运算。

### `memoryview`：共享内存的切片

`memoryview` 的关键不是另一份数据，而是对已有缓冲区的视图。下面修改视图，底层的 `bytearray` 也会同步变化：

```python
raw = bytearray(b'abcd')
view = memoryview(raw)[1:3]

view[0] = ord('X')
print(raw)   # bytearray(b'aXcd')
print(view.tobytes())  # b'Xc'
```

这说明切片没有复制出新的字节数组。对 `array.array` 使用 `memoryview` 时，还可以通过 `cast('B')` 按字节查看同一块内存：如果原数组使用 `'h'`，每个元素通常占两个字节，所以五个元素对应十个字节；具体字节顺序由平台决定。

#### 使用 `array` 查看底层字节

`memoryview` 可以在不复制字节的情况下，以不同格式访问支持缓冲区协议的对象。它适合二进制协议、图像、音频和大型数组的局部处理。

```python
numbers = array('h', [-2, -1, 0, 1, 2])
view = memoryview(numbers)
bytes_view = view.cast('B')
```

通过视图修改数据会作用于原缓冲区。高效的代价是需要更谨慎地处理元素格式、字节序和对象生命周期。

### NumPy：数值计算与多维数组

NumPy 的 `ndarray` 提供多维数组、向量化计算、广播和高效切片。它不是标准库的一部分，但当需求从“保存数值”升级到“批量计算数值”时，通常比 Python 循环和 `array.array` 更合适。

```python
import numpy as np

values = np.arange(12).reshape(3, 4)
column_means = values.mean(axis=0)
```

NumPy 和 SciPy 的许多核心运算在 C/C++ 等本地代码中执行，部分操作会释放 CPython 的 GIL。因此，不能简单地把“Python 多线程不能并行执行 Python 字节码”推广为“所有 NumPy 运算都不能利用多核”；应以具体操作和底层库的实现为准。

### `deque`：两端高效操作

`collections.deque` 针对队首和队尾的插入、删除进行了优化：

```python
from collections import deque

recent = deque(maxlen=3)
recent.extend(['a', 'b', 'c'])
recent.append('d')

print(recent)  # deque(['b', 'c', 'd'], maxlen=3)
```

设置 `maxlen` 后，队列满时会自动丢弃另一端的旧元素，适合滑动窗口和最近记录。它不适合频繁访问中间位置；需要优先队列时应使用 `heapq`，需要线程间阻塞队列时应使用 `queue` 模块。

列表也能模拟队列，但从头部插入或删除时需要移动后续元素；`deque` 针对两端操作进行了优化：

```python
from collections import deque

queue = deque(['a', 'b'])
queue.append('c')
queue.popleft()
queue.appendleft('z')
print(queue)  # deque(['z', 'b', 'c'])
```

`deque` 的优势是两端，不是任意位置。比如列表支持 `a_list.pop(1)` 删除中间项，而 `deque` 不支持按位置高效删除；如果需要中间位置的随机访问，应重新评估数据结构。

`deque` 满载时可以通过 `maxlen` 自动丢弃旧项；如果目标是在线程之间安全通信，应该使用 `queue.SimpleQueue`、`queue.Queue`、`queue.LifoQueue` 或 `queue.PriorityQueue`。这些队列在容量受限时可以阻塞生产者，形成背压，而不是像有界 `deque` 那样静默丢弃数据：

```python
from queue import Queue

jobs = Queue(maxsize=1)
jobs.put('first')
# jobs.put('second')  # 队列已满时会等待消费者取走 first
```

如果只需要维护“当前最小项”或“前 k 大项”，不必每次都对完整列表排序，可以使用 `heapq`：

```python
import heapq

scores = [72, 99, 81, 95, 88]
print(heapq.nlargest(2, scores))  # [99, 95]
```

`heapq` 提供的是操作可变序列的函数，而不是一个队列类；它适合优先级队列和 Top-K 问题。`heapq.nlargest(k, values, key=...)` 也支持 `key` 参数。

## 序列类型的选择

| 需求 | 优先考虑 | 原因 |
| --- | --- | --- |
| 通用、异构、需要修改 | `list` | API 丰富，随机访问方便 |
| 固定结构的少量字段 | `tuple` / `NamedTuple` | 表达记录或不可变结构 |
| 不立即生成全部结果 | 生成器表达式 | 惰性计算，减少中间列表 |
| 大量同类型基础数值 | `array.array` | 紧凑存储 |
| 多维数值计算 | NumPy `ndarray` | 向量化、广播和多维切片 |
| 不复制地访问二进制缓冲区 | `memoryview` | 共享底层内存 |
| 频繁在两端增删 | `collections.deque` | 两端操作高效 |
| 文本 | `str` | Unicode 文本语义 |
| 原始二进制数据 | `bytes` / `bytearray` | 明确的字节语义 |

## 小结

序列相关内容可以归纳为三层认识：

1. **协议层**：不同序列共享迭代、索引、切片、排序等通用操作，因此很多代码不必绑定具体类型；
2. **语法层**：推导式、生成器表达式、拆包、切片和模式匹配，让数据结构可以直接映射为简洁的表达式；
3. **实现层**：容器序列与扁平序列、可变与不可变、原地操作与创建新对象，决定了内存、性能和副作用。

核心不是记住更多容器名称，而是根据数据结构和操作方式选择合适的序列。通用、异构且需要修改的数据适合列表；固定结构可以使用元组或具名记录；大量同类型数值适合数组；多维数值计算通常使用 NumPy；频繁在两端增删则适合 `deque`。

拆包、切片和模式匹配建立在统一的序列与迭代协议之上。理解原地操作、浅复制和对象引用的关系，则有助于避免二维列表共享引用、不可变容器中的可变对象以及增量赋值留下部分副作用等问题。
