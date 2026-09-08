---
title: '《Fluent Python》：函数是一等对象与高阶函数'
date: '2026-09-07'
updated: '2026-09-08'
description: '整理 Python 函数对象、可调用对象、高阶函数、lambda、归约、operator 工具、partial 与函数式编程边界。'
domain: reading
tags: [python, functions, functional-programming, fluent-python]
status: growing
draft: false
subcategory: python
order: 23
---

在 Python 中，函数不是只能被调用的一段代码，而是可以赋值、传参、放进容器、作为返回值并动态创建的对象。函数拥有这种与普通数据相似的地位，所以 Python 把函数称为一等对象。

这带来了高阶函数、装饰器、回调、策略函数和函数式风格的数据处理。但“函数是一等对象”并不意味着所有问题都应该改写成 `lambda`、`map` 或递归。好的函数式代码仍然需要可读、可测试，并且要让状态和副作用的边界清楚。

## 函数可以像数据一样被使用

```python
def square(number: int) -> int:
    return number * number


operation = square
operations = [square, abs]

print(operation(5))      # 25
print(operations[0](3))  # 9
```

函数名只是一个绑定到函数对象的名字。把 `square` 赋值给 `operation`，并不会复制一份函数；两个名字指向同一个函数对象。

函数也可以作为返回值：

```python
def make_multiplier(factor: int):
    def multiply(number: int) -> int:
        return number * factor

    return multiply


double = make_multiplier(2)
print(double(21))  # 42
```

`multiply` 访问了外层函数的 `factor`。即使 `make_multiplier` 已经返回，生成的函数仍然保留对 `factor` 的访问能力，这就是闭包的基础。

## 可调用对象不只有用户定义函数

可以调用的对象都可以通过 `callable()` 检查：

```python
def greet(name: str) -> str:
    return f'Hello, {name}'


class Greeter:
    def __call__(self, name: str) -> str:
        return f'Hi, {name}'


print(callable(greet))       # True
print(callable(Greeter))     # True，调用类会创建实例
print(callable(Greeter()))   # True，实例实现了 __call__
print(callable('text'))      # False
```

Python 中常见的可调用对象包括：用户定义函数、内置函数、方法、类、实现 `__call__` 的实例、生成器函数、原生协程函数和异步生成器函数等。

不过，调用生成器函数得到的是生成器对象，调用原生协程函数得到的是协程对象，它们还需要被迭代或交给异步框架处理，并不会立刻得到最终业务数据：

```python
def numbers():
    yield 1
    yield 2


result = numbers()
print(result)  # generator object
print(list(result))  # [1, 2]
```

## 高阶函数：接收或返回函数

接收函数作为参数，或者返回函数的函数，称为高阶函数。排序就是最常见的例子：

```python
users = [
    {'name': 'Bob', 'age': 30},
    {'name': 'Alice', 'age': 25},
]

users.sort(key=lambda user: user['age'])
print([user['name'] for user in users])  # ['Alice', 'Bob']
```

这里的 `key` 参数接收一个函数，并让排序算法通过它提取比较依据。高阶函数的价值在于把“如何处理”作为参数传入，从而把遍历框架和具体策略分开。

## `map`、`filter` 与生成器表达式

`map` 把函数应用到每个元素，`filter` 保留满足条件的元素。在 Python 3 中，它们返回惰性的迭代器：

```python
numbers = range(6)
squares = map(lambda number: number * number, numbers)
even = filter(lambda number: number % 2 == 0, numbers)

print(list(squares))  # [0, 1, 4, 9, 16, 25]
print(list(even))     # [0, 2, 4]
```

对于简单转换和过滤，生成器表达式通常更直观：

```python
squares = (number * number for number in range(6))
even = (number for number in range(6) if number % 2 == 0)
```

列表推导式、生成器表达式可以同时表达映射和过滤，因此减少了对 `map`、`filter` 和匿名函数的需求。需要把已有函数组合起来，或者需要把函数作为参数传递给通用 API 时，`map` 和 `filter` 仍然很有用。

## `reduce`、`sum`、`all` 与 `any`

归约函数把多个输入逐步合并成一个结果。`functools.reduce` 可以表达这种过程：

```python
from functools import reduce


product = reduce(lambda left, right: left * right, [1, 2, 3, 4])
print(product)  # 24
```

但 `reduce` 容易把简单逻辑写得不透明。对于常见任务，应该优先使用含义更明确的内置函数：

```python
numbers = [1, 2, 3, 4]

print(sum(numbers))               # 10
print(all(number > 0 for number in numbers))  # True
print(any(number > 3 for number in numbers))  # True
```

空迭代对象也有明确的逻辑结果：`all([])` 返回 `True`，因为没有元素违反“全部满足”的条件；`any([])` 返回 `False`，因为没有元素满足“至少一个”的条件。理解这个边界有助于避免在空集合上额外写错误的特殊分支。

## `lambda` 的边界：短小可以，复杂就命名

`lambda` 适合把一个很短的表达式就地传给高阶函数：

```python
names = ['Guido', 'ada', 'Luciano']
ordered = sorted(names, key=lambda name: name.casefold())
print(ordered)  # ['ada', 'Guido', 'Luciano']
```

如果 `lambda` 需要多层条件、异常处理或复杂计算，应该改写为 `def`：

```python
def normalized_name(name: str) -> str:
    return name.strip().casefold()


ordered = sorted(names, key=normalized_name)
```

一个实用的重构问题是：如果你需要给 `lambda` 写一大段注释来解释它，不如直接给这段逻辑起一个函数名。函数名可以被复用、测试和单独记录类型信息。

## `operator`：用现成函数替代简单 lambda

`operator` 模块提供了很多对应运算符的函数：

```python
from operator import mul
from functools import reduce


print(reduce(mul, [1, 2, 3, 4]))  # 24
```

处理记录排序时，`itemgetter` 和 `attrgetter` 经常比对应的 `lambda` 更简洁：

```python
from operator import itemgetter, attrgetter


orders = [
    {'id': 'A-2', 'total': 30},
    {'id': 'A-1', 'total': 50},
]

print(sorted(orders, key=itemgetter('total')))


class User:
    def __init__(self, name: str, age: int) -> None:
        self.name = name
        self.age = age


users = [User('Bob', 30), User('Alice', 25)]
print([user.name for user in sorted(users, key=attrgetter('age'))])
```

`itemgetter` 使用 `[]` 运算符，因此不仅适用于列表，也适用于字典和任何实现 `__getitem__` 的对象。传入多个字段时，它会返回一个元组，适合多关键字排序：

```python
rows = [
    ('Alice', 2),
    ('Bob', 1),
    ('Carol', 2),
]

print(sorted(rows, key=itemgetter(1, 0)))
# [('Bob', 1), ('Alice', 2), ('Carol', 2)]
```

`methodcaller` 则创建一个函数，在传入对象上调用指定的方法：

```python
from operator import methodcaller


strip_text = methodcaller('strip')
print(strip_text('  Python  '))  # Python
```

如果需要同时传入方法参数，也可以把参数交给 `methodcaller`：

```python
starts_with_p = methodcaller('startswith', 'P')
print(starts_with_p('Python'))  # True
```

## `functools.partial`：预先绑定一部分参数

`partial` 根据已有的可调用对象创建一个新可调用对象，并预先绑定部分位置参数或关键字参数：

```python
from functools import partial


def power(base: int, exponent: int) -> int:
    return base ** exponent


square = partial(power, exponent=2)
cube = partial(power, exponent=3)

print(square(5))  # 25
print(cube(5))    # 125
```

当一个回调 API 需要接收一个参数，但已有函数需要多个参数时，`partial` 可以把多余参数提前固定：

```python
def multiply(number: int, factor: int) -> int:
    return number * factor


double = partial(multiply, factor=2)
values = [1, 2, 3]
print(list(map(double, values)))  # [2, 4, 6]
```

`partialmethod` 是面向方法的对应工具，适合在类中定义若干预先绑定部分参数的方法。

## 实现 `__call__`：带状态的可调用对象

普通函数适合无状态的转换；如果一个可调用对象需要在多次调用之间保留状态，可以定义 `__call__`：

```python
import random


class BingoCage:
    def __init__(self, items: list[str]) -> None:
        self._items = list(items)
        random.shuffle(self._items)

    def __call__(self) -> str:
        if not self._items:
            raise LookupError('empty BingoCage')
        return self._items.pop()


draw = BingoCage(['red', 'green', 'blue'])
print(draw())
print(callable(draw))  # True
```

这种对象既有函数的调用接口，又能保存自己的状态。装饰器、缓存、限流器、重试策略和测试替身都可以使用类似设计。

相比把状态藏在全局变量中，可调用对象把状态封装在实例中，更容易创建多个相互独立的实例，也更容易测试。

## 函数调用的参数设计

如果一个函数只接受关键字参数，可以在参数列表中使用单独的 `*`：

```python
def connect(host: str, *, timeout: float = 3.0, retry: int = 2) -> None:
    print(host, timeout, retry)


connect('db.example.com', timeout=1.5)
# connect('db.example.com', 1.5)  # TypeError
```

关键字专用参数能让调用点更自解释，尤其适用于多个同类型参数、配置项和布尔开关。它也能避免调用者因为记错位置而把参数传给错误字段。

## 递归、尾调用与异步回调

尾调用消除可以优化某些递归函数的栈空间，但 Python 不会因为函数调用位于主体末尾就自动消除调用栈。因此，深度未知的递归通常不能当作无限循环使用：

```python
def countdown(number: int) -> None:
    if number <= 0:
        return
    countdown(number - 1)
```

数据规模较大时，应考虑循环、显式栈或合适的迭代器。

现代异步 API 会使用 promise、future、deferred 和协程等概念，把回调链拆成可组合的异步操作。第 7 章这里只需要建立一个边界认识：生成器、原生协程和异步生成器函数虽然都是可调用对象，但调用结果需要额外的迭代或异步调度，不能当作普通函数的最终返回值。

## 高阶函数的使用场景

高阶函数适合这些场景：

- 排序、过滤、映射时，把字段提取和业务规则作为策略传入；
- 回调 API 需要适配已有函数的参数形式；
- 需要构建装饰器、缓存、重试或限流等可复用行为；
- 需要创建带配置的函数，例如 `partial` 或闭包；
- 需要用统一框架处理多种操作，但又希望把具体操作延迟决定。

它不适合把简单逻辑层层包装成匿名函数。对于复杂条件、需要日志或异常处理的流程，命名函数通常更清晰；对于有大量状态的流程，普通类可能比闭包更容易维护。

## 小结

第 7 章的核心可以概括为：

- 函数可以赋值、传递、存储和返回，因此是 Python 的一等对象；
- `callable()` 是判断对象是否可调用的安全方式；
- 接收或返回函数的函数称为高阶函数；
- `map`、`filter` 返回惰性迭代器，生成器表达式通常更直观；
- `sum`、`all`、`any` 优先于难以解释的通用 `reduce`；
- `itemgetter`、`attrgetter`、`methodcaller` 可以替代简单的 `lambda`；
- `partial` 用于预先绑定参数，`__call__` 用于创建带状态的可调用对象；
- `lambda` 适合短小表达式，复杂逻辑应改成有名字的函数；
- Python 不做尾调用消除，深递归不能代替循环；
- 异步函数的调用结果需要异步框架处理，不能和普通函数返回值混为一谈。

函数式风格的重点不是“少写几行代码”，而是把变化的策略从固定的控制流程中分离出来。只要函数名、参数契约、状态边界和副作用都清楚，高阶函数就能成为一种简洁而可组合的设计工具。

## 读完本章后的知识地图

可以把本章看成一条从“函数是什么”到“如何组合函数”的路线：

```text
函数是一等对象
        │
        ├── 可以赋值、传参、返回、放进容器
        │
        ├── 高阶函数：把处理策略作为参数或返回值
        │       ├── map / filter / reduce
        │       ├── sorted(key=...)
        │       └── 回调、装饰器、闭包
        │
        ├── 函数工厂与参数适配
        │       ├── lambda
        │       ├── partial
        │       └── operator 工具函数
        │
        └── 可调用对象
                ├── callable()
                ├── __call__
                └── 带状态的函数式对象
```

这条路线的重点不是记住更多工具，而是理解“控制流程”和“变化策略”可以分离。遍历、排序或调度框架负责流程；传入的函数负责具体规则。

## 一张实践选择表

| 需求 | 优先选择 | 原因 |
| --- | --- | --- |
| 对每个元素做简单转换 | 生成器表达式或列表推导式 | 语义直接，通常比 `map(lambda ...)` 更易读 |
| 保留满足条件的元素 | 生成器表达式或列表推导式 | 映射和过滤可以写在同一处 |
| 对记录字段排序 | `itemgetter` / `attrgetter` | 明确表达按哪个字段取值 |
| 需要绑定部分参数 | `functools.partial` | 适配回调签名，减少重复传参 |
| 需要记住跨调用状态 | 实现 `__call__` 的类 | 状态有明确所有者，方便测试 |
| 只有一个很短的排序或过滤规则 | `lambda` | 局部表达式不必额外命名 |
| 规则复杂、需要日志或异常处理 | `def` 函数 | 可以命名、测试、添加类型和文档 |
| 递归深度可能很大 | 循环或显式栈 | Python 不做尾调用消除 |

## 三个容易混淆的边界

第一，`callable(obj)` 只能说明对象支持调用协议，不能说明调用一定成功，也不能说明返回值就是业务数据。生成器函数和协程函数都可调用，但调用后还需要迭代或异步调度。

第二，惰性迭代器只能消费一次：

```python
values = map(str, [1, 2, 3])

print(list(values))  # ['1', '2', '3']
print(list(values))  # []
```

如果结果需要多次遍历，应显式保存为列表或其他可重复遍历的数据结构；如果数据量很大且只消费一次，惰性迭代则能减少中间对象和内存占用。

第三，函数式写法不等于没有副作用：

```python
def record(value: int, output: list[int]) -> int:
    output.append(value)  # 修改外部传入的列表
    return value * 2
```

把函数作为参数传递，并不会自动让函数纯粹或不可变。设计高阶函数时仍然要说明输入是否会被修改、是否依赖外部状态，以及异常如何传播。

## 最终理解

读完第 7 章后，我对函数的理解可以压缩为一句话：函数既是执行逻辑，也是可以被组合、配置和传递的数据对象。

因此，遇到重复的流程时，可以先问两个问题：

1. 哪部分是稳定的控制流程，哪部分是会变化的策略？
2. 变化的策略应该作为参数传入，还是封装成一个带状态的可调用对象？

如果策略只是一个短表达式，`lambda` 或 `operator` 工具就够了；如果策略需要参数配置，可以使用闭包或 `partial`；如果策略需要维护状态，则可以实现 `__call__`。当逻辑变复杂时，及时恢复为有名字的函数或普通类，通常比继续堆叠匿名函数更容易维护。
