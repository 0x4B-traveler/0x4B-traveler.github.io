---
title: '《Fluent Python》：Unicode 文本、字节序列与缓冲协议'
date: '2026-09-01'
description: '梳理 Python 中文本、字节、编码、BOM、文件读写、Unicode 规范化、大小写比较和缓冲协议的核心概念与实践边界。'
domain: reading
tags: [python]
status: growing
draft: false
subcategory: python
order: 40
---

处理文本时，程序面对的是两个世界：人看到的是字符，文件、网络和操作系统传递的是字节。编码负责把文本转换成字节，解码负责把字节还原成文本。只要始终分清 `str` 和 `bytes`，大多数乱码问题都可以沿着数据流定位。

## 先纠正几个容易混淆的概念

1. Python 的 `str` 是 Unicode 文本，索引得到的是一个码点对应的字符串，但码点不一定等于用户眼中的一个完整字符。带组合符号的字母和家庭表情可能由多个码点组成。
2. `str.isascii()` 只判断字符串是否全部由 ASCII 字符组成，不能推出它能被“任意编码”处理；只能说它能安全地用于 ASCII 兼容或明确覆盖这些字符的编码。
3. BOM 不只是“小端标记”。在 UTF-16 和 UTF-32 中，它可以指示字节序；在 UTF-8 中，它只能作为编码签名，与字节序无关。
4. 缓冲协议允许直接访问底层内存，但“支持缓冲协议”不等于“所有操作都保证零拷贝”。请求的格式、可写性和内存连续性不匹配时，操作可能失败或产生副本。
5. `xmlcharrefreplace` 不是保留信息的唯一错误处理方式，`backslashreplace` 和 `namereplace` 也能以转义形式保留线索。选哪一种取决于输出格式。
6. NFC 适合统一需要做等价比较的普通文本，但不应无条件改写所有持久化数据。数字签名、协议字段、原始证据和要求精确保留码点序列的数据需要原样保存。

## 文本、码点与字节

`str` 表示 Unicode 文本，`bytes` 表示由 `0～255` 整数组成的字节序列：

```python
text = 'A中😀'

print(type(text))
print([hex(ord(char)) for char in text])
```

输出：

```text
<class 'str'>
['0x41', '0x4e2d', '0x1f600']
```

`ord()` 把长度为 1 的字符串转换成码点，`chr()` 则把有效码点转换回字符串：

```python
print(ord('中'))     # 20013
print(chr(20013))    # 中
```

不过，`len()` 统计的是码点数量，不一定是用户感知的字符数量：

```python
family = '👨‍👩‍👧‍👦'

print(len(family))   # 大于 1
print(family)        # 看起来是一个家庭表情
```

如果业务需要按用户感知的字符截断昵称或计算长度，应使用支持 Unicode 字素簇的库，而不是直接按 `str` 下标切割。

## 编码与解码

编码和解码是方向相反的转换：

```text
str --encode--> bytes
str <--decode-- bytes
```

```python
text = '你好'
payload = text.encode('utf-8')
restored = payload.decode('utf-8')

print(payload)
print(restored)
```

输出：

```text
b'\xe4\xbd\xa0\xe5\xa5\xbd'
你好
```

解码时必须知道字节采用了什么编码。使用错误编码，可能抛出 `UnicodeDecodeError`，也可能得到没有异常但内容错误的乱码：

```python
payload = '你好'.encode('utf-8')

try:
    print(payload.decode('ascii'))
except UnicodeDecodeError as error:
    print(type(error).__name__)
```

排查问题时应先确认四件事：当前对象是 `str` 还是 `bytes`、正在编码还是解码、数据真实使用的编码是什么、异常类型是什么。

## `bytes` 与 `bytearray`

二者都表示二进制序列。`bytes` 不可变，`bytearray` 可变：

```python
immutable = b'ABC'
mutable = bytearray(b'ABC')
mutable[0] = 97

print(immutable)
print(mutable)
```

索引二进制序列会得到整数，切片则保持原来的序列类型：

```python
data = b'ABC'

print(data[0])     # 65
print(data[:1])    # b'A'
```

这和 `str` 不同：

```python
text = 'ABC'

print(text[0])     # 'A'
print(text[:1])    # 'A'
```

还可以从十六进制文本构建字节：

```python
data = bytes.fromhex('48 65 6c 6c 6f')
print(data)  # b'Hello'
```

## 缓冲协议解决什么问题

大块二进制数据如果在对象之间反复复制，会浪费时间和内存。缓冲协议允许数据提供方暴露底层内存的结构信息，数据使用方则可以请求只读或可写视图。

常见的缓冲区提供者有：

- `bytes`
- `bytearray`
- `array.array`
- NumPy 数组
- 一些图像处理和二进制扩展类型

`memoryview` 是 Python 层常用的缓冲区使用方：

```python
source = bytearray(b'ABC')
view = memoryview(source)
view[0] = 97

print(source)  # bytearray(b'aBC')
```

这里的视图和 `source` 共享底层数据，不是全局变量，也不是两个变量神奇地自动同步，而是两个对象引用了同一块内存。

实践中可以使用 `memoryview()` 做一次简单检测：

```python
def supports_simple_buffer(obj):
    try:
        memoryview(obj)
    except (TypeError, BufferError):
        return False
    return True


print(supports_simple_buffer(b'ABC'))             # True
print(supports_simple_buffer(bytearray(b'ABC')))  # True
print(supports_simple_buffer([1, 2, 3]))           # False
```

这个函数只能说明对象接受了这次简单的缓冲区请求。正式的缓冲协议还包含只读或可写、元素格式、维度、形状、步幅和连续性等要求。

### 复制与共享的边界

从可变字节数组创建不可变字节串，会得到独立数据：

```python
source = bytearray(b'ABC')
copied = bytes(source)
source[0] = 97

print(source)  # bytearray(b'aBC')
print(copied)  # b'ABC'
```

但不能把“调用 `bytes()`”机械地理解为任何情况下都创建新对象。传入现有 `bytes` 时，解释器可能直接复用不可变对象。判断是否共享数据，应看具体 API 的契约，而不是只看构造函数名称。

`memoryview` 通常用于避免复制，但如果使用方要求连续内存，而源视图并不连续，某些转换操作仍可能创建副本。

## UTF-8 与 UTF-16 怎么选

| 对比项 | UTF-8 | UTF-16 |
| --- | --- | --- |
| 码元宽度 | 8 位 | 16 位 |
| 一个 Unicode 标量值所需空间 | 1～4 字节 | 2 或 4 字节 |
| ASCII 兼容 | 是 | 否 |
| 字节序问题 | 没有 | 有大端和小端之分 |
| BOM | 不需要；存在时只是编码签名 | 可用于指示字节序 |
| 常见用途 | 网页、接口、源代码、跨平台文本 | 明确要求 UTF-16 的协议和旧系统接口 |

英文文本通常使用 UTF-8 更紧凑，常用汉字在 UTF-16 中通常使用 2 字节，在 UTF-8 中通常使用 3 字节：

```python
for text in ('hello', '你好', '😀'):
    print(
        text,
        len(text.encode('utf-8')),
        len(text.encode('utf-16-le')),
    )
```

不要只根据某一类字符的字节数选择编码。新建跨平台文本、接口和文件时通常优先 UTF-8；只有外部协议明确要求时再使用 UTF-16。

超过 `U+FFFF` 的码点在 UTF-16 中使用两个 16 位码元表示，这一对码元称为代理对：

```python
emoji = '😀'

print(len(emoji.encode('utf-8')))      # 4
print(len(emoji.encode('utf-16-le')))  # 4
```

## BOM 与字节序

BOM 对应码点 `U+FEFF`。在数据流开头，它可以作为编码签名；对 UTF-16 和 UTF-32，还可以帮助识别字节序。

常见字节序列如下：

| 开头字节 | 含义 |
| --- | --- |
| `FF FE` | UTF-16 小端 |
| `FE FF` | UTF-16 大端 |
| `FF FE 00 00` | UTF-32 小端 |
| `00 00 FE FF` | UTF-32 大端 |
| `EF BB BF` | UTF-8 签名 |

Python 中，`utf-16` 编解码器会处理 BOM；`utf-16-le` 和 `utf-16-be` 明确指定字节序，不会自动跳过 BOM：

```python
text = 'A'

print(text.encode('utf-16'))
print(text.encode('utf-16-le'))
print(text.encode('utf-16-be'))
```

UTF-8 本身没有字节序问题。如果文件可能带 UTF-8 签名，可以使用 `utf-8-sig`：

```python
payload = b'\xef\xbb\xbfhello'
print(payload.decode('utf-8-sig'))  # hello
```

某些协议要求文件开头必须是特定 ASCII 字节，例如 Unix 脚本的 `#!`。此时额外的 UTF-8 签名反而可能破坏协议，因此不能无条件添加。

## 编码检测只能给出概率

字节中频繁出现 `\x00`，可能说明文本采用 UTF-16 或 UTF-32；一段包含高位字节的数据如果能严格按 UTF-8 解码，也能提高它是 UTF-8 的可能性。但是这些都只是线索。

编码检测工具根据字节分布做统计判断：

```python
from chardet import detect

raw = '你好，世界'.encode('gbk')
print(detect(raw))
```

数据过短、主要由 ASCII 构成或多种编码混用时，检测结果很容易不可靠。最可信的信息应来自协议、响应头、文件格式或数据提供方。

## 编码错误处理不能掩盖问题

默认的 `strict` 策略会抛出异常，适合尽早暴露错误。其他策略各有代价：

```python
text = '你好'

print(text.encode('ascii', errors='ignore'))
print(text.encode('ascii', errors='replace'))
print(text.encode('ascii', errors='xmlcharrefreplace'))
print(text.encode('ascii', errors='backslashreplace'))
print(text.encode('ascii', errors='namereplace'))
```

- `ignore` 静默丢弃数据，通常不应使用；
- `replace` 用替代字符提示发生了问题，但原始字符无法恢复；
- `xmlcharrefreplace` 适合能解释数字字符引用的 HTML/XML 类文本；
- `backslashreplace` 适合日志和调试输出；
- `namereplace` 使用 Unicode 字符名称，适合需要可读转义的场景。

转义虽然保留了字符线索，却改变了输出文本的语义。最好的方案仍然是使用能够表示原始文本的编码。

## Unicode 三明治

稳妥的文本处理流程是：

```text
输入 bytes → 尽早 decode → 内部统一使用 str → 尽晚 encode → 输出 bytes
```

```python
from pathlib import Path

source = Path('message.txt')
target = Path('result.txt')

text = source.read_text(encoding='utf-8')
processed = text.strip()
target.write_text(processed, encoding='utf-8')
```

编码和解码应尽量集中在文件、网络、数据库驱动等系统边界，业务逻辑内部不要反复在 `str` 和 `bytes` 之间转换。

## 文件编码要明确

文本模式的 `open()` 返回 `TextIOWrapper`：读取时解码成 `str`，写入时编码成字节。

```python
with open('message.txt', encoding='utf-8') as file:
    text = file.read()

with open('result.txt', 'w', encoding='utf-8') as file:
    count = file.write('你好')

print(count)  # 2
```

`write()` 返回接受的字符数量，不是最终写入的字节数。上面的两个字符编码成 UTF-8 后占 6 字节。

不传 `encoding` 时，具体默认值会受到 Python 版本、UTF-8 模式、操作系统和区域设置影响。即使较新的运行环境越来越倾向 UTF-8，需要跨机器运行的代码仍应明确指定编码。

二进制文件则使用二进制模式：

```python
with open('image.png', 'rb') as file:
    data = file.read()

print(type(data))  # <class 'bytes'>
```

## Unicode 规范化

看起来相同的文本可能使用不同的码点序列：

```python
composed = 'é'
decomposed = 'e\u0301'

print(composed == decomposed)  # False
print(len(composed))           # 1
print(len(decomposed))         # 2
```

NFC 尽量使用合成形式，NFD 尽量拆成基础字符和组合符：

```python
from unicodedata import normalize

left = normalize('NFC', composed)
right = normalize('NFC', decomposed)

print(left == right)  # True
```

NFC 适合需要把规范等价文本视为相同值的普通业务场景，例如搜索、去重和用户名比较。但规范化会改变码点序列，因此原始证据、数字签名输入、协议字段和要求精确保真的文本应保留原始版本。

NFKC 和 NFKD 会进一步消除兼容性差异：

```python
print(normalize('NFKC', '①'))  # 1
```

这对搜索、索引和标识符处理可能有用，但如果 `①` 和 `1` 在业务中含义不同，就不应混为一谈。

## 不区分大小写的比较

`lower()` 不能覆盖所有语言规则。Unicode 无大小写比较通常使用 `casefold()`，并在折叠后再次规范化：

```python
from unicodedata import normalize


def caseless_key(text):
    normalized = normalize('NFC', text)
    folded = normalized.casefold()
    return normalize('NFC', folded)


print(caseless_key('Straße') == caseless_key('STRASSE'))
# True
```

如果业务还要忽略全角半角、圈号等兼容差异，可以评估 NFKC，但必须先确认这种合并符合业务语义。

## 排序需要语言规则

`sorted()` 默认按码点顺序比较字符串，不等于拼音顺序，也不等于任何特定语言的字母表顺序。

标准库的 `locale` 可以借助系统区域设置排序，但它依赖操作系统配置，`setlocale()` 会影响进程级状态，并且在多数系统上不是线程安全的。因此，库代码不应擅自修改区域设置。

需要稳定的多语言排序时，应使用明确的排序规则或 ICU 一类国际化库，并通过测试固定预期顺序。

## Unicode 数据库

Unicode 数据库不仅记录码点和名称，还记录字符类别、数字属性、大小写关系等信息：

```python
import unicodedata

char = '中'

print(unicodedata.name(char))
print(unicodedata.category(char))
print(char.isalpha())
```

`isalpha()`、`isdecimal()`、`isnumeric()`、`isprintable()` 和 `casefold()` 等行为都建立在这些 Unicode 属性之上。验证输入时要先明确业务需要的是十进制数字、所有数值字符，还是某种特定字符集合，不能只凭方法名称猜测。

## 文件系统中的文本与字节

处理文件名时通常应使用 `str` 和 `pathlib.Path`。确实需要在文件系统文本和原始字节之间转换时，可以使用：

```python
import os

encoded = os.fsencode('测试.txt')
decoded = os.fsdecode(encoded)

print(encoded)
print(decoded)
```

这两个函数使用当前运行环境的文件系统编码和错误处理规则，比手动写死编码更适合操作系统路径边界。

## CPython 的字符串内存布局

从 Python 3.3 开始，CPython 会根据字符串中最大码点选择 1、2 或 4 字节宽的内部码元，从而在保持按索引访问效率的同时节省常见文本的内存。

```python
from sys import getsizeof

samples = [
    'hello',
    '你好你好你',
    '😀😀😀😀😀',
]

for sample in samples:
    print(repr(sample), len(sample), getsizeof(sample))
```

这些宽度是 CPython 的内部表示，不是 UTF-8、UTF-16 等外部编码。`getsizeof()` 还包含对象自身开销，结果会随 Python 版本、构建方式和平台变化，不能直接当成文件大小。

```python
text = '你好'

print(len(text))                  # 2 个码点
print(len(text.encode('utf-8')))  # 6 个字节
```

## 实用检查清单

1. 先确认手里的值是 `str` 还是 `bytes`。
2. 在输入边界尽早解码，在输出边界尽晚编码。
3. 跨平台文件读写明确指定 `encoding`。
4. 新建文本协议通常优先 UTF-8，外部规范要求时再使用 UTF-16。
5. 不要用 `errors='ignore'` 把数据问题藏起来。
6. 不要把编码检测结果当成确定事实。
7. 需要规范等价比较时选择合适的 Unicode 规范化形式。
8. 无大小写比较使用 `casefold()`，并在折叠后再次规范化。
9. 大块二进制数据优先评估缓冲协议和 `memoryview`，同时检查连续性、格式和可写性要求。
10. 需要面向用户的字符计数时，不要把码点数量直接当成字素簇数量。

## 参考资料

- [Python Unicode HOWTO](https://docs.python.org/3/howto/unicode.html)
- [Python 缓冲协议](https://docs.python.org/3/c-api/buffer.html)
- [Python codecs 与错误处理](https://docs.python.org/3/library/codecs.html)
- [PEP 393：灵活的字符串表示](https://peps.python.org/pep-0393/)
- [Unicode UTF 与 BOM 常见问题](https://www.unicode.org/faq/utf_bom.html)
- [Unicode 规范化常见问题](https://www.unicode.org/faq/normalization.html)
