---

title: Research Claude usage API data contract
labels: [wayfinder:research]
status: closed
assignee: research-claude-api
blocked-by: []
---

## Question

Claude Pro/Max 订阅的用量数据契约：端点 URL 与 OAuth 认证、请求/响应 JSON 结构逐字段含义、配额窗口语义（5h session / weekly，Pro / Max 1x/2x/5x 差异）、重置时间字段与格式、限流与错误形状、官方文档或权威开源实现背书（注意：cs 的数据来自 Claude Code statusline hook 的 stdin，不是直连 API；hknet 的实现才是直连 API 的参考）。产出 `research/claude-usage-api.md`。

## Resolution

研究完成，产物：[research/claude-usage-api.md](../research/claude-usage-api.md)（190 行，hknet + ccstatusline + openusage-cli + 官方 SDK/文档交叉）。

要点：
- 端点：`GET https://api.anthropic.com/api/oauth/usage`（未文档化），Bearer OAuth token + **必须**带 `anthropic-beta: oauth-2025-04-20` 头，缺失则 401。
- 新旧两种响应形状：旧平铺桶（`five_hour`/`seven_day`/`seven_day_sonnet`/`seven_day_opus` + `utilization` 0-100 + `resets_at` ISO 8601）；新 `limits[]` 数组（kind: session/weekly_all/weekly_scoped，账号迁移中，两形状都要解析）。
- `utilization` 可超 100（burnout 指示）；要防御 0-1 小数旧形态。
- 与 statusline stdin 的 epoch 秒不同，API 返回 ISO 字符串。
- 429 带 Retry-After；hknet 用临时目录缓存协调多进程 + Claude 专项退避。
- 遗留：端点未官方文档化；Max 计划多档在 `limits[]` 里怎么分 scope 待实测；`extra_usage`（按量溢出额度）字段语义社区未完全确认。
