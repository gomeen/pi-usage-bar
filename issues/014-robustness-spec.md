---
title: Robustness spec (backoff, cache, stale, fallbacks)
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: []
---

## Question

稳健性规格定稿（各家错误形状已在 research/*.md 查明）：各家 429 退避策略（Claude 有 Retry-After 先例、Codex/ZAI/MiniMax 无文档轮询预算）、OAuth token 过期/刷新失败时的展示、多 pi 进程的缓存协调（临时目录缓存 + inflight 锁）、stale 数据的判定与展示（多久算 stale、stale 后显示什么）、relay 无 limit/usage 数据时的退化、MiniMax remains_time 单位启发式与完全无 reset 字段时的显示策略、单家失败不影响其他家的隔离规则。
