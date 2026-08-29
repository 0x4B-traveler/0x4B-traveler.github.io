---
title: '《Fluent Python》：特殊方法、对象模型与推导式'
date: '2026-08-29'
description: '整理《Fluent Python》中关于特殊方法、CPython 对象模型、序列类型、列表推导式、生成器表达式、元组和海象运算符的阅读笔记。'
domain: reading
tags: [python]
status: growing
draft: false
subcategory: python
order: 10
---

《Fluent Python》强调，Python 的许多语言特性并不是孤立存在的。解释器通过特殊方法与对象交互，而列表、元组、生成器等数据结构也都可以从对象模型和协议的角度理解。

## 特殊方法供解释器调用

特殊方法是以双下划线开头和结尾的方法，例如 `__len__`、`__iter__` 和 `__getitem__`。它们通常不是让我们直接调用的，而是由 Python 解释器在执行内置操作时调用。

例如：

```python
class Countdown:
    def __init__(self, start):
        self.start = start

    def __len__(self):
        return max(self.start, 0)

    def __iter__(self):
        return iter(range(self.start, 0, -1))


countdown = Countdown(3)
print(len(countdown))       # 3
print(list(countdown))      # [3, 2, 1]
```

这里的 `len(countdown)` 会触发 `countdown.__len__()`，而 `for i in countdown` 背后会先调用 `iter(countdown)`。

`iter(x)` 通常会调用 `x.__iter__()`；如果对象没有实现 `__iter__()`，解释器还可能回退到通过连续调用 `x.__getitem__(0)`、`x.__getitem__(1)` 等方式进行迭代，直到抛出 `IndexError`。

特殊方法最重要的用途包括：

- 模拟数值类型，例如实现 `+`、`-` 和比较运算；
- 定义对象的字符串表示形式，例如 `__repr__` 和 `__str__`；
- 定义对象的布尔值，例如 `__bool__`；
- 实现容器、迭代器和上下文管理器等协议。

## CPython 中的对象模型

从 CPython 的实现角度看，Python 对象通常都包含一个对象头，用来保存运行时元数据。最基本的对象头包括：

- `ob_refcnt`：对象的引用计数；
- `ob_type`：指向对象类型的指针。

以 `float` 为例，它除了对象头之外，还会保存一个 C 语言 `double` 类型的值，通常称为 `ob_fval`。

可变长度对象通常还包含长度信息。CPython 处理内置容器时，可以直接读取底层结构体中的长度字段，例如 `PyVarObject` 的 `ob_size`，因此不必经过普通的 Python 方法调用路径。

容器序列保存的内容也有区别：

- 元组、列表等引用序列保存的是对象引用，因此其中的元素可以是任意类型；
- `array` 等扁平序列直接保存元素值，通常适合存储类型相同的数据，也更节省空间。

可变序列会复用不可变序列的大部分操作，同时增加修改内容的方法，例如 `append()`、`extend()` 和 `insert()`。

## 列表推导式与生成器表达式

列表推导式的作用很单一：构建列表。它适合目标就是一个列表、并且希望立即得到全部结果的场景：

```python
squares = [x * x for x in range(10)]
```

如果要构建元组、数组或其他类型的序列，可以把列表推导式传给相应的构造函数，但这种写法会先创建一个完整的中间列表：

```python
coordinates = tuple([x * 2 for x in range(5)])
```

更合适的写法通常是把生成器表达式交给构造函数。生成器表达式遵循迭代器协议，按需逐个产出元素，不会为了给构造函数提供数据而预先创建完整列表：

```python
coordinates = tuple(x * 2 for x in range(5))
```

当生成器表达式是函数调用的唯一参数时，可以省略它自身的圆括号：

```python
total = sum(x * x for x in range(10))
```

如果函数还有其他参数，则必须保留生成器表达式的圆括号，以便解释器识别它的边界：

```python
result = process((x * x for x in range(10)), limit=5)
```

因此可以简单地记为：

- 目标是列表，并且需要立即使用全部数据：使用列表推导式；
- 目标是其他可迭代对象，或者数据量较大、不希望立即分配全部结果：使用生成器表达式。

列表推导式应保持简短。如果条件和转换逻辑已经超过两行，通常可以考虑拆分语句，或者改写成传统的 `for` 循环，以提高可读性。

Python 会忽略 `[]`、`{}` 和 `()` 内部的换行，所以列表、列表推导式、元组和字典都可以自然地分成多行书写，不需要使用反斜杠续行：

```python
selected = [
    name
    for name in names
    if name.startswith('Py')
]
```

## 元组的双重角色

元组既可以作为不可变序列使用，也可以作为没有字段名称的记录使用。这两种用途关注的重点不同。

作为不可变序列时，元组强调元素的顺序和集合本身的结构不可变，通常会把其中的元素视为同一类数据：

```python
rgb = (255, 128, 0)
```

作为记录时，元组中每个位置都有特定含义，元素类型可以不同。此时，元素数量和位置比“不可变列表”这一性质更重要：

```python
traveler = ('Ma Chao', 30, 'Shanghai')
name, age, city = traveler
```

这个元组相当于一条没有字段名的记录：第一个位置表示姓名，第二个位置表示年龄，第三个位置表示城市。解包可以把各个位置的含义显式表达出来，但如果记录需要在多处传递，或者字段较多，使用 `namedtuple`、`typing.NamedTuple` 或数据类通常会更清晰。

需要注意，元组的不可变指的是它保存的引用不能被替换，并不保证它引用的对象本身不可变：

```python
items = (1, 2, ['Python'])
items[2].append('Fluent Python')
```

这里不能替换 `items[2]`，但仍然可以修改该位置所引用的列表。

## 海象运算符与作用域

海象运算符 `:=` 可以在表达式中完成赋值，适合复用刚刚计算出的结果：

```python
if (count := len(items)) > 0:
    print(f'{count} items')
```

需要区分两类变量的作用域：

- 推导式中的循环变量通常有独立的隐式作用域，不会泄漏到外层；
- 通过 `:=` 绑定的变量通常会绑定到包含该推导式或生成器表达式的外层作用域。

例如：

```python
result = [y for x in data if (y := transform(x)) is not None]
```

这里的 `x` 不会因此出现在外层作用域中，但 `y` 可能仍然可以在外层访问。在函数内部，它属于当前函数作用域；在模块级代码中，则属于模块作用域。因此，不能简单地说海象运算符创建的变量“一定局限在函数内”。

## 小结

这部分内容可以归纳为一条主线：Python 的语法糖背后通常对应对象协议，协议背后又连接着解释器的数据模型。理解 `__iter__`、`__getitem__`、`__len__` 等特殊方法，有助于理解 `for`、`len()`、布尔判断和容器行为；理解引用序列与扁平序列的差异，则有助于在性能和数据结构之间做出更好的选择。
