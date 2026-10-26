# Claude Pro/Max 订阅用量：直连 API 数据契约

Research ticket: issues/003 (`Research Claude usage API data contract`)。
问题：不走 Claude Code statusline hook，直接从 Anthropic API 查询 Claude Pro/Max 订阅用量时，完整的数据契约是什么。

关键区分：claude-code-usage-bar（cs）的数据来自 Claude Code statusline hook 的 stdin JSON（`rate_limits` 块），**不调用任何 API**。我们的扩展运行在 pi 里，必须走直连 API 路径；直连参考实现是 hknet/pi-usage-bars 的 `fetchClaudeUsageWithFallback`。本文以直连契约为正文，statusline stdin 形状作为字段语义交叉验证（§7）。

除非标注「官方」，端点与响应 JSON 均为社区逆向、无官方文档背书（§9）。

---

## 1. 端点与认证（直连路径）

**请求**（两个独立参考实现完全一致）：

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <access_token>
anthropic-beta: oauth-2025-04-20
```

- URL 与 headers：pi-usage-bars `extensions/usage-bars/core.ts:619-627`（`fetchClaudeUsageAttempt`）；ccstatusline `src/utils/usage-fetch.ts:767-768`（`USAGE_API_HOST='api.anthropic.com'`、`USAGE_API_PATH='/api/oauth/usage'`）与 `:790-793`（Bearer + beta header）。
- openusage-cli `docs/providers/claude.md`（克隆于 /tmp/wayfinder-refs）额外要求 `Accept: application/json`、`Content-Type: application/json`；ccstatusline/pi-usage-bars 未显式发送也成功，说明二者非硬性。
- `anthropic-beta: oauth-2025-04-20` 是**硬性**的：缺失时返回 401 `{"type":"error","error":{"type":"authentication_error","message":"OAuth authentication is currently not supported."}}`（GitHub rjyo/moshi-skill issue #1 实测记录，https://github.com/rjyo/moshi-skill/issues/1）。该常量在**官方** anthropic-sdk-go 中有定义：`config/federation.go:38` `OAuthAPIBetaHeader = "oauth-2025-04-20"`，注释说明它「required on authenticated API requests using an OAuth bearer token, and on refresh_token grants against the token endpoint」。

**Token 来源（OAuth access token，非 API key）**：

- 本扩展（pi 内）：pi 自己的 Anthropic OAuth 登录。pi-usage-bars `index.ts:634-645`（`resolveCredential`）：`ctx.modelRegistry.getProviderAuth("anthropic")` → `resolved.auth.apiKey`（或 `auth.headers.Authorization` 去掉 `Bearer ` 前缀），并用 `resolved.source === "OAuth"` 判断是订阅 OAuth 而非 API key（`index.ts:638,648-652`）。**我们不需要碰 Claude Code 的凭证文件**；token 刷新是 pi 的职责。
- （对照）Claude Code 自身存取：macOS Keychain service `Claude Code-credentials` 或 `~/.claude/.credentials.json` 的 `claudeAiOauth.accessToken`（ccstatusline `usage-fetch.ts:574`、`UsageCredentialsSchema :98-103`；openusage-cli `docs/providers/claude.md`）。
- Token 本身是短期 JWT；过期需刷新：`POST https://platform.claude.com/v1/oauth/token`，JSON body `{grant_type:"refresh_token", refresh_token, client_id:"9d1c250a-e61b-44d9-88ed-5944d1962f5e"}`，响应 `{access_token, refresh_token, expires_in(秒)}`（opencode-anthropic-auth `docs/claude-code-auth-and-headers-reference.md` §1.4-1.6，逆向自 Claude Code OSS 仓库并逐文件引用；官方 Go SDK 亦定义 `TokenEndpoint = "/v1/oauth/token"`，federation.go:25）。对 pi 扩展而言刷新由 pi 完成，本节仅作背景。

**用法**：单次 GET，无查询参数；usage 端点与模型无关（一个账号一份窗口）。

## 2. 响应 JSON（逐字段）

### 2.1 平铺形状（legacy，目前仍是主形态）

```jsonc
{
	"five_hour": {
		// 5 小时会话窗口；Enterprise 账号可为 null 或缺失
		"utilization": 25, // 已用百分比，整数 0-100；可 >100（超额态）
		"resets_at": "2026-01-28T15:00:00Z" // ISO 8601 UTC 字符串
	},
	"seven_day": {
		// 周窗口；同样可 null/缺失
		"utilization": 40,
		"resets_at": "2026-02-01T00:00:00Z"
	},
	"seven_day_sonnet": { "utilization": 0, "resets_at": "..." }, // 可选，按模型的周配额（legacy 平铺键）
	"seven_day_opus": { "utilization": 0, "resets_at": "..." }, // 可选
	"extra_usage": {
		// 可选：超额付费额度（usage credits）
		"is_enabled": true,
		"used_credits": 500, // 已用，单位美分
		"monthly_limit": 10000, // 月上限，美分
		"utilization": 12.5, // 较新字段：extra usage 自身百分比（ccstatusline 解析）
		"currency": "USD" // 较新字段：ISO 4217（ccstatusline 解析）
	}
}
```

字段依据：pi-usage-bars `core.ts:635-648`（读 `five_hour.utilization`、`seven_day.utilization`、`*.resets_at`、`extra_usage.is_enabled/used_credits/monthly_limit`）；ccstatusline `usage-fetch.ts` `UsageApiBucketSchema`（`utilization: number|null`、`resets_at: string|null`，:159-162）与 `UsageApiResponseSchema`（:171-181，含 `seven_day_sonnet/seven_day_opus` 与 `extra_usage` 五字段）；openusage-cli `docs/providers/claude.md`（明确「Utilization: integer percentage (0-100)」「Credits: cents」「Timestamps: ISO 8601」及带注释示例）。

`utilization` 数值细节：
- 正常为 0-100 整数（openusage-cli 文档；ccstatusline 直接当百分比用，无 0-1 换算）。
- pi-usage-bars 防御性兼容 0-1 小数：`readPercentCandidate`（`core.ts:413-417`）对 `<=1` 的非整数乘 100，对整数 0/1 原样保留（歧义按 0%/1% 处理）。这暗示历史上出现过小数形态；新实现建议按 0-100 处理并防御小数。
- 可超过 100（超额指示；见 §6 burnout）。

`resets_at` 格式：ISO 8601 UTC 字符串。证据：ccstatusline `usage-windows.ts:243-258` `formatUsageResetAt` 用 `Date.parse(resetAt)` 解析 API 返回值；pi-usage-bars `core.ts:298-302`（`formatResetsAt`）`new Date(isoDate)`；openusage-cli 示例直接给 ISO 字符串。注意与 statusline stdin 的 epoch 秒不同（§5）。

### 2.2 新形状：`limits[]` 数组（账号逐步迁移中）

部分已迁移账号不再填平铺桶（缺失/为 null），改报同语义的数组（ccstatusline `usage-fetch.ts:152-158` 注释，引用其 issue #503；schema `UsageApiLimitSchema` :160-168）：

```jsonc
{
	"limits": [
		{ "kind": "session", "percent": 25, "resets_at": "ISO" },
		{ "kind": "weekly_all", "percent": 40, "resets_at": "ISO" },
		{
			"kind": "weekly_scoped",
			"percent": 10,
			"resets_at": "ISO",
			"scope": { "model": { "display_name": "Claude ... Sonnet" } }
		}
	]
}
```

- `kind` 观察到的取值：`session`、`weekly_all`、`weekly_scoped`（ccstatusline `usage-fetch.ts:318-319,210-214`）。
- `percent` = 百分比（对应 `utilization`）；`resets_at` 同为 ISO 字符串。
- `weekly_scoped` 是按模型族的周配额，模型用 `scope.model.display_name` 标识，匹配需大小写不敏感 + 子串（ccstatusline `usage-fetch.ts:206-214`，模型族见其 `usage-types.ts:73-76`：Sonnet、Opus、Fable；legacy 平铺键 `seven_day_sonnet/seven_day_opus` 是其旧形态，Fable 无 legacy 键）。
- 占位条目陷阱：`percent=0 && resets_at=null` 的非 scoped 条目不是真实窗口（Enterprise/无配额），不得当成「真 0%」；带具体模型名的 `weekly_scoped` 例外——模型未用时就是 0%（`usage-fetch.ts:177-201` 注释及 `isPlaceholderUsageApiLimit`）。
- 合并策略（ccstatusline `parseUsageApiResponse` :308-350）：平铺桶优先，缺失字段逐个回退到对应 `limits[]` 条目（百分比和 resets_at 可各来自不同来源）。

### 2.3 空值/缺失语义

- Enterprise 账号无 rate-limit 窗口：桶为 null → 按 0% 且无 resets_at 处理，且这是「结论性缺失」，不必重试（ccstatusline #343 注释，:82-87）。
- 响应本身是松散对象（ccstatusline 用 `z.looseObject`），未知字段直接透传忽略——向前兼容靠「只取已知字段」。

## 3. 配额窗口语义（官方）

官方 support 文档（均为一手来源，2026-02 时点）：

- Pro 与 Max 都有**5 小时会话限额 + 周限额**，两种限额在 Claude 应用（web/桌面/移动）与 Claude Code 间共享。Max 计划另有**Fable 的独立周限额**（support.claude.com/en/articles/11145838「Use Claude Code with your Pro or Max plan」）。
- 5 小时窗口：每 5 小时重置（support.claude.com/en/articles/8325606 Pro、/11049741 Max）。cs 源码佐证它是**滚动会话窗口**（锚定会话开始，而非整点）：claude-code-usage-bar `core.py:543-545`「the rolling 5h window is anchored to session start, never to a 14:00 wall-clock」。
- 周窗口：在**账号固定的每周时间点**重置，与何时开始使用/订阅无关；可在 Settings > Usage 查看下次重置时间（同上两篇官方文章）。即 resets_at 不是「首用 +7d」。
- 计划档位与乘数（官方 claude.com/pricing 与 support 11049741）：Pro = 基准；**Max 5x = $100/月，5× Pro 每会话额度；Max 20x = $200/月，20×**。注意：现行官方阵容只有 5x/20x 两档（2025-04 上线即是 5x/20x，Ars Technica 报道）；ticket 前提里的「Max 1x/2x」在当前官方定价页与支持文档中**不存在**，实现时不要按 1x/2x 分支建模。
- 对数据契约的含义：**乘数不出现在 payload 里**。同一 schema 服务所有计划，差异只体现为 utilization 增长速度；`limits[]` 的 `weekly_scoped`（Sonnet/Opus/Fable）与官方「Max 有 Fable 独立周限额」「按模型配额」的描述对应。模型分层（Opus 消耗配额显著快于 Sonnet）也是官方口径（support.claude.com/en/articles/14552983）。

## 4. 重置时间字段与格式（对照表）

| 来源                                    | 字段                                                                 | 格式                                                | 解析方式（参考实现）                                                                                                                         |
| --------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 直连 API `/api/oauth/usage`             | `five_hour.resets_at` / `seven_day.resets_at` / `limits[].resets_at` | ISO 8601 UTC **字符串**（`"2026-01-28T15:00:00Z"`） | `Date.parse`（ccstatusline usage-windows.ts:255）、`new Date(iso)`（pi-usage-bars core.ts:298）                                              |
| statusline stdin（Claude Code ≥2.1.80） | `rate_limits.five_hour.resets_at` 等                                 | **Unix epoch 秒**（数字）                           | `new Date(epochSeconds*1000)`（ccstatusline usage-prefetch.ts:184-189）、`datetime.fromtimestamp(resets_at, tz=utc)`（cs core.py:1470,1482） |

官方 statusline 文档（docs.claude.com/en/docs/claude-code/statusline）原文确认 stdin 侧：「`rate_limits.five_hour.resets_at`, `rate_limits.seven_day.resets_at` — Unix epoch seconds when the 5-hour or 7-day rate limit window resets」。

## 5. Claude Code statusline stdin 的 rate_limits 形状（交叉验证）

官方文档字段（docs.claude.com/en/docs/claude-code/statusline）：

- `rate_limits.five_hour.used_percentage`、`rate_limits.seven_day.used_percentage`：「Percentage of the 5-hour or 7-day rate limit consumed, **from 0 to 100**」（官方口径 0-100）。
- `rate_limits.*.resets_at`：Unix epoch 秒（见 §4）。
- `rate_limits.spend_limit.{used_percentage,resets_at}`：Claude apps gateway 的消费限额；`used_usd/limit_usd/period` 需 Claude Code ≥2.1.284，百分比版 ≥2.1.251（官方文档；ccstatusline StatusJSON.ts:20-26 同形）。
- `seven_day_sonnet`/`seven_day_opus`：官方文档未列，ccstatusline StatusJSON.ts:68-69 按可空桶解析（社区补充）。
- 版本门槛：Claude Code **≥ v2.1.80** 才输出 rate_limits（cs core.py:244-246 `_RATE_LIMITS_MIN_VERSION=(2,1,80)`）；走中转（`ANTHROPIC_BASE_URL` 指向非 api.anthropic.com）或 Bedrock/Vertex 时**结构性缺失**（cs core.py:285+）。

已知脏数据（stdin 侧，cs core.py:105-121）：`used_percentage` 偶发浮点（`56.00000000000001`）、NaN/inf、负值；**已知上游 bug：used_percentage 携带重置 epoch（~1.78e9）而非百分比**，需按上限（cs 用 100000）拒收；>100 是合法超额值，不得截断（cs 渲染层 `progress.py:239` 用 `MAX` 显示 >100）。

语义对照结论：stdin 的 `used_percentage` ≡ API 的 `utilization`（同百分比语义）；stdin 的 `resets_at`（epoch 秒）≡ API 的 `resets_at`（ISO 串）——同一窗口的两种序列化。

## 6. 错误形状与超额态

- **429 限流**：响应带 `Retry-After` 头（秒数或 HTTP-date；pi-usage-bars `parseRetryAfterMs` core.ts:305-311 两种都解析）。参考实现做法：pi-usage-bars 指数退避 2 分钟起步、连续 429 翻倍、30 分钟封顶，`Retry-After` 优先（core.ts:188-190,544-553,687-694），退避期间回退到最近成功快照并标 `stale`；ccstatusline 默认 300 秒退避 + 写锁文件（usage-fetch.ts:32,870-873）。
- **401 认证**：缺 beta header → §1 的 `authentication_error`（"OAuth authentication is currently not supported."）。access token 过期同样表现为 401（ccstatusline 凭证注释：401/403 触发反应式刷新；openusage-cli 文档）。错误体遵循 Anthropic 通用信封 `{"type":"error","error":{"type":"authentication_error"|"rate_limit_error","message":...,"details":{...}},"request_id":"req_..."}`（官方 platform.claude.com/docs/en/api/rate-limits 给出 429 样例；/api/oauth/usage 属同族 API，可按同信封防御性解析）。
- **「burnout」/超额**：payload 中**没有专门字段或状态**。超额就是 `utilization` 高位（可 >100；cs 明确「values >100% are valid for over-quota indicators」core.py:106）。消费侧把 ≥100 且 resets_at 未到渲染为 MAX/警戒态（cs progress.py:239、predict.py:1056）。另有 `extra_usage.is_enabled=true` 表示用户启用了超额付费继续用（官方：达到限额后可启用 usage credits 继续使用，support 11145838）。
- **无配额**：Enterprise/中转账号 → 窗口缺失或 null（§2.3），不是错误。

## 7. 参考实现细节：fetchClaudeUsageWithFallback（pi-usage-bars）

- 位置：`/tmp/wayfinder-refs/pi-usage-bars/extensions/usage-bars/core.ts:655-697`。
- 共享缓存：`$TMPDIR/pi/usage-bars-cache.json`（core.ts:195），版本字段 `version:1`，只存用量值不存凭证；成功结果 **2 分钟新鲜 TTL**（core.ts:188）跨 pi 进程共享。
- 文件锁 `${cacheFile}.claude.lock`（wx 创建、20 秒陈旧锁可抢、最长等 4 秒，core.ts:191-194）防多进程同时打 API。
- 429：按 §6 退避并把 `cooldownUntil` 写入缓存；期间返回带 `stale`/`warning` 的旧值。
- 超时 12 秒（core.ts:186），AbortSignal 透传。
- 渲染输入：`session`/`weekly` 百分比 + `sessionResetsAt/weeklyResetsAt`（ISO）→ `hydrateUsageResets` 现算 `*ResetsIn` 倒计时（core.ts:492-498），即缓存里存绝对时间、渲染时算相对时间。

## 8. 官方 vs 社区文档现状

| 内容                                                                    | 状态                                                     | 来源                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 窗口语义（5h/周/Fable 独立/共享/固定重置点）、计划档位 5x/20x           | **官方**                                                 | support.claude.com 8325606 / 11049741 / 11145838；claude.com/pricing                                                                                                                                             |
| statusline stdin `rate_limits.*` 字段（含 spend_limit、版本门槛）       | **官方**                                                 | docs.claude.com/en/docs/claude-code/statusline                                                                                                                                                                   |
| `oauth-2025-04-20` beta header、`/v1/oauth/token`                       | **官方 SDK 常量**（端点语义即「OAuth bearer 请求必带」） | anthropics/anthropic-sdk-go config/federation.go:25,38                                                                                                                                                           |
| `/api/oauth/usage` 端点本身、响应 JSON（平铺桶、limits[]、extra_usage） | **社区逆向，无官方文档，随时可变**                       | pi-usage-bars、ccstatusline（#343/#503/#413 注释）、openusage-cli（自述「Reverse-engineered, undocumented API. May change without notice.」）、opencode-anthropic-auth、Rust usus/cship/vct-core、moshi-skill #1 |
| OAuth 流程细节（client_id、PKCE、JSON body、Keychain）                  | **社区逆向**（但对 Claude Code OSS 逐行引用）            | opencode-anthropic-auth docs/claude-code-auth-and-headers-reference.md                                                                                                                                           |

对实现的要求：按「松散解析 + 逐字段回退」设计（平铺桶优先、`limits[]` 回退），未知字段忽略，percent/resets_at 各自独立回退，与 ccstatusline 同策略。

## 9. 对本扩展（pi-usage-bar）的落地建议

1. 端点/头照 §1；token 取 pi 的 anthropic provider OAuth 凭证（`source === "OAuth"` 时才启用 Claude 用量条，API-key 用户隐藏）。
2. 解析顺序：`five_hour/seven_day` → `limits[]`（session/weekly_all，可加 weekly_scoped 的 Sonnet/Opus/Fable）→ `extra_usage`。百分比按 0-100，防御 0-1 小数与 >100（保留超额显示）及 epoch 泄漏值（≥100000 拒收）。
3. `resets_at`：API 侧 ISO 字符串；渲染倒计时存绝对时间、显示时现算。
4. 429/401 处理 + 跨进程缓存照 §7（2 分钟 TTL + 锁 + 退避），避免多 pi 实例打爆端点。

## Confidence & open questions

**置信度**：
- 端点 URL、认证头（高）：两个独立成熟实现 + 多语言复刻 + 官方 SDK beta 常量互证。
- 平铺响应字段名与语义（高）：pi-usage-bars/ccstatusline/openusage-cli 三方一致，且与官方 stdin 文档字段语义对得上。
- `limits[]` 形状（中高）：仅 ccstatusline 一手实现（其 #503），`kind` 取值集合可能不完整（未来新 kind 会以未知条目出现）；需松散解析兜底。
- `extra_usage.utilization/currency`（中）：仅 ccstatusline 解析，openusage-cli 示例未含。
- ISO vs epoch 格式差异（高）：官方 stdin 文档 + 三方实现对 API 侧 ISO 的一致用法。
- 窗口语义/档位（高）：官方支持文档原文。

**开放问题**：
1. `utilization` 是否在任何现存账号上仍返回 0-1 小数？pi-usage-bars 的防御暗示见过，无一手样本。
2. `limits[]` 迁移的覆盖面与时间线；`kind` 是否会出现 `session_scoped` 之类新值？未观察到。
3. `extra_usage.monthly_limit = 0` 是否真表示「无上限」（openusage-cli 注释说法，单一来源）。
4. `/api/oauth/usage` 的 429 响应体是否带官方文档那样的 `rate_limit_error` details（实现都只读 header，未见 body 样本）。
5. 周窗口 `resets_at` 的「固定账号时间点」是否总是整周间隔（官方说固定时间点，未承诺恰 7d）。
6. Fable 的 `weekly_scoped` 在非 Max 账号是否完全不出现（ccstatusline 视「缺失=无配额」处理，合理但未验证）。

## 引用清单（本地克隆于 /tmp/wayfinder-refs/）

- hknet/pi-usage-bars：`extensions/usage-bars/core.ts`（fetchClaudeUsageAttempt :615-649、fetchClaudeUsageWithFallback :655-697、常量 :186-199、readPercentCandidate :413、parseRetryAfterMs :305、cache :333-343）；`extensions/usage-bars/index.ts:634-652`（token 解析）。
- leeguooooo/claude-code-usage-bar：`src/claude_statusbar/core.py`（stdin 解析 :100-180、版本门槛 :244-246、中转判定 :285+、倒计时 :1469-1492）；`quota_cache.py`（10 分钟快照过期 MAX_AGE_SECONDS=600）。
- sirmalloc/ccstatusline：`src/utils/usage-fetch.ts`（schema :96-181、parseUsageApiResponse :308-350、请求 :767-806、429 :868-873、凭证 :574）；`src/utils/usage-types.ts:73-76`；`src/utils/usage-prefetch.ts:184-231`；`src/utils/usage-windows.ts:243-258`；`src/types/StatusJSON.ts:12-69`。
- rmk40/opencode-anthropic-auth：`docs/claude-code-auth-and-headers-reference.md` §1（OAuth 流程/端点/client_id）。
- MWZ-Code/openusage-cli：`docs/providers/claude.md`（完整契约示例）。
- anthropics/anthropic-sdk-go（官方）：`config/federation.go:25,38`。
- 官方文档：docs.claude.com/en/docs/claude-code/statusline；platform.claude.com/docs/en/api/rate-limits；support.claude.com/en/articles/8325606、11049741、11145838、14552983；claude.com/pricing、claude.com/pricing/max。
- 社区实测：github.com/rjyo/moshi-skill/issues/1（401 样例）。
