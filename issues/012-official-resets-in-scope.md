---

title: Official reset announcements in scope (codex-resets.com)
labels: [wayfinder:grilling]
status: closed
assignee: main-session
blocked-by: []
---

## Question

codex-statebar 的「官方重置公告」功能通过什么方案实现？pi-usage-bar 要不要纳入 v1？

## Resolution

**机制查明**（源码 resets.py 全文 + API 实测 2026-10-26）：

- 数据源：社区服务 `codex-resets.com/api/v1/status`，追踪 OpenAI 员工在 X 上官宣的 Codex 手动/额外重置。响应含 `latest_reset`（reset_type: regular|banked, announced_at, source.x_post）、`scheduled_reset`、`active_watch`（AI 预测 + reset_chance_percent）、`stats`。
- 拉取：ETag 协商缓存；429 按 Retry-After 退避（5min~24h 钳制）；TTL 5min；超 1h 未更新整行隐藏；缓存落盘 + inflight 锁文件（O_EXCL、60s 作废）协调多进程；响应上限 1MB。
- 渲染：`↻ ` 前缀一行，优先级 scheduled > active_watch > latest_reset；`· cached` 尾标；json/no_quota 模式隐藏。

**修订（2026-10-26，用户反馈）**：只公告**将来**的重置。

- `latest_reset`（已经发生的重置）**不再渲染**：bar 上已有自己的窗口倒计时，再挂一条“上次重置是什么时候”只会回答没人问的问题，也和“显示下一次何时重置”的诉求相反。该分支整体删除（`ResetAnnouncement.kind` 去掉 `latest`）。
- `scheduled_reset`（预告）仍是第一优先级，文案改为**拼接式倒计时** `in 1h10m` / `in 1d23h`（向上取整到分钟，单单位 `2h` 会丢掉分钟数）。
- 预告**必须一直看得见**：它属于 Codex 段，但 Codex 段可能落在第二行（换行）或者被压成第二行的紧凑摘要行。渲染层把公告当作整条 bar 的元素：跟 Codex 段走（第一行/第二行都跟），Codex 没有自己的段时独立成段。公告来自**独立数据源**，Codex 用量请求失败（错误段）时也照样挂上去，不被一起丢掉。
- 预告文案**分长短两版**：Codex 在第一排时用完整文案（`Reset announced · in 1h10m`），落到第二排（换行或紧凑摘要行）时用简短文案（`in 1h10m`），避免长文案把第二排挤爆。判据是**实际排版**：先按完整文案排，Codex 落在第一排就用完整文案；否则换简短文案重排（完整文案放不进第一排时，宁可短也不把 Codex 挤到第二排）。**独立成段**（Codex 没有自己的段）时一律用完整文案——孤零零一个 `↻ in 1h10m` 没有标签没有意义。数据侧同时给出 `text` / `shortText` 两版，渲染层不做字符串解析。
- **只有 scheduled 有短版**：`active_watch`（AI 预测）**不做短版**，任何一排都用完整文案 `AI forecast · reset possible (42%)`。理由：短版得自造词（“forecast 42%”）且丢掉“reset possible”这个动作，单独一个“42%”用户分不清是“42% 会重置”还是“42% 已用”；而第二排本来就是次要信息，长一点不挤别人的内容。`ResetAnnouncement.shortText` 因此是可选字段，只有带时间值的 scheduled 才填。
- 没有 Codex target 时**不请求** codex-resets.com（省一次网络请求，也避免取回后无处安放）。

**决策：纳入 v1**（用户确认要同款功能）：

- 仅对配置了 Codex plan 的用户拉取（其他用户零请求、零暴露）。
- 配置键沿用 cxs 命名 `show_resets`，**默认开**（与 cxs 一致）——显示格式并入样式原型票（010），配置键并入 schema 票（009）。
- pi 常驻进程内 async fetch，无需 cxs 的 detached 子进程；但保留共享缓存文件 + inflight 锁（多 pi 实例去重）。
- 该功能只对 Codex plan 有意义；Claude/ZAI/MiniMax 无此机制，不显示。
