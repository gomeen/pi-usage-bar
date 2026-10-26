---
title: Official reset announcements in scope (codex-resets.com)
labels: [wayfinder:grilling]
status: closed
assignee: main-session
blocked-by: []
---

## Question

codex-statebar 的「官方重置公告」功能通过什么方案实现？pi-usage-bar 要不要纳入 v1？

## Resolution

**机制查明**（源码 resets.py 全文 + API 实测 2026-10-26）：

- 数据源：社区服务 `codex-resets.com/api/v1/status`，追踪 OpenAI 员工在 X 上官宣的 Codex 手动/额外重置。响应含 `latest_reset`（reset_type: regular|banked, announced_at, source.x_post）、`scheduled_reset`、`active_watch`（AI 预测 + reset_chance_percent）、`stats`。
- 拉取：ETag 协商缓存；429 按 Retry-After 退避（5min~24h 钳制）；TTL 5min；超 1h 未更新整行隐藏；缓存落盘 + inflight 锁文件（O_EXCL、60s 作废）协调多进程；响应上限 1MB。
- 渲染：`↻ ` 前缀一行，优先级 scheduled > active_watch > latest_reset；`· cached` 尾标；json/no_quota 模式隐藏。

**决策：纳入 v1**（用户确认要同款功能）：

- 仅对配置了 Codex plan 的用户拉取（其他用户零请求、零暴露）。
- 配置键沿用 cxs 命名 `show_resets`，**默认开**（与 cxs 一致）——显示格式并入样式原型票（010），配置键并入 schema 票（009）。
- pi 常驻进程内 async fetch，无需 cxs 的 detached 子进程；但保留共享缓存文件 + inflight 锁（多 pi 实例去重）。
- 该功能只对 Codex plan 有意义；Claude/ZAI/MiniMax 无此机制，不显示。
