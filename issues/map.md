---
title: pi-usage-bar map
labels: [wayfinder:map]
status: open
---

## Destination

发布级 pi 扩展 v1 的路线完全清晰：在 pi footer 显示 Codex / Claude / ZAI / MiniMax 四家官方订阅 plan 的用量条与重置倒计时，样式与 claude-code-usage-bar（Aurora 家族）一致且全部可配置（JSON 配置文件 + 斜杠命令 + 环境变量三层），发布到 GitHub + npm 供 `pi install` 安装。地图完成 = 所有实现前决策已锁定、四家 API 与 pi 扩展 API 已查明、规格成文，可直接开工实现。

## Notes

- 与用户中文沟通；代码、配置键名、commit message 英文。
- 本 tracker 为本地 markdown：`issues/map.md` 是地图，`issues/NNN-*.md` 是票；frontmatter 记 `labels` / `status` / `assignee` / `blocked-by`；frontier = open 且 blocked-by 全 closed 且无 assignee。票的答案追加在 `## Resolution` 段落并置 `status: closed`。
- 从零写，不复制 hknet/pi-usage-bars 代码；其实现只作 API 形状参考，README 致谢（MIT）。
- 样式与配置键名对齐 claude-code-usage-bar（cs）：`style` / `bar_glyph` / `density` / `color_ok` / `color_warn` / `color_hot` / `warning_threshold` / `critical_threshold` 等。
- HITL 票开工前读 grilling + domain-modeling 两个 skill；research 票由调用 research skill 的子代理解决。
- 研究产物落在 `research/*.md`，票里只链接不粘贴。
- 参考仓库的本地克隆在 `/tmp/wayfinder-refs/`（可能被清理，缺失时重新 shallow clone）。

## Decisions so far

- [Charting decisions locked](001-charting-decisions-locked.md): 发布级目标、从零写、v1 四家 provider、cs 同款样式全 look 可配、三层配置、默认只显当前 plan、providerMap 手动映射、graphite 默认可切 pi 主题、v1 无附加 segments、v1 只英文。
- [Research cs/cxs style and config spec](007-research-cs-style-config-spec.md): 四种 look 逐段规格 + graphite 精确 RGB + severity 取色梯 + cs/cxs 全配置键表成文；cs/cxs 的 s_ok 绿色 vs 青绿差异留给样式原型票定。
- [Research ZAI usage API data contract](004-research-zai-usage-api.md): `/api/monitor/usage/quota/limit` 双平台同路径，`limits[]` 里 unit:3=5h 窗、unit:6=周窗，percentage 0-100，nextResetTime epoch 毫秒；429 与 401 响应体形状无文档。
- [Research pi extension API and packaging surface](006-research-pi-extension-api.md): 生命周期/setStatus 单行共享截断语义/命令注册/modelRegistry 凭据路径/打包规范成文；四家内置 provider ID 全表拿到；发现 `openai` vs legacy `openai-codex` 订阅凭据归属疑点，留给检测票。
- [Research Codex usage API data contract](002-research-codex-usage-api.md): `/wham/usage` 端点 + 官方 CLI 源码背书的窗口对象（used_percent/limit_window_seconds/reset_at epoch秒）；窗口按 18000s/604800s 时长分类；429 形状清楚；每计划窗口矩阵无权威来源，按存在性渲染。
- [Research MiniMax usage API data contract](005-research-minimax-usage-api.md): 现行 token_plan/remains + legacy 端点；2062=无 Token Plan；reset 靠 epoch 优先 + remains_time 单位启发式；`current_interval_usage_count` 新旧语义冲突需百分比消歧；hknet services[] 形状无佐证。

## Not yet specified

- 发布流程细节：npm 包名查重与 scope、pi 社区（packages 生态）收录途径、发版 CI——待 toolchain 票（011）落定后毕业为专门的发布票。
- 稳健性策略：OAuth token 过期/刷新失败、429 限流退避、多个 pi 进程并发时的缓存协调、离线/过期数据的展示——待四家 API 研究返回后才知道各家错误形状。
- 重置时间的兜底推算：API 不给显式 reset 时间时的倒推规则——待 provider 研究返回。

## Out of scope

- v1 附加 segments：模型名、context 条、prompt-cache 倒计时（Claude Code 专属概念）、成本显示。
- v1 之外的 provider：Kimi、Moonshot、DeepSeek、OpenRouter、xAI、Baseten、Vercel、Fireworks 等（后续版本再议）。
- i18n 多语言界面（v1 只英文，README 中英双语）。
- codex-resets.com 官方重置公告机制（Codex 专属，与 pi 语境无关；重置倒计时显示在范围内）。
- fork/移植 hknet/pi-usage-bars 代码。
