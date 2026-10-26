---
title: Config schema and slash command surface
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: [6, 7]
---

## Question

v1 配置 schema 定稿：全部键名与默认值（对齐 cs 命名 + `display.mode` + `providerMap`（含 `type: relay` 显式映射）+ 刷新间隔 + `PI_*_ENDPOINT` 端点覆盖 + `show_resets` 官方重置公告开关 + `show_balance`/`balance_bar`/货币单位中转站余额键）、配置文件路径与定位顺序、斜杠命令面（`/usage-bar` 设置/查看配置的交互规格 + `--usage` CLI flag）与 `/usage` 详情命令的交互规格（列表 + 展开详情）。
