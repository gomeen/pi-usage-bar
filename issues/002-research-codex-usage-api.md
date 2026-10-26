---
title: Research Codex usage API data contract
labels: [wayfinder:research]
status: closed
assignee: research-codex-api
blocked-by: []
---

## Question

ChatGPT/Codex 订阅的用量数据契约：端点 URL 与认证（OAuth access token 如何取用、是否需要 account_id）、请求/响应 JSON 结构逐字段含义、配额窗口语义（5h session / weekly，Pro / Plus / Business 等计划的差异）、重置时间字段与格式、限流与错误形状（429 语义）、官方文档或权威开源实现背书。产出 `research/codex-usage-api.md`。

## Resolution

研究完成，产物：[research/codex-usage-api.md](../research/codex-usage-api.md)（201 行，官方 codex CLI Rust 源码 + CodexBar + hknet 三方交叉）。

要点：
- 端点：`GET https://chatgpt.com/backend-api/wham/usage`（base 无 `/backend-api` 时用 `/api/codex/usage` 路径风格），Bearer ChatGPT OAuth JWT；`ChatGPT-Account-Id` 头存在且 CLI 总是发送（个人计划可省）。
- 窗口对象：`{used_percent: 0-100, limit_window_seconds: 18000=5h/604800=7d, reset_after_seconds, reset_at(epoch秒)}`；primary/secondary 窗口按时长分类（非位置）；整个 `rate_limit` 可空。
- 计划差异：plus/pro/business 等 `plan_type` 枚举；无权威的每计划窗口矩阵（哪些计划只有周窗）——实现时按窗口存在性渲染即可。
- 429 语义清楚（`usage_limit_reached` + `resets_at`）；`/wham/usage` 自身的轮询预算无文档，取保守间隔。
- 遗留：Help Center 原文被 bot 墙；5h 窗起点（首清请求 vs 固钟）未确认；workspace 账户必须发 Account-Id 与否未验。
