---
title: 'LeetCode 算法训练：哈希查找与字符串反转'
date: '2026-08-31'
description: '记录 LeetCode 1 两数之和的 Python、Go 解法，以及 LeetCode 9 回文数的 Python 解法、复杂度和关键边界。'
domain: algorithm
tags: [LeetCode, 算法, 哈希表, 字符串, Python, Go]
status: growing
draft: false
subcategory: algorithms
term: daily
order: 1
---

# LeetCode 算法训练：哈希查找与字符串反转

## 当日完成

- LeetCode 1：两数之和
- LeetCode 9：回文数

这两道题分别练习了哈希表的一次遍历查找，以及利用 Python 字符串切片快速完成序列反转。

## LeetCode 1：两数之和

使用哈希表记录已经遍历过的数字及其下标。遍历当前数字 `num` 时，计算需要寻找的补数 `target - num`；如果补数已经在哈希表中，就返回补数下标和当前下标，否则保存当前数字。

### Python 版本

```python
from typing import List


class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        mapping = {}
        for i, num in enumerate(nums):
            complement = target - num
            if complement in mapping:
                return [mapping[complement], i]
            mapping[num] = i
        return []
```

复杂度：时间复杂度为 `O(n)`，空间复杂度为 `O(n)`。

关键点：先查找补数，再保存当前数字，可以避免同一位置被使用两次，并能正确处理 `[3, 3]`、`target = 6` 这样的重复数字场景。

### Go 版本

Go 版本使用 `map[int]int` 保存数值和下标。查询 map 时通过双返回值中的 `ok` 判断补数是否存在。

```go
func twoSum(nums []int, target int) []int {
    mapping := make(map[int]int)
    for i, v := range nums {
        complement := target - v
        if j, ok := mapping[complement]; ok {
            return []int{j, i}
        }
        mapping[v] = i
    }
    return nil
}
```

复杂度：时间复杂度为 `O(n)`，空间复杂度为 `O(n)`。

关键点：`j, ok := mapping[complement]` 能区分“补数不存在”和“补数的下标恰好为 0”。与 Python 版本一样，必须先查询补数，再记录当前元素，避免重复使用同一个下标。

## LeetCode 9：回文数

将整数转换为字符串，再利用切片 `[::-1]` 得到反转结果，与原字符串比较即可判断是否为回文数。

```python
class Solution:
    def isPalindrome(self, x: int) -> bool:
        return str(x) == str(x)[::-1]
```

复杂度：设数字有 `n` 位，时间复杂度为 `O(n)`，空间复杂度为 `O(n)`。

关键点：负数转换后包含 `-`，例如 `-121` 与 `121-` 不相等；以 `0` 结尾但不为 `0` 的数字反转后也不会与原字符串相等。

## 当日复盘

- 哈希表可以用额外空间换取更快的查找速度，将暴力枚举从 `O(n²)` 优化到 `O(n)`。
- Python 和 Go 的实现共享相同的算法不变量，语言差异主要体现在哈希表初始化、键存在性判断和返回值表达方式。
- Python 切片适合快速表达字符串反转，但它会创建新字符串，因此空间复杂度不是 `O(1)`。
- 记录解法时应同时说明代码为什么正确，以及重复元素、负数等边界条件如何处理。
