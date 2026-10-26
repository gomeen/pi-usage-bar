---
title: Provider detection and providerMap spec
labels: [wayfinder:grilling]
status: closed
assignee: main-session
blocked-by: [6]
---

## Question

Provider 检测与映射规格定稿：内置 provider ID → plan 的自动映射表（openai→codex、anthropic→claude、zai/zai-coding-cn、minimax/minimax-cn 等——实际可用的内置 ID 以 006 研究为准）、`providerMap` 手动映射的配置结构与优先级（手动 > 自动）、host 级路由特例（模型经网关/中转时显示哪个账户的用量）、OAuth 订阅与 API key 凭据类型的区分逻辑。

## Resolution

全部拍板（含实测验证）：

1. **Codex 凭据走新 ID `openai`**（用户决定，实测佐证：本机 pi 1.4.0 auth.json 的 `openai` 条目为 oauth 类型含 access/refresh/expires；legacy `openai-codex` 不作目标，但检测表保留它作兼容回退）。
2. **自动映射表**：`openai→codex`、`openai-codex→codex`（兼容）、`anthropic→claude`、`zai→zai`、`zai-coding-cn→zai-cn`、`minimax→minimax`、`minimax-cn→minimax-cn`；不在表内的自定义 ID → 按中转站自动探测（013 票 B 方案）。
3. **providerMap 结构与优先级**：`"providerMap": {"cc-switch-zhipu-glm": "zai-cn", "my-relay": {"type": "relay"}}`——值可以是 plan 名或 relay 对象；**手动映射 > 自动检测 > 中转站探测**。
4. **网关/中转路由**：显示实际在扣钱的账户（模型自己的 baseUrl/key 决定）；内置 plan 的 provider 指向非第一方 host 时不显示该 plan 配额（hknet 行为），除非 providerMap 显式映射。
5. **凭据类型判别**：优先用 modelRegistry 的文档化信号；歧义场合两个端点都试、谁通用谁（隔离在 compat.ts）；`AuthResult.source` 启发式仅作最后回退。
