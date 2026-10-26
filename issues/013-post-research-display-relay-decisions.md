---

title: Post-research display and relay balance decisions
labels: [wayfinder:grilling]
status: closed
assignee: main-session
blocked-by: []
---

## Question

研究完成后 Round 3 + 中转站分析：各家附加数据显示语义、窗口标签词表、--usage flag、安全姿态、中转站余额方案。

## Resolution

**各家附加数据（研究带出）**：
- Codex `credits` 余额行显示（一行字不占 bar）；`spend_control` 不显示。
- Claude `extra_usage` 不显示（社区语义未确认，进雾区，确认后毕业）。
- ZAI 只显 5h + 周窗两个 bar；`TIME_LIMIT` 月度工具窗不显示。
- MiniMax 只显百分比；裸计数不显示（新旧语义冲突，无法安全消歧）。

**窗口标签词表**：按窗口实际时长动态生成——`limit_window_seconds` 18000→`5h`、604800→`7d`、其他如实（`2h`、`72h`）；拿不到时长回退 `I`。cs 风格，不撒谎。

**`--usage` CLI flag**：要。一行 JSON 打印退出，冒烟测试/CI/凭据校验用。并入 009。

**凭据安全姿态**（记入地图 Notes）：token 只发第一方端点；token 永不进日志与 `/usage`、`--usage` 输出；不读不写 `auth.json`，凭据全走 `modelRegistry`。

**第三方缓存兼容**（ccx 式外部工具读缓存文件）：Out of scope。

**`/usage` 命令名冲突**：保持 `/usage`，README 注明与 hknet 扩展共存场景，实现期实测一次 pi 的冲突行为。

**中转站余额：v1 纳入，方案 B 自动探测**（实测背书：4sapi 全通，$200.00 剩 29%；h-company 404 静默隐藏）：
- 当前激活 provider 不属于四家官方 plan 且未被 providerMap 显式映射 → 自动探其 baseUrl 的 `/v1/dashboard/billing/subscription` + `/usage`（one-api/new-api 事实标准）
- `剩余 = hard_limit_usd − total_usage/100`；无 limit 退化为纯文本 `bal $809.97`
- 404/不存在 → 探测一次即缓存"此站无计费端点"，永不再试；失败保留上次有效值 + `⟳` 标记；成功缓存 5 分钟
- 显示：油表条 `bal[████ 29%] $200.00`（remaining% 绿→黄 ≤25%→红 ≤10%）或纯文本（`balance_bar` 配置）
- 货币默认 `$` 可配（部分站 CNY 计价）；全局开关 `show_balance`（默认开）
