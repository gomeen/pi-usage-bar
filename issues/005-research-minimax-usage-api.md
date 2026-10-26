---
title: Research MiniMax usage API data contract
labels: [wayfinder:research]
status: closed
assignee: research-minimax-api
blocked-by: []
---

## Question

MiniMax Coding Plan 的用量数据契约：国际版与国内版各自的端点（token_plan/remains 与 legacy openplatform 端点）、API key 认证、请求/响应 JSON 结构逐字段含义（services 数组、窗口类型 weekly/interval、used_percentage、reset 字段）、Token Plan 与 Credits 的区分、限流与错误形状、官方文档背书。产出 `research/minimax-usage-api.md`。

## Resolution

研究完成，产物：[research/minimax-usage-api.md](../research/minimax-usage-api.md)（228 行，官方 CLI/文档 + hknet + 社区实现交叉）。

要点：
- 端点：现行 `GET https://api.minimax.io/v1/token_plan/remains`（国内 `api.minimaxi.com`）；legacy `/v1/api/openplatform/coding_plan/remains` 对部分 key 返回 1004 cookie 错误，产品改名 Coding Plan→Token Plan。
- 响应：`model_remains[]` 数组，窗口字段含百分比、计数（国际= prompt 数，国内=模型调用数×15）、reset 字段；`2062` = 无有效 Token Plan（Credits-only key）。
- reset 推导：epoch 时间戳优先，`remains_time` 单位（ms vs s）要阈值启发式区分。
- Token Plan vs Credits：按 key 前缀路由（CLI 做法）或响应错误码区分；`points_balance`/`credits_balance` 是否在此端点出现无第二源确认。
- 遗留：`current_interval_usage_count` 语义有新旧两个时代（剩余 vs 已用），MiniMax 自己都承认——实现时用百分比一致法消歧或只显百分比；hknet 的 `services[]` 形状无佐证，当防御性回退。
