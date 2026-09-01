---
title: 'LeetCode 算法训练记录'
date: '2026-09-01'
updated: '2026-09-01'
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

这里作为 LeetCode 日常算法训练的总入口。每个学习日单独创建一篇文章，记录当天完成的题目；文章标题直接概括当天题目的共同核心思路，正文再展开每道题的实现、复杂度和复盘。

## 记录目标

- 先使用当前主学语言 Python 建立解题习惯。
- 在后续 Go、C、C++ 阶段，用不同语言重写代表性题目。
- 不只记录最终代码，还记录思路、复杂度、边界条件和可优化方向。
- 按数组、哈希表、双指针、链表、树、图、动态规划等主题逐步整理。

## 每日记录方式

1. 以当天日期创建一篇独立文章。
2. 将当天完成的所有题目放在同一篇文章中。
3. 用一个能概括解法的标题总结当天主题，例如“相邻比较与字典序排序：字符串处理题的核心思路”。
4. 每道题记录题号、核心思路、代码、复杂度、边界条件和复盘。
5. 本文只保留训练目标、记录模板和每日文章索引，作为整个算法模块的导航页。

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

## 每日文章索引

### 2026-09-01：映射、相邻比较与栈——基础线性算法的核心思路

- LeetCode 13：罗马数字转整数
- LeetCode 14：最长公共前缀
- LeetCode 20：有效的括号
- [查看当日完整记录](/knowledge/algorithms/2026-09-01-字符串处理题核心思路)

## 后续记录模板

### LeetCode 编号：题目名称

- **语言**：Python / Go / C / C++
- **解法**：使用的数据结构或算法
- **核心思路**：用自己的话解释为什么这样做
- **复杂度**：时间复杂度与空间复杂度
- **边界条件**：空输入、重复元素、极值和异常情况
- **复盘**：是否可以改进，是否能迁移到其他题目
