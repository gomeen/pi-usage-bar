---
title: Robustness spec (backoff, cache, stale, fallbacks)
labels: [wayfinder:grilling]
status: closed
assignee: main-session
blocked-by: []
---

## Question

稳健性规格定稿（各家错误形状已在 research/*.md 查明）：各家 429 退避策略（Claude 有 Retry-After 先例、Codex/ZAI/MiniMax 无文档轮询预算）、OAuth token 过期/刷新失败时的展示、多 pi 进程的缓存协调（临时目录缓存 + inflight 锁）、stale 数据的判定与展示（多久算 stale、stale 后显示什么）、relay 无 limit/usage 数据时的退化、MiniMax remains_time 单位启发式与完全无 reset 字段时的显示策略、单家失败不影响其他家的隔离规则。

## Resolution

七条全部拍板（按建议）：

1. **429 退避**：Claude 按 Retry-After 头；其他家指数退避 1→5→15 分钟封顶。
2. **OAuth 过期/刷新失败**：显示最后一次有效数据 + 过期标记；从未成功过则提示重新 `/login`；永不崩溃。
3. **多进程协调**：共享临时目录缓存 + inflight 锁（O_EXCL、60s 作废），同一时刻仅一个进程真正请求（Claude 用量与 codex-resets 同款机制）。
4. **stale 判定**：超过 3 倍刷新间隔（默认 6 分钟）标 `⟳`；超过 1 小时变暗；重置公告超 1 小时隐藏（012 已定）。
5. **relay 无额度数据**：从未查到过则静默隐藏；曾查到过保留旧值 + `⟳`。
6. **MiniMax reset 兜底**：epoch 时间戳优先 → remains_time 单位启发式（ms/s 阈值自适应）→ 都没有则不显 ⏰，绝不编造。
7. **错误隔离**：每家独立 snapshot，失败家显示自己的错误文字（demo C 区样式），不影响其他家。
