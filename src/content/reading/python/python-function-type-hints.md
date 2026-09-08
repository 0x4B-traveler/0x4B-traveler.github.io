---
title: '《Fluent Python》：函数中的类型提示与渐进式类型系统'
date: '2026-09-08'
description: '从基础注解、泛型容器、Mapping 与 Sequence，到 TypeVar、Protocol、Callable 和 CI 静态检查，理解 Python 函数类型提示的价值与边界。'
domain: reading
tags: [python, type-hints, mypy, typing, fluent-python]
status: growing
draft: false
subcategory: python
order: 24
---

Python 仍然是一门动态类型语言。类型提示不会改变 Python 运行时的参数检查方式，也不会自动让程序运行得更快；它主要服务于 IDE、静态类型检查工具和代码阅读者。

但“运行时不强制”不等于“类型提示没有价值”。当函数数量、调用方和协作人数增加时，类型提示可以把函数契约写在接口附近，让错误更早暴露在编辑器或 CI 中。第 8 章真正讨论的不是“要不要给每一行代码加类型”，而是如何用适度的类型信息改善接口设计，同时保留 Python 的动态能力。

## 类型提示是什么，不是什么

```python
def repeat(text: str, count: int) -> str:
    return text * count


print(repeat('ha', 3))  # hahaha
print(repeat('ha', '3'))  # 运行时仍可能执行，结果取决于函数内部操作
```

在默认 Python 运行时中，`str` 和 `int` 只是注解信息。解释器不会因为调用方传入了字符串就自动抛出“类型错误”。类型检查工具才会根据函数签名报告调用问题。

因此，类型提示不能替代：

- 单元测试和集成测试；
- 外部输入的运行时校验；
- 数据库约束和业务不变量；
- 对异常、资源和权限的处理。

类型检查解决的是“代码是否符合声明的接口契约”，而不是“程序在所有输入下是否正确”。

## 基础类型与返回值

函数参数和返回值可以分别标注：

```python
def average(values: list[float]) -> float:
    return sum(values) / len(values)
```

如果函数可能返回 `None`，应该把这一点明确写入签名：

```python
def find_user(user_id: int) -> str | None:
    if user_id == 1:
        return 'Alice'
    return None
```

在 Python 3.10 及以后，`str | None` 是 `Optional[str]` 的简洁写法。二者都表示“返回值可能是字符串，也可能是 `None`”。调用方看到这个签名后，就应该处理缺失情况：

```python
name = find_user(2)
if name is not None:
    print(name.upper())
```

不要为了省事把所有可能结果都写成 `Any` 或宽泛的 `Union`。如果调用方必须先判断很多种返回类型，说明函数接口可能需要拆分，或者应该定义更清晰的结果对象。

## 容器注解：记录、序列和映射

### 列表与可变长度元组

```python
def total(values: list[int]) -> int:
    return sum(values)


def coordinates(values: tuple[float, ...]) -> float:
    return sum(values)
```

`list[int]` 表示列表中的元素应为 `int`。`tuple[float, ...]` 表示长度不固定，但每一项都应为 `float`。

固定结构的元组可以为每个位置指定不同类型：

```python
def origin() -> tuple[str, float, float]:
    return ('Shanghai', 31.2304, 121.4737)
```

这三种元组语义不同：

- `tuple[int, ...]`：可变长度、所有元素类型相同；
- `tuple[str, float]`：固定长度、每个位置类型不同；
- `tuple` 或 `tuple[Any, ...]`：元素类型和长度都不具体。

### 参数优先使用抽象容器

如果函数只需要读取和遍历数据，不要把参数写死为 `list`：

```python
from collections.abc import Iterable, Sequence


def first_three(values: Sequence[str]) -> list[str]:
    return list(values[:3])


def print_values(values: Iterable[str]) -> None:
    for value in values:
        print(value)
```

`Sequence` 表达了索引和切片等能力，列表、元组和许多第三方序列都可以满足；`Iterable` 只要求对象能够逐项迭代，生成器也可以作为输入。

但返回值应该尽量具体、明确：

```python
def normalized(values: Iterable[str]) -> list[str]:
    return [value.strip().lower() for value in values]
```

这里参数接受广泛的可迭代对象，返回值则明确承诺为 `list[str]`。这体现了一个实用原则：输入可以接受调用方提供的合理抽象，输出要让调用方知道自己能做什么。

### `Mapping` 通常比 `dict` 更合适

如果函数只读取键值，参数不必要求具体的 `dict`：

```python
from collections.abc import Mapping


def name_to_hex(color_map: Mapping[str, int], name: str) -> str:
    return f'#{color_map[name]:06x}'
```

调用方可以传入普通字典，也可以传入实现了映射接口的其他对象。只有函数确实需要 `setdefault`、`pop` 或 `update` 等修改操作时，才应该使用 `MutableMapping`：

```python
from collections.abc import MutableMapping


def ensure_default(values: MutableMapping[str, int], key: str) -> None:
    values.setdefault(key, 0)
```

直接标注 `dict` 会不必要地缩小接口，拒绝那些实际支持所需操作的映射对象。类型提示不仅描述数据类型，也是在设计函数允许依赖哪些操作。

## `Any`：方便的通配类型，也是检查盲区

`Any` 与所有类型相容：任何对象都可以传给 `Any`，`Any` 也可以赋给其他类型。它适合表示类型确实未知的边界数据：

```python
from typing import Any


def log_payload(payload: Any) -> None:
    print(payload)
```

但 `Any` 也会关闭很多静态检查：

```python
def unsafe(value: Any) -> None:
    value.this_method_may_not_exist()
```

类型检查工具通常不会继续追踪 `Any` 的属性和方法是否存在。过度使用 `Any` 等于把错误推迟到了运行时，因此更适合把它限制在序列化、第三方库边界或逐步迁移的旧代码中。

## `TypeVar`：保持输入和输出类型的关联

如果函数的返回类型应该与输入类型保持一致，可以使用类型变量：

```python
from collections.abc import Sequence
from typing import TypeVar


T = TypeVar('T')


def first(values: Sequence[T]) -> T:
    return values[0]


number = first([1, 2, 3])       # 推断为 int
message = first(('a', 'b'))     # 推断为 str
```

如果直接写成 `Any`，调用方会失去“输入是什么类型，输出就是什么类型”的信息。`TypeVar` 把这种关联表达出来。

### 受限类型变量和有界类型变量

类型变量可以限制允许的类型集合，也可以声明一个上界：

```python
from typing import TypeVar


Number = TypeVar('Number', int, float)


def twice(value: Number) -> Number:
    return value * 2
```

受限类型变量只能取声明中的某些类型；有界类型变量则允许边界类型的子类型，并在类型推导中保留更具体的类型。实际项目中，应先确认函数真正依赖的行为，再决定是否需要复杂的类型变量约束。

## `Union` 与结果设计

多个可能类型可以使用 `|` 或 `Union` 表达：

```python
def parse_id(value: str | int) -> int:
    return int(value)
```

这里的两个输入类型都支持 `int(value)`，所以函数可以在内部统一处理。如果函数返回几种完全不同、调用方式也不同的类型，调用方就需要额外分支：

```python
def load_value(use_text: bool) -> str | list[str]:
    return 'ready' if use_text else ['ready']
```

这类接口不是一定错误，但通常会增加使用负担。更清晰的替代方式可能是拆成两个函数，或者返回一个明确的结果类，让调用方不必猜测返回对象的形状。

## `Protocol`：静态鸭子类型

Python 运行时经常使用鸭子类型：只要对象支持需要的方法，就可以使用。`Protocol` 让这种“按行为兼容”关系也能被静态检查工具理解：

```python
from typing import Protocol


class SupportsClose(Protocol):
    def close(self) -> None:
        ...


def close_resource(resource: SupportsClose) -> None:
    resource.close()
```

一个类不需要继承 `SupportsClose`，也不需要注册，只要它具备兼容的 `close` 方法，类型检查工具就可以认为它满足这个协议：

```python
class FileLike:
    def close(self) -> None:
        print('closed')


close_resource(FileLike())
```

这就是静态鸭子类型。它比把参数写成某个具体实现类更灵活，又比完全使用 `Any` 更能发现错误。

### 协议描述行为，不描述品牌

```python
class HasName(Protocol):
    name: str


def display(item: HasName) -> str:
    return item.name
```

只要对象有 `name: str`，就可以传入。协议适合描述“调用方真正需要的最小接口”，例如可关闭资源、可读取对象、支持某个方法的插件或测试替身。

## `Callable`：标注函数参数

函数作为参数时，可以使用 `Callable`：

```python
from collections.abc import Callable


def apply_twice(value: int, transform: Callable[[int], int]) -> int:
    return transform(transform(value))


print(apply_twice(3, lambda number: number + 1))  # 5
```

`Callable[[int], int]` 表示接收一个 `int`，返回一个 `int` 的可调用对象。它可以是普通函数、绑定方法、实现 `__call__` 的实例或兼容的其他可调用对象。

如果回调的参数列表需要与另一个函数保持关联，可以进一步使用 `ParamSpec`；不过大多数业务函数只需要简单的 `Callable` 就足够了，不必一开始就引入全部高级类型工具。

## `NoReturn`：函数不会正常返回

`NoReturn` 用于标注不会把控制权正常交还给调用方的函数，例如总是抛出异常或终止程序的函数：

```python
from typing import NoReturn


def abort(message: str) -> NoReturn:
    raise RuntimeError(message)
```

它描述的是控制流，而不是某个具体返回值。类型检查工具可以据此理解：调用 `abort` 后，后续路径不会继续执行。

## `*args`、`**kwargs` 的类型提示

可变位置参数的注解描述单个参数的类型，但函数体内对应的局部变量是一个元组：

```python
def join_text(*content: str, sep: str = ' ') -> str:
    return sep.join(content)


print(join_text('Python', 'typing'))  # Python typing
```

这里 `content` 在函数体内的类型是 `tuple[str, ...]`。类似地，任意关键字参数的注解描述每个值的类型，函数体内对应的局部变量是字典：

```python
def settings(**attrs: str) -> dict[str, str]:
    return attrs
```

`attrs` 的类型是 `dict[str, str]`，而不是某种单独的“关键字参数类型”。

## 类型别名与 `TypeAlias`

复杂的类型表达式可以使用别名改善函数签名的可读性：

```python
from typing import TypeAlias


FromTo: TypeAlias = tuple[str, str]


def replace_path(path: FromTo) -> FromTo:
    source, target = path
    return source.strip(), target.strip()
```

Python 3.12 也支持使用 `type` 语句声明类型别名：

```python
type FromTo = tuple[str, str]
```

如果项目需要兼容较旧的 Python 版本，应继续使用兼容版本支持的写法。类型别名应该给一组有稳定语义的类型命名，而不是把每个简单的 `int` 或 `str` 都包一层。

## `TYPE_CHECKING` 与存根文件

有些导入只供静态检查工具使用，不希望在运行时引入额外依赖，可以使用 `TYPE_CHECKING`：

```python
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from expensive_package import HugeModel


def process(model: 'HugeModel') -> None:
    print(model)
```

`TYPE_CHECKING` 在运行时为 `False`，类型检查工具会把它当作 `True` 来分析。对于第三方库和标准库，类型检查工具也可能通过 `.pyi` 存根文件获取函数签名。存根文件只描述接口，不包含实现，类似于把声明与实现分离。

使用这些机制时需要考虑运行时注解求值、循环导入和目标 Python 版本。现代 Python 可以使用 `from __future__ import annotations` 延迟处理注解，但项目仍应统一版本和工具配置。

## `sorted` 与协议类型

`sorted` 接受可迭代对象，但排序还需要元素之间存在可比较关系，或者调用方提供 `key` 函数：

```python
from collections.abc import Iterable, Callable
from typing import TypeVar


T = TypeVar('T')
K = TypeVar('K')


def ordered(values: Iterable[T], key: Callable[[T], K]) -> list[T]:
    return sorted(values, key=key)
```

这里没有把输入写成 `list[T]`，因为 `sorted` 可以接受任意可迭代对象；返回值明确为新的列表。`key` 把“如何排序”从通用排序流程中分离出来，也让调用方可以排序本身没有自然大小关系的对象。

如果不提供 `key`，元素通常需要实现支持 `<` 的方法，例如 `__lt__`。这不是要求所有对象都继承某个共同的“可排序基类”，而是要求它们支持排序实际使用的操作。

## 静态类型检查的收益与代价

静态检查工具的主要收益是提前发现接口误用：

```python
def upper_name(name: str) -> str:
    return name.upper()


upper_name(42)  # 类型检查工具应报告错误
```

在大型代码库中，类型检查可以在提交或构建阶段发现一部分问题，而不是等到线上路径被执行后才暴露。你在本章的想法中把它理解为“静态语言流水线中的检查门禁”，这个类比很有帮助：类型检查可以成为质量门的一部分，但它不是唯一的门。

类型检查也有明显限制：

- 可能误报，即把运行时正确的代码报告为错误；
- 可能漏报，即没有发现实际存在的错误；
- 对动态元编程、描述符、元类和部分魔术行为理解有限；
- 不会自动验证外部 JSON、用户输入或数据库返回值；
- 工具可能落后于 Python 新版本或第三方库；
- 类型注解本身会增加学习、维护和迁移成本。

因此，类型提示覆盖率不是越高越好。100% 覆盖可能会把精力消耗在低价值的注解上，甚至迫使团队放弃 Python 原本有用的动态表达力。

## 在 CI 中渐进式引入

更稳妥的方式是先为公共函数和边界模块增加类型提示，再把检查纳入 CI：

```text
类型提示
    ↓
静态检查工具（mypy / Pyright 等）
    ↓
测试与 lint
    ↓
CI 质量门
```

可以按以下顺序推进：

1. 先给新代码和公共接口标注参数、返回值；
2. 为第三方依赖安装或补充类型信息；
3. 对旧模块逐步减少 `Any` 和未标注区域；
4. 把类型检查、测试和 lint 一起放进 CI；
5. 对误报进行最小范围的配置或忽略，并记录原因；
6. 不把类型检查通过误认为功能测试通过。

类型检查是一种低成本的早期反馈，但它只能覆盖类型契约能表达的那部分风险。测试、运行时校验和业务断言仍然不可替代。

## 关于“越严格越好吗”

渐进式类型系统的优点在于可以逐步采用：类型提示是可选的，不需要一次性改造整个项目。鸭子类型更灵活，名义类型更容易在运行前发现错误；两者不是简单的好坏关系，而是接口边界、团队规模、代码生命周期和工具成熟度之间的取舍。

一个实用判断是：函数参数应该表达调用方必须提供的最小能力，返回值应该表达函数真正承诺的具体结果。不要为了追求形式上的严格，把参数写成过于具体的实现类，也不要为了逃避设计，把所有内容都写成 `Any`。

## 小结

第 8 章可以归纳为以下原则：

- 类型提示主要服务于静态分析和沟通，不会自动改变 Python 的运行时行为；
- 参数类型应描述函数真正需要的能力，优先考虑 `Iterable`、`Sequence`、`Mapping` 等抽象接口；
- 返回值应尽量具体，让调用方知道可以执行哪些操作；
- `Any` 是渐进式迁移的工具，但过度使用会关闭检查；
- `TypeVar` 用于表达输入与输出之间的类型关联；
- `Protocol` 表达静态鸭子类型，不要求继承或注册；
- `Callable` 描述函数参数，`NoReturn` 描述不会正常返回的控制流；
- `Union` 过多通常会增加调用方负担，应考虑拆分接口或设计结果对象；
- 类型检查可以纳入 CI，但不能替代测试、运行时校验和业务约束；
- 类型提示覆盖率不是唯一目标，保持代码可读性和 Python 的表达力同样重要。

读完这一章，我更愿意把类型提示理解成“写给工具和协作者看的函数契约”。好的类型提示不会把所有动态行为都抹平，而是把最重要、最稳定、最容易误用的边界表达出来。它最终服务的不是注解数量，而是更早发现错误、更清楚地设计接口，以及让代码在持续演进中仍然容易理解。
