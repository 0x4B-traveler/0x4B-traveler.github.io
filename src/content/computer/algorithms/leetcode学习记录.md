---
title: 'LeetCode 算法训练记录'
date: '2026-09-01'
description: '记录使用 Python、Go、C 和 C++ 实现数据结构与算法的过程、思路、复杂度和复盘。'
domain: algorithm
tags: [LeetCode, 算法, 数据结构, Python]
status: growing
draft: false
subcategory: algorithms
term: leetcode
order: 1
---

# LeetCode 算法训练记录

这里集中记录 LeetCode 题目的实现过程，逐步沉淀不同编程语言下的数据结构、算法思路、复杂度分析和边界条件。

## 记录目标

- 先使用当前主学语言 Python 建立解题习惯。
- 在后续 Go、C、C++ 阶段，用不同语言重写代表性题目。
- 不只记录最终代码，还记录思路、复杂度、边界条件和可优化方向。
- 按数组、哈希表、双指针、链表、树、图、动态规划等主题逐步整理。

## 已完成题目

### LeetCode 1：两数之和

使用哈希表记录已经遍历过的数字及其下标。遍历当前数字 `num` 时，先计算需要寻找的补数 `target - num`；如果补数已经在哈希表中，就找到了答案，否则将当前数字和下标存入哈希表。

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

关键点：先查找补数，再保存当前数字，可以正确处理同一个数字使用两次的情况，例如 `[3, 3]`、`target = 6`。

### LeetCode 9：回文数

将整数转换为字符串，再利用 Python 切片 `[::-1]` 得到反转结果，与原字符串比较即可判断是否为回文数。

```python
class Solution:
    def isPalindrome(self, x: int) -> bool:
        return str(x) == str(x)[::-1]
```

复杂度：设数字有 `n` 位，时间复杂度为 `O(n)`，空间复杂度为 `O(n)`。

关键点：负数转换后包含 `-`，例如 `-121` 与 `121-` 不相等，因此会正确返回 `False`；以 `0` 结尾但不为 `0` 的数字，反转后位数不同，也会正确判断为非回文数。

### LeetCode 13：罗马数字转整数

使用哈希表保存七种罗马数字的数值。遍历字符串时，如果当前字符的数值小于下一个字符，就执行减法；否则执行加法。最后将末尾字符的数值补入结果。

```python
class Solution:
    def romanToInt(self, s: str) -> int:
        ans = 0
        mapping = {
            "I": 1,
            "V": 5,
            "X": 10,
            "L": 50,
            "C": 100,
            "D": 500,
            "M": 1000,
        }
        for i in range(len(s) - 1):
            if mapping[s[i]] < mapping[s[i + 1]]:
                ans -= mapping[s[i]]
            else:
                ans += mapping[s[i]]
        return ans + mapping[s[-1]]
```

复杂度：时间复杂度为 `O(n)`，其中 `n` 为罗马数字字符串的长度；哈希表只保存固定的 7 个字符，空间复杂度为 `O(1)`。

关键点：通过比较相邻字符统一处理减法组合，例如 `IV`、`IX`、`XL`、`CM`，不需要单独判断每一种特殊组合。

## 后续记录模板

### LeetCode 编号：题目名称

- **语言**：Python / Go / C / C++
- **解法**：使用的数据结构或算法
- **核心思路**：用自己的话解释为什么这样做
- **复杂度**：时间复杂度与空间复杂度
- **边界条件**：空输入、重复元素、极值和异常情况
- **复盘**：是否可以改进，是否能迁移到其他题目

