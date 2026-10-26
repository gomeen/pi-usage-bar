---
title: Research Claude usage API data contract
labels: [wayfinder:research]
status: open
assignee: research-subagent
blocked-by: []
---

## Question

Claude Pro/Max 订阅的用量数据契约：端点 URL 与 OAuth 认证、请求/响应 JSON 结构逐字段含义、配额窗口语义（5h session / weekly，Pro / Max 1x/2x/5x 差异）、重置时间字段与格式、限流与错误形状、官方文档或权威开源实现背书（注意：cs 的数据来自 Claude Code statusline hook 的 stdin，不是直连 API；hknet 的实现才是直连 API 的参考）。产出 `research/claude-usage-api.md`。
