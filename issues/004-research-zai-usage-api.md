---

title: Research ZAI usage API data contract
labels: [wayfinder:research]
status: closed
assignee: research-zai-api
blocked-by: []
---

## Question

ZAI Coding Plan（GLM）的用量数据契约：国际版（z.ai）与国内版（bigmodel.cn）各自的端点、API key 认证、请求/响应 JSON 结构逐字段含义（配额窗口：5h / weekly？usedPercentage、resetTime 等字段）、两版差异、限流与错误形状、官方文档背书。产出 `research/zai-usage-api.md`。

## Resolution

研究完成，产物：[research/zai-usage-api.md](../research/zai-usage-api.md)（294 行，6 个独立实现 + 官方 zai-coding-plugins 交叉验证）。

要点：
- 端点：`GET https://api.z.ai/api/monitor/usage/quota/limit`（国际）/ `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit`（国内），路径完全一致，Bearer API key 认证。
- 响应：`{code, msg, success, data}` 信封，`data.limits[]` 里 `unit:3` = 5h 会话窗、`unit:6` = 周窗；`percentage` 为 0–100 整数；`nextResetTime` 为 epoch 毫秒；另有 `TIME_LIMIT` 月度工具窗。
- 国内/国际字段结构一致，host 差异而已；文档含最小客户端草案。

遗留（低置信度）：monitor 端点的 429 行为无文档；坏 key 的 401 响应体形状无样本；weekly `number` 观察到 1 和 7 两种值（以 `unit` 为准，不信任 `number`）。
