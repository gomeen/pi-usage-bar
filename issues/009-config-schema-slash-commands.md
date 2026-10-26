---
title: Config schema and slash command surface
labels: [wayfinder:grilling]
status: closed
assignee: main-session
blocked-by: [6, 7]
---

## Question

v1 配置 schema 定稿：全部键名与默认值（对齐 cs 命名 + `display.mode` + `providerMap`（含 `type: relay` 显式映射）+ 刷新间隔 + `PI_*_ENDPOINT` 端点覆盖 + `show_resets` 官方重置公告开关 + `show_balance`/`balance_bar`/货币单位中转站余额键）、配置文件路径与定位顺序、斜杠命令面（`/usage-bar` 设置/查看配置的交互规格 + `--usage` CLI flag）与 `/usage` 详情命令的交互规格（列表 + 展开详情）。

## Resolution

全部拍板（含 R3/Q3 的 --usage）：

**配置文件**：单一全局 `~/.pi/agent/usage-bar.json`，不做项目级覆盖；稀疏写入（只存非默认键，cs 模式）；合并顺序 file < env。

**键表（v1 全量）**：

| 键 | 默认 | 说明 |
|---|---|---|
| `style` | `"aurora"` | aurora \| ring \| classic |
| `bar_glyph` | `"block"` | block \| thin（aurora 用） |
| `theme` | `"graphite"` | graphite \| `"pi"`（跟随 pi 主题） |
| `density` | `"regular"` | compact \| regular \| cozy |
| `bar_width` | `12` | bar 格数 |
| `color_ok/color_warn/color_hot` | `""` | RGB 覆盖，空=默认 |
| `warning_threshold` | `30` | 百分比 |
| `critical_threshold` | `70` | 百分比 |
| `display.mode` | `"active"` | active \| all |
| `display.providers` | `[]` | 空=全部；钉死只显这几家 |
| `providerMap` | `{}` | 自定义 ID→plan/relay，见 008 |
| `refresh_minutes` | `2` | 轮询间隔 |
| `show_resets` | `true` | ↻ 官方重置公告 |
| `show_balance` | `true` | 中转站余额探测 |
| `currency` | `"$"` | 余额货币符号 |

另有 `PI_*_ENDPOINT` 环境变量覆盖端点（仅 env，不入文件）。

**命令面**：`/usage-bar` 纯对话框式（选中分类→选中值，写入配置文件，不用子命令语法）；`/usage` 列表+展开详情；`--usage` CLI flag 一行 JSON：`{status: ok|unconfigured|unsupported|error, provider, plan, windows:[{label,percent,resetsAt}], balance?, fetchedAt}`——**永不包含任何凭据**。
