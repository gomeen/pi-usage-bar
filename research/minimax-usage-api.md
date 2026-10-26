# MiniMax Coding Plan / Token Plan usage API — complete data contract

Research date: 2026-10-20. Question: what is the complete data contract for MiniMax Coding Plan (now "Token Plan" / "M Plan") usage, international and China variants, as needed to build pi-usage-bar's MiniMax bars?

Method: source-code and documentation research only. No credentials used, no authenticated calls made. Primary sources are numbered `[S#]` and listed at the end; every claim cites one.

---

## 1. Endpoints

### 1.1 The four endpoints in play

| Purpose | URL | Status |
|---|---|---|
| Global, current | `https://api.minimax.io/v1/token_plan/remains` | Current; used by hknet [S1], MiniMax CLI (`mmx`) [S2], cc-switch [S7] |
| Global, legacy | `https://api.minimax.io/v1/api/openplatform/coding_plan/remains` | Legacy Coding Plan path; still works for some keys [S5] [S8] [S9] |
| CN, current | `https://api.minimaxi.com/v1/token_plan/remains` | Current CN; hknet [S1], mm CLI (pre-main-branch form) [S2-PR104], OpenTokenUsage [S6], cc-switch comment [S7] |
| CN, legacy | `https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains` | Legacy CN path [S5] [S10] |

### 1.2 Host aliasing (important)

The same route is served under several hosts, and sources disagree on which is "canonical":

- Official FAQ docs show `https://www.minimax.io/v1/token_plan/remains` (global) [S3] and `https://www.minimax.cn/v1/token_plan/remains` (CN) [S4] in their curl examples — note **`www.` hosts, not `api.`**.
- MiniMax's own CLI resolves the quota host as `https://api.minimax.io` (global) / `https://api.minimaxi.com` (older) and on current main `https://api.minimax.cn` (CN region default), always on the `api.` subdomain [S2]. PR #104 verified via curl that "both `minimaxi.com` and `minimax.io` domains work" [S2-PR104].
- OpenTokenUsage uses `www.minimax.io` for global and `api.minimaxi.com` for CN [S6].
- cc-switch notes (in Chinese) that the quota endpoint is only publicly documented on `api.minimaxi.com` / `api.minimax.io`; the newer CN inference domain `api.minimax.cn` had no documented quota route, and cc-switch therefore pins the old CN domain (same account system and keys) [S7].
- Community reports: `www.minimax.com` sits behind a Cloudflare challenge returning HTML; `api.minimax.io` returns JSON [S5-comment].

Practical takeaway: treat `api.minimax.io` / `api.minimaxi.com` as the working API hosts and make every part (host and path) overridable, as hknet does via `PI_MINIMAX_USAGE_ENDPOINT` etc. [S1].

### 1.3 When each endpoint applies

- **Current vs legacy path**: MiniMax renamed the product from "Coding Plan" to "Token Plan" (subscription tiers now marketed as "M Plan"). The route moved from `/v1/api/openplatform/coding_plan/remains` to `/v1/token_plan/remains`; MiniMax's own CLI switched in PR #104 (merged 2026-04-16, "Switch quota endpoint from `v1/api/openplatform/coding_plan/remains` to `v1/token_plan/remains`") [S2-PR104]. The official FAQ now only documents the `token_plan` route [S3][S4].
- **Legacy path still live but flaky**: with an API-key Bearer, the legacy route works for some accounts and returns `{"base_resp":{"status_code":1004,"status_msg":"cookie is missing, log in again"}}` for others (web-session-gated); behavior differs between international and CN keys and even between users [S5]. The UCP issue asked for exactly the migration hknet implemented: query the new endpoint first, keep the legacy endpoint as fallback [S8].
- **Region**: the CN and international products are separate accounts/keys; use the matching host. A CN key on the international host (or vice versa) fails — m2#88 commenters confirm the `.io` host serves international Coding Plan keys and `api.minimaxi.com` serves CN keys [S5-comment].
- hknet's fetch order: `[token_plan, coding_plan]` per region, trying candidates in order until one yields a usable payload [S1].

## 2. Auth

- `Authorization: Bearer <key>` plus `Accept: application/json` / `Content-Type: application/json` [S1][S2][S3][S6][S9].
- GET request, no query parameters, no body [S3][S9].
- Key taxonomy (official): a **Subscription Key** (Token Plan / M Plan key) "only uses your M Plan usage and is not interchangeable with a pay-as-you-go API Key" [S3-intro/quickstart]. Subscription keys are visible in the console under personal info / API Keys [S3].
- MiniMax's CLI distinguishes key types by prefix: keys starting `sk-api-` are pay-as-you-go "secret API keys" and get routed to a *different* endpoint, `<base>/account/query_balance` (note: no `/v1` prefix), instead of the quota endpoint [S2-endpoints.ts]. An m2#88 reporter's subscription key had prefix `sk-cp-...` ("cp" = coding plan, presumably) [S5].
- The legacy CN endpoint reportedly requires a "Coding Plan API Key, 专用于 Coding Plan 套餐" (dedicated to the Coding Plan subscription) [S10].
- OAuth access tokens also work as the Bearer credential for the quota endpoint in `mmx` [S2].

## 3. Response JSON structure

### 3.1 Envelope

```json
{
  "base_resp": { "status_code": 0, "status_msg": "success" },
  "model_remains": [ { ...model entry... }, ... ]
}
```

- `base_resp.status_code`: `0` = success; non-zero = business-level error (see §6) [S2][S6][S7].
- `model_remains` sits at the root in the official CLI fixture [S2-fixture]; some deployments/versions nest everything under `data` (`{"data": {"base_resp": ..., "model_remains": ...}}`) — hknet and OpenTokenUsage both accept `payload.data ?? payload` [S1][S6].
- Optional plan-name string fields observed/defended at root or `data`: `plan_name`, `plan`, `current_subscribe_title`, `current_plan_title`, `combo_title` [S6].

### 3.2 `model_remains[]` entry — the authoritative field list

From MiniMax's own CLI type definition and fixture [S2], cross-checked against [S1][S6][S7][S9][S10]:

| Field | Type | Meaning |
|---|---|---|
| `model_name` | string | Quota bucket name: `"MiniMax-M*"` / `"general"` (coding/text), `"video"`, `"speech-hd"`, `"image-01"`, etc. cc-switch: only `general` is the coding bucket; skip `video` [S7]. |
| `start_time` | int, epoch **ms** | Start of the current interval (rolling 5h) window [S2][S9]. |
| `end_time` | int, epoch **ms** | End of the current interval window — the authoritative interval reset time [S2][S7][S9]. |
| `remains_time` | int | Time until the window resets. CLI fixture value `7151954` only makes sense as **ms** against a 5h window [S2-fixture]; the CN community doc for the legacy endpoint documents it as **seconds** of the *subscription period*, explicitly "和5小时窗口无关" (unrelated to the 5h window), example `8277752` [S10]. Unit is genuinely ambiguous across deployments — see §5. |
| `current_interval_total_count` | int | Total requests/prompts in the interval window. `0` = window not applicable [S2]. |
| `current_interval_usage_count` | int | **Ambiguous — see §3.4.** Legacy responses: remaining count. Newer responses: consumed count [S2-utils/quota.ts]. |
| `current_interval_remaining_percent` | number, optional | Remaining percent, 0–100. The authoritative utilization signal; used = `100 − value` [S2][S6][S7]. May be absent (CLI fixture omits it) [S2-fixture]. |
| `current_interval_status` | int, optional | Server-side window status: `1` = normal/limited, `2` = exhausted, `3` = unlimited [S2-quota-table comment]. |
| `current_weekly_total_count` | int | Total for the weekly (7-day) window; `0` = no weekly quota for this model (e.g. video-only or plan without weekly cap) [S2][S7]. |
| `current_weekly_usage_count` | int | Weekly count, same ambiguity as interval [S2]. |
| `current_weekly_remaining_percent` | number, optional | Weekly remaining percent 0–100 [S6][S7]. |
| `current_weekly_status` | int, optional | Same enum; `1` = weekly window active, `3` = unlimited/not-applicable (then `remaining_percent` is pinned at 100 and must not be shown as a quota) [S2][S7]. |
| `weekly_start_time` / `weekly_end_time` | int, epoch ms | Weekly window bounds; `weekly_end_time` is the weekly reset time [S2][S7]. |
| `weekly_remains_time` | int | ms (per CLI fixture, `248351954` ≈ 2.9 days) until weekly reset [S2-fixture]; same unit caveat as `remains_time`. |
| `weekly_boost_permille` | int, optional | Weekly display multiplier in permille: rendered weekly value = base percent × permille/1000 (`1500` ⇒ plan shows up to 150%); CLI caps display at 200% [S2]. |

Official fixture (real shape, `mmx` test fixture "updated to match real API response format") [S2-fixture/PR104]:

```json
{
  "base_resp": { "status_code": 0, "status_msg": "success" },
  "model_remains": [
    {
      "model_name": "MiniMax-M*",
      "start_time": 1776355200000,
      "end_time": 1776373200000,
      "remains_time": 7151954,
      "current_interval_total_count": 1500,
      "current_interval_usage_count": 228,
      "current_weekly_total_count": 0,
      "current_weekly_usage_count": 0,
      "weekly_start_time": 1776009600000,
      "weekly_end_time": 1776614400000,
      "weekly_remains_time": 248351954
    },
    { "model_name": "speech-hd", "...": "..." },
    { "model_name": "image-01", "...": "..." }
  ]
}
```

### 3.3 Which model entry to show

- hknet picks the window with the **highest used percent** across all `model_remains` entries, separately for interval and weekly, and skips windows whose status is `3` with `remaining_percent >= 100` and both counts `0` (unavailable) [S1]. lean-quota-monitor does the same max-used selection using only the `remaining_percent` fields [S6-lqm].
- cc-switch instead selects only `model_name == "general"` and ignores `video` etc. [S7].
- MiniMax's CLI renders one row per model entry [S2].
- For a single footer bar, max-used across entries (hknet/lean-quota) or the `general`/`MiniMax-M*` text bucket (cc-switch/mm CLI) are both defensible; the text/coding bucket is the one relevant to a coding plan.

### 3.4 The `*_usage_count` ambiguity (critical, first-party acknowledged)

Three interpretations exist in the wild:

1. **Remaining count** (legacy): used = `total − usage_count`. Documented by the CN community field table with an explicit warning ("`current_interval_usage_count` 是剩余用量，不是已用量！") [S10]; implemented by AungMyoKyaw's checker (`currentIntervalRemainingCount = current_interval_usage_count`) [S9] and OpenTokenUsage ("coding_plan/remains commonly returns remaining prompts in current_interval_usage_count") [S6]; hknet's tests encode the same reading ("usage_count is the remaining count, so used = total - usage_count") [S1-test].
2. **Used count** (newer): MiniMax CLI PR #104 changed the CLI to `used = m.current_interval_usage_count` with commit message "Fix usage calculation: `current_interval_usage_count` is used count, not remaining", verified against the live API by curl on both domains [S2-PR104].
3. **First-party resolution heuristic** (current `mmx` main): `resolveQuotaCounts()` documents that "Older responses use the fields as remaining counts, while newer responses may use them as consumed counts. When the server also returns an explicit remaining percentage, use it to select the interpretation that agrees with the authoritative percentage. Without a percentage, preserve the legacy remaining-count interpretation." It compares `count/total` vs `(total−count)/total` against `current_*_remaining_percent`, picks the interpretation within 1 percentage point, and **drops the counts entirely** if neither matches [S2-utils/quota.ts].

Implementation guidance for pi-usage-bar: trust `current_*_remaining_percent` for the bar (used = 100 − remaining); derive counts only with the mm-style percent-agreement check; never show counts that contradict the percent.

### 3.5 The `services` array (hknet defensive shape, uncorroborated)

hknet's parser also accepts a sibling shape: `data.services[]` with `service_type` (`"standard"`/`"highspeed"`), `window_type` (`"weekly"` vs anything else = interval/rolling), `percent` (0–1 or 0–100) or `usage`/`limit` counts, and `resets_at`/`reset_time`/`end_time` [S1]. No other implementation or official source shows a `services` array; treat it as hknet's defensive fallback, not a documented contract. Window semantics in hknet: `window_type` containing "week" → weekly bar; otherwise interval bar labeled "Interval" [S1].

### 3.6 Count semantics by region (display only)

- Global totals are **prompt counts** (plan tiers 100/300/1000/2000 = Starter/Plus/Max/Ultra) [S6].
- CN totals are **model-call counts** = prompts × 15 (600/1500/4500 = Starter/Plus/Max); "一个 prompt 约等于 15 次模型调用" [S6][S10]. The example counts "50/200" in this project's ticket correspond to these raw count fields, which hknet displays unitless because "Kimi and MiniMax do not document what those counts measure" [S1-README].

## 4. Token Plan key vs Credits-only key

What each key type returns:

- **Active Token/M/Coding Plan key** → HTTP 200 with `base_resp.status_code = 0` and a non-empty `model_remains` array [S2][S6]. Windows per official docs: text/image/audio/non-video models have both a **5-hour rolling window and a weekly window**; video models have only a weekly window. Both windows start at first use (5h lasts 5 hours; weekly lasts 7 days), reset independently, and do not carry over [S3-FAQ].
- **Credits-only / pay-as-you-go key** (`sk-api-` prefix) → the quota endpoint is the wrong surface; MiniMax's CLI sends these keys to `<base>/account/query_balance` instead, which returns an `AccountBalanceResponse`: `{ available_amount, cash_balance, voucher_balance, credit_balance, owed_amount, balance_alert_switch, balance_alert_threshold, base_resp }` (string amounts) [S2-types/endpoints].
- **No active Token Plan subscription** → payload-level error `base_resp.status_code = 2062` ("no active token plan subscription"); hknet renders this as a neutral "No active Token Plan · check Credit balance in the MiniMax console" state, not an error [S1][S1-CHANGELOG]. `2062` appears only in hknet, not in the community error table [S10] — hknet-observed.
- Some responses may include a credit balance alongside the error: hknet accepts `points_balance`/`point_balance`/`credits_balance`/`credit_balance` (camelCase variants too) at `data` level and renders it as a neutral "Credit balance" line when no quota windows exist [S1].
- Official docs: MiniMax "currently exposes Credits-only balances through a console endpoint requiring browser-cookie authentication", so a key-only Credits account cannot be probed without cookies; hknet deliberately does not import browser cookies and shows the notice instead [S1-README]. The CLI's `/account/query_balance` path is the first-party, key-authenticated alternative for `sk-api-` keys [S2].

## 5. Reset times and derivation

Authoritative order (matches hknet's `miniMaxResetAt` and every other source):

1. **Explicit ISO field** — hknet checks `current_resets_at`/`weekly_resets_at` first (ISO string; not corroborated elsewhere, defensive) [S1].
2. **`end_time` / `weekly_end_time`** — epoch milliseconds (values like `1776373200000`; `> 1e12` ⇒ ms, else seconds — hknet's `isoFromEpoch` heuristic). This is the primary reset timestamp used by mm CLI's window bounds, lean-quota, cc-switch, and OpenTokenUsage [S1][S2][S6-lqm][S7][S9].
3. **Derive from `remains_time` / `weekly_remains_time`** — hknet's fallback when no `end_time`: `resetAt = now + remains_time`, with a unit heuristic: raw `> 1_000_000` ⇒ already ms, else seconds (`resetFromRemains`) [S1]. OpenTokenUsage instead infers the unit by comparing both readings against `end_time − now` when present, or by capping at the known 5h window length (`5h ± 10min` tolerance); it also treats `remains_time` as possibly a subscription-period countdown rather than a window countdown [S6][S10].

Window context: the interval window length is `end_time − start_time` (5h for text models, 1d for speech/image in the fixture; mm CLI prints it as a "5h"/"1d"/"1w" tag) [S2-fixture/quota-table]. Windows are rolling-from-first-use, not calendar-aligned [S3-FAQ]; the CN community doc notes window display times in UTC+8 [S10]. No `Retry-After`-style header usage is documented for this endpoint; 429 handling is via HTTP status or `base_resp` code (§6).

Recommendation for pi-usage-bar: prefer `end_time`/`weekly_end_time`; fall back to `now + remains_time` with the unit disambiguated by alignment against `end_time` when both exist; do not trust `remains_time`'s unit blindly.

## 6. Error shapes

Two layers:

**HTTP status** (with a JSON body that may carry `base_resp` or an OpenAI-style `error: {message, type, code, http_code}` object) — mapping from MiniMax CLI's error handler [S2-errors]:

- `401` / `403` → invalid/rejected key ("API key rejected").
- `429` → rate limit or quota exceeded.
- `402` or `error.type == "insufficient_balance_error"` → quota/balance exhausted.
- `408`/`504` → timeout. (hknet treats 401/403 as credential errors and records the last other failure string [S1].)

**Payload-level (`base_resp.status_code` inside HTTP 200)** — codes observed across sources:

| Code | Meaning | Source |
|---|---|---|
| `0` | success | all |
| `1004` | "cookie is missing, log in again" — auth/session failure on the (legacy) endpoint for keys it doesn't accept; OpenTokenUsage maps 1004 or messages containing "cookie"/"log in" to an auth error | [S5][S6] |
| `2062` | no active Token Plan subscription (Credits-only key) — hknet treats as neutral account state | [S1] |
| `2049` | invalid API Key | [S10] |
| `2013` | parameter error | [S10] |
| `1002` | request rate limit exceeded (also used for content-filter in other CLI contexts) | [S10][S2] |
| `2056` | Coding Plan resource limit exceeded — wait for next window | [S10] |
| `1000`/`1024`/`1033` | system/internal errors | [S10] |

`base_resp` may sit at root or under `data`; hknet checks both (`data.base_resp ?? root.base_resp`), tolerating camelCase `baseResp`/`statusCode`/`statusMsg` [S1][S6]. An empty/absent `model_remains` with status 0 is "no quota data" (OpenTokenUsage throws a parse error) [S6-lqm].

## 7. Official documentation

- **International FAQ** — platform.minimax.io/docs/m-plan/faq: "How can I check M Plan usage?" gives three methods: console usage page, `mmx quota` CLI, and the API endpoint (curl to `https://www.minimax.io/v1/token_plan/remains` with Bearer key). Also documents the window model (5h + weekly from first use; video weekly-only; no rollover; credit packs valid 1 year; subscription usage consumed before credit packs; Subscription Key never charges account balance) [S3].
- **CN FAQ** — platform.minimaxi.com/docs/token-plan/faq: same content in Chinese, endpoint `https://www.minimax.cn/v1/token_plan/remains` [S4].
- **Token Plan intro / quickstart** — platform.minimax.io/docs/token-plan/intro and /quickstart: M Plan tiers (Go/Explore/Build), Subscription Key vs pay-as-you-go API Key, key management in console/personal-info [S3-intro].
- **No official API reference for the response**: the platform API reference does not document `token_plan/remains`'s response schema (checked platform.minimax.io/docs/api-reference) — the FAQ shows only the request. The response contract is reconstructed from MiniMax's own CLI source and fixtures [S2], which is the most authoritative available source.
- MiniMax's first-party CLI: github.com/MiniMax-AI/cli (`mmx`), 2.2k stars, official MiniMax org — `mmx quota show` implements the full contract [S2].

## 8. Source list

- [S1] hknet/pi-usage-bars @ main — `extensions/usage-bars/core.ts` (`fetchMiniMaxUsage`, `extractMiniMaxUsageFromPayload`, `miniMaxResetAt`, `resetFromRemains`, endpoint constants lines 199–202), `tests/usage-bars-core.test.ts` (MiniMax cases incl. 2062 and Credits-only), README, CHANGELOG. Cloned to /tmp/wayfinder-refs/pi-usage-bars.
- [S2] MiniMax-AI/cli @ main (official) — `src/types/api.ts` (`QuotaModelRemain`, `AccountBalanceResponse`), `src/client/endpoints.ts`, `src/client/http.ts`, `src/sdk/quota/index.ts`, `src/utils/quota.ts` (`resolveQuotaCounts`), `src/output/quota-table.ts` (status enum, boost permille, unavailable detection), `src/config/schema.ts` (region hosts), `src/errors/api.ts`, `test/fixtures/quota-response.json`, PR #104 (merged 2026-04-16). Cloned to /tmp/wayfinder-refs/mm-cli; PR via api.github.com.
- [S3] platform.minimax.io/docs/m-plan/faq, /docs/token-plan/intro, /docs/token-plan/quickstart (fetched 2026-10-20 via curl; SSR HTML).
- [S4] platform.minimaxi.com/docs/token-plan/faq (+ intro/quickstart), CN.
- [S5] github.com/MiniMax-AI/MiniMax-M2 issue #88 "API endpoint /coding_plan/remains requires cookie session instead of API Key" + comments (1004 cookie error; www.minimax.com Cloudflare; api.minimax.io JSON; CN vs international host behavior). Via api.github.com.
- [S6] OpenTokenUsage `plugins/minimax/plugin.js` + `plugin.test.js` (www.minimax.io global / api.minimaxi.com CN; percentage mode; plan-tier inference; 1004/429 payload errors; remains-time unit inference); lean-quota-monitor `src/providers/minimax.ts` (www.minimax.io; remaining_percent + end_time). Cloned to /tmp/wayfinder-refs.
- [S7] cc-switch `src-tauri/src/services/coding_plan.rs` (legacy endpoint on api.minimaxi.com/api.minimax.io; `general` vs `video` buckets; weekly status 1 vs 3; api.minimax.cn quota undocumented). /tmp/wayfinder-refs/zai-repos/cc-switch.
- [S8] github.com/smallmain/vscode-unify-chat-provider issue #294 (feature request: migrate UCP from legacy coding_plan endpoint to token_plan; documents both endpoints and their separation from pay-as-you-go credit). Via api.github.com.
- [S9] AungMyoKyaw/minimax-usage-checker (Swift) — `MiniMaxAPIService.swift` (legacy api.minimax.io endpoint, Bearer), `CodingPlanModels.swift` (`current_interval_usage_count` decoded as remaining count; ms timestamps). /tmp/wayfinder-refs/mm-checker.
- [S10] ClawHub skill "minimax-usage-cn" (clawhub.ai/lanhaixuan/minimax-usage-cn) — CN legacy endpoint spec `GET https://www.minimaxi.com/v1/api/openplatform/coding_plan/remains`, field table (remains_time seconds/subscription-cycle; usage_count = remaining), error-code table (2013/1004/2049/1002/2056/1000/1024/1033), UTC+8 windows, prompts×15. Community source; fetched 2026-10-20.

## 9. Confidence & open questions

**High confidence** (multiple independent sources incl. first-party):
- Endpoint URLs and their current/legacy split; Bearer auth; GET with no params.
- Envelope `{base_resp, model_remains}` (root or `data`-nested); field names and window model (5h interval + weekly; status enum 1/2/3; 0-count = not applicable).
- `current_*_remaining_percent` is remaining 0–100; used = 100 − it; highest-used window selection.
- `end_time`/`weekly_end_time` are epoch-ms reset timestamps.
- `base_resp` business-error layer; 401/403/429/402 HTTP semantics; 1004 cookie error on the legacy path.
- Token Plan key vs pay-as-you-go key are distinct credentials; `sk-api-` prefix routes to `/account/query_balance` in first-party tooling.

**Medium confidence**:
- `2062` = no active Token Plan: single source (hknet), but hknet built and ran it against real accounts; plausible given the code table.
- Epoch/`remains_time` unit heuristics (ms vs s) and the seconds-vs-ms disagreement for `remains_time` between the mm fixture and the CN community doc; hknet's fixed thresholds are cruder than OpenTokenUsage's alignment inference.
- `weekly_boost_permille` and its 150%/200% display semantics (first-party code only, no docs).
- Global = prompt counts vs CN = model-call counts (÷15) (community only).

**Open questions**:
1. Does `www.minimax.io`/`www.minimax.cn` vs `api.minimax.io`/`api.minimaxi.com` vs `api.minimax.cn` matter for reachability from a given network (Cloudflare on www.minimax.com was reported)? All four hosts appear in working code; the doc examples use `www.`, the API tooling uses `api.`.
2. Definitive current semantics of `current_interval_usage_count` (remaining vs used) — MiniMax itself acknowledges both eras; the only safe approach is percent-agreement disambiguation or percent-only display.
3. Does today's `token_plan/remains` response for a **Credits-only** subscription key return `2062`, an empty `model_remains`, a balance object, or an HTTP-level error? Only hknet's 2062 observation covers this; the CLI avoids the case via key-prefix routing.
4. Whether `points_balance`/`credits_balance` ever actually appear in a key-authenticated `token_plan/remains` response (hknet defends many variants; no other source confirms them on this endpoint).
5. Whether the `services[]` shape hknet parses exists in any real deployment — uncorroborated.
6. Whether `remains_time` on the current endpoint is window-remaining (CLI fixture implies ms window countdown) or subscription-remaining (CN legacy doc: seconds) — or varies by endpoint generation; affects only the last-resort reset derivation.
7. CN quota host on `api.minimax.cn` (the mm CLI's current CN default) — cc-switch says the quota route is undocumented there; untested here by policy (no authenticated calls).
