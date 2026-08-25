# 生成当日"每日记录"模板文件
# 用法: .\scripts\new-log.ps1            # 今天
#       .\scripts\new-log.ps1 -Date 2026-08-26
param(
    [string]$Date = (Get-Date -Format 'yyyy-MM-dd')
)

$root = Split-Path -Parent $PSScriptRoot
$dir = Join-Path $root 'src\content\daily\log'
$file = Join-Path $dir "$Date.md"

if (Test-Path $file) {
    Write-Host "已存在: $file"
    exit 1
}

$title = (Get-Date -Date $Date -Format 'M月d日') + ' · 每日记录'
$content = @"
---
title: '$title'
date: '$Date'
description: '一句话心得'
subcategory: 'log'
---

## 今日完成
- 待补充

## 遇到的问题
- 待补充

## 明日计划
- 待补充

## 一句话心得
待补充
"@

[IO.File]::WriteAllText($file, $content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "已生成: $file"