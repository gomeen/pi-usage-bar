---
title: Provider detection and providerMap spec
labels: [wayfinder:grilling]
status: open
assignee:
blocked-by: [6]
---

## Question

Provider 检测与映射规格定稿：内置 provider ID → plan 的自动映射表（openai→codex、anthropic→claude、zai/zai-coding-cn、minimax/minimax-cn 等——实际可用的内置 ID 以 006 研究为准）、`providerMap` 手动映射的配置结构与优先级（手动 > 自动）、host 级路由特例（模型经网关/中转时显示哪个账户的用量）、OAuth 订阅与 API key 凭据类型的区分逻辑。
