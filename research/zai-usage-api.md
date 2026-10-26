# ZAI Coding Plan usage API — data contract (global z.ai + China bigmodel.cn)

Research ticket for the pi-usage-bar footer extension. Scope: the server-side usage/quota
API behind ZAI (Zhipu) GLM Coding Plan subscriptions, for both the international platform
(`api.z.ai`) and the China platform (`open.bigmodel.cn`). No credentials were used and no
authenticated calls were made; everything below comes from source code and documentation.

## Sources

Primary sources, ranked:

| # | Source | Type | Location |
|---|--------|------|----------|
| S1 | `zai-org/zai-coding-plugins` — official Z.AI plugin `glm-plan-usage` | First-party client code | cloned to `/tmp/wayfinder-refs/zai-repos/zai-coding-plugins/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs` |
| S2 | `hknet/pi-usage-bars` `extensions/usage-bars/core.ts` (`fetchZaiUsage`, `extractZaiUsageFromPayload`) + tests | Working pi extension | `/tmp/wayfinder-refs/pi-usage-bars/extensions/usage-bars/core.ts`, `tests/usage-bars-core.test.ts` |
| S3 | `steipete/CodexBar` `docs/zai.md` + `Sources/CodexBarCore/Resources/Plugins/zai.js` | Working monitor app, heavily commented | cloned to `/tmp/wayfinder-refs/zai-repos/CodexBar/` |
| S4 | `PowerUserZ/OpenTokenUsage` `docs/providers/zai.md` | Documented client with response fixtures | cloned to `/tmp/wayfinder-refs/zai-repos/OpenTokenUsage/docs/providers/zai.md` |
| S5 | `farion1231/cc-switch` `src-tauri/src/services/coding_plan.rs` + issue #1588 | Working Rust client | cloned to `/tmp/wayfinder-refs/zai-repos/cc-switch/` |
| S6 | `vhxubo/glm-quota` (single-file dashboard) | Working web client | cloned to `/tmp/wayfinder-refs/zai-repos/glm-quota/` |
| S7 | `Feng-H/pi-zai-usage` `extensions/zai-usage.ts` | pi footer extension | cloned to `/tmp/wayfinder-refs/zai-repos/pi-zai-usage/` |
| S8 | Official docs: `docs.z.ai/devpack/*`, `docs.bigmodel.cn/cn/coding-plan/*`, `docs.z.ai/api-reference/*` | Official documentation | URLs cited inline |
| S9 | pi built-in provider definitions (`zai`, `zai-coding-cn`) | First-party pi source | `@earendil-works/pi-ai/dist/providers/zai.js`, `zai-coding-cn.js` (local install) |

Docs pages were read through search-provider caches; direct fetching was blocked by local
DNS (TUN fake-IP), which is why no page text is quoted beyond cached snippets.

## 1. Endpoint URLs

Confirmed by S1, S2, S3, S4, S5, S6, S7 — all agree:

| Variant | Quota endpoint |
|---|---|
| Global (z.ai) | `GET https://api.z.ai/api/monitor/usage/quota/limit` |
| China (bigmodel) | `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit` |

- Same path on both hosts; only the base differs (S1 derives the host from
  `ANTHROPIC_BASE_URL`; S3/S6/S7 hardcode the two bases).
- Host variants accepted by first-party/official code:
  - `dev.bigmodel.cn` — the official plugin (S1) treats it as equivalent to
    `open.bigmodel.cn` for platform detection.
  - `bigmodel.cn` (bare) — third-party docs (lzw.me opencode-mystatus appendix) show the
    same path on `https://bigmodel.cn/api/monitor/usage/quota/limit`; the canonical API
    host remains `open.bigmodel.cn` (all six implementations use it).
- S2 exposes env overrides `PI_ZAI_USAGE_ENDPOINT` / `PI_ZAI_CODING_CN_USAGE_ENDPOINT`
  (defaults exactly the two URLs above); CodexBar has `Z_AI_QUOTA_URL` /
  `Z_AI_API_HOST` (S3).
- Related endpoints in the same `/api/monitor` family (used by S1, S3, S6; not needed for
  footer bars but part of the contract):
  - `GET {base}/api/monitor/usage/model-usage?startTime=…&endTime=…` — per-model token
    usage. Timestamps formatted `yyyy-MM-dd HH:mm:ss` (local time, URL-encoded) (S1, S6).
  - `GET {base}/api/monitor/usage/tool-usage?startTime=…&endTime=…` — MCP tool totals
    (`totalUsage.totalNetworkSearchCount`, `totalWebReadMcpCount`, `totalZreadMcpCount`) (S6).
  - `GET {base}/api/monitor/credit-usage/usage-detail?usageType=MODEL&startTime=…&endTime=…`
    — per-model series with `data.x_time` axis (S6).
  - `GET https://api.z.ai/api/biz/subscription/list` — subscription metadata (plan name,
    `nextRenewTime` as `yyyy-MM-dd`) (S4, global only).

Not documented in either platform's public API reference (S4 states this explicitly);
the endpoint is the one the subscription web console and the official plugin call. See §7.

## 2. Auth

- Credential: the GLM Coding Plan **API key** (same key used for coding inference).
  - S4: `ZAI_API_KEY` (fallback `GLM_API_KEY`).
  - S9: pi's built-in providers use `ZAI_API_KEY` (global) and `ZAI_CODING_CN_API_KEY`
    (China) for coding inference; S2/S7 query the monitor endpoint with exactly that
    provider key.
  - S1 (official): reuses `ANTHROPIC_AUTH_TOKEN` — i.e. the same token Claude Code sends
    to the Anthropic-compatible coding endpoint.
- Header: `Authorization: Bearer <key>` — S2, S3, S4 all use Bearer on both platforms.
  - Raw form `Authorization: <key>` (no Bearer) also works on the CN platform (S5 comment:
    "智谱不加 Bearer 前缀"; S7: "国内站裸 key/Bearer 都接受；国际站用 Bearer").
  - S1 (official plugin) sends the raw token with no Bearer prefix for both platforms.
  - S6 tries Bearer first and retries with the raw key on 401.
  - Practical rule: send `Bearer` — accepted everywhere; treat raw-token acceptance as a
    CN bonus, not a contract.
- Additional headers seen (harmless, not required by any evidence of rejection):
  `Accept: application/json` (S3, S4, S6), `Content-Type: application/json` and
  `Accept-Language: en-US,en` (S1, S7). Method is GET with no body.
- Team scope (CN only, S3): append `?type=2` to the quota endpoint and send
  `Bigmodel-Organization: <org id>` + `Bigmodel-Project: <project id>` headers; missing
  selectors yield HTTP success with empty `data` (`data: {}`), not an error.
- Key separation notice (S8: `docs.z.ai/devpack/notice/api-key-management`): since
  2026-10-16, standard model-API keys and GLM Coding Plan keys are managed separately —
  a pay-as-you-go key is not a coding-plan key.

## 3. Response JSON structure

Envelope (identical on both platforms; S3 validates `success === true && code === 200`;
S4/S5 fixtures show both `msg` values `"success"` and `"操作成功"`):

```json
{
  "code": 200,
  "msg": "success",
  "success": true,
  "data": {
    "level": "pro",
    "limits": [ /* limit entries, see below */ ]
  }
}
```

Root-level fields:

| Field | Type | Meaning | Evidence |
|---|---|---|---|
| `code` | int | 200 on success; error code otherwise | S3, S4, S5 |
| `msg` | string | human message; used as error text on failure | S3, S5 |
| `success` | bool | `true` on success | S3, S4, S7 |
| `data` | object | payload | all |
| `data.level` | string | plan tier, e.g. `lite` / `pro` (积分制 plans) | S6, S7 |
| `data.planName` | string | plan display name (e.g. "GLM Coding Max"); S3 also probes `plan`, `plan_type`, `packageName` as alternates | S3, S4 (subscription list uses `productName`) |
| `data.limits` | array | quota windows | all |

Limit entry (array element of `data.limits`):

| Field | Type | Meaning | Evidence |
|---|---|---|---|
| `type` | string | `"TOKENS_LIMIT"` (token plans) \| `"CREDIT_LIMIT"` (credit/积分 plans) \| `"TIME_LIMIT"` (monthly MCP/tool calls) | S2, S3, S4, S5, S6 |
| `unit` | int | duration unit code; see window semantics below | all |
| `number` | int | duration count (`unit`×`number` = window length) | S3, S4, S5, S6 |
| `usage` | int | **the window LIMIT (denominator / total)** — naming gotcha, not "used" | S3, S4 (fixture: `usage: 800000000` with `percentage: 15`), S6 |
| `total` | int | same meaning as `usage`; S6 reads `total` first, falls back to `usage` — some responses carry `total` instead | S6 |
| `currentValue` | int | amount **used** in the window | S3, S4, S6 |
| `remaining` | int | amount remaining | S3, S4 |
| `percentage` | int | used percentage 0–100 (integer; S3 requires `Number.isInteger`) | all |
| `nextResetTime` | int | epoch **milliseconds** of next reset | S2, S3, S4, S5, S6 |
| `usageDetails` | array | only on `TIME_LIMIT`: `[{ "modelCode": "search-prime", "usage": 1433 }, …]` per-tool call counts (`search-prime`, `web-reader`, `zread`) | S3, S4, S6, S7 |

Consistency rule observed by S3: when `usage > 0` and `currentValue`/`remaining` are
present, compute percent from the counts (clamped 0–100) rather than trusting
`percentage`; S2/S7 just consume `percentage`.

### Window semantics (the two quota bars)

Both platforms' plans have exactly two quota windows — 5-hour and weekly — per official
docs (S8: `docs.z.ai/devpack/overview`; `docs.bigmodel.cn/cn/coding-plan/overview`: "套餐
同时设有每 5 小时和每周额度上限"). In `limits[]` they are distinguished by `type` + `unit`:

| Window | Entry | Notes | Evidence |
|---|---|---|---|
| Session (5h rolling) | `TOKENS_LIMIT` or `CREDIT_LIMIT`, `unit: 3`, `number: 5` | rolling window, "dynamically refreshed; resets 5 hours after consumption" (S8 devpack/overview) | S2, S4, S5, S6, S7 |
| Weekly (7-day) | `TOKENS_LIMIT` or `CREDIT_LIMIT`, `unit: 6`, `number: 1` **or** `number: 7` (both observed in the wild; anchor on `unit` only) | 7-day cycle anchored at subscription order time (S8 devpack/faq: "starts counting from the time you place your order… refreshed and reset on a 7-day cycle") | S2 (unit only), S4 (`number: 7`), S5 (both documented), S6 (`number: 1`) |
| Monthly MCP/tools | `TIME_LIMIT`, `unit: 5`, `number: 1` | search/web-reader/zread call quota; official plugin labels it "MCP usage(1 Month)" | S1, S3, S4, S6, S7 |

Generic unit map used by S3 for unknown combos: `1=day (1440min)`, `3=hour (60min)`,
`5=minute`, `6=week (10080min)` — with `(TIME_LIMIT, unit 5, number 1)` special-cased as
the monthly (30-day) MCP marker.

S2's parser (`extractZaiUsageFromPayload`) accepts `TOKENS_LIMIT` **and** `CREDIT_LIMIT`
as the two quota windows, picks `unit === 3` → session and `unit === 6` → weekly, reads
`percentage`, and derives countdowns from `nextResetTime`. That is the mapping
pi-usage-bar should replicate.

Note on plan generations: current plans are credit-based (`CREDIT_LIMIT`, 积分制,
introduced by the 2026-07-30 revision — S8 `docs.bigmodel.cn/cn/coding-plan/notice/usage-revision`,
S8 `docs.z.ai/devpack/notice/usage-revision` covers legacy V2 prompt-based plans);
older token plans report `TOKENS_LIMIT`. Same entry shape either way (S2 test fixtures).

### Models list

There is **no servicable-models field** in this API. The quota/limit response carries no
model catalog; per-model information only exists as usage data in
`/api/monitor/usage/model-usage` (S1, S6). Supported models are documented statically:
all plans support `GLM-5.3` and `GLM-5.3-Flash`; legacy names auto-route (S8
`docs.z.ai/devpack/overview`, `docs.bigmodel.cn/cn/coding-plan/overview`). The
"servicable models" concept the ticket mentions belongs to Anthropic's usage API, not
this one.

## 4. Reset-time fields and formats

- `nextResetTime`: epoch **milliseconds** (S2 computes `nextResetTime - Date.now()`;
  S4 fixture `1770648402389`; S3/S6 pass it to date constructors). S6 also defends
  against a `resetTime` variant in seconds (multiplies by 1000 when `< 1e12`) —
  provenance unclear, likely older responses.
- 5h window: rolling — resets 5 hours after consumption (S8 devpack/overview).
- Weekly window: fixed 7-day cycle from subscription start (S8 devpack/faq).
- `TIME_LIMIT` (monthly): typically **no** `nextResetTime` in the entry; S4 says it
  resets on the 1st of each month 00:00 UTC; S1 labels it "1 Month"; S3 renders a 30-day
  marker.
- Plausibility guard (S3): a 5h-window reset more than 5h+60s in the future is treated
  as bogus and dropped, not timezone-corrected.
- Do **not** rank windows by `nextResetTime` to tell session from weekly — near a
  period boundary the weekly window can reset sooner than the 5h window (S5 comment).

## 5. CN vs global differences

| Aspect | Global (`api.z.ai`) | China (`open.bigmodel.cn`) | Evidence |
|---|---|---|---|
| Path | identical `/api/monitor/usage/quota/limit` | identical | S1 |
| Auth | Bearer (raw also sent by official plugin) | Bearer and raw both accepted | S3, S5, S6, S7 |
| Envelope & limit fields | same | same (`msg` may be Chinese) | S3, S4, S5 |
| Quota windows | 5h + weekly (credits) | 5h + weekly (积分) — same semantics | S8 overviews |
| Team usage | not observed | `?type=2` + `Bigmodel-Organization`/`Bigmodel-Project` headers; empty `data:{}` if selectors missing/wrong | S3 |
| Extra hosts | — | `dev.bigmodel.cn` (S1), bare `bigmodel.cn` (third-party docs) | S1, S9 (lzw.me) |
| Subscription metadata | `/api/biz/subscription/list` (S4) | not verified (open question) | S4 |
| Coding inference base | `https://api.z.ai/api/coding/paas/v4` (S9) or `/api/anthropic` (S1) | `https://open.bigmodel.cn/api/coding/paas/v4` (S9) or `/api/anthropic` (S1) | S1, S9 |

S7's comment claims the weekly `unit:6` entry appears "部分套餐/国际站才有" (some plans /
international only), but both platforms' official docs say every plan has both windows —
treat "entry sometimes missing" as an API-side quirk, not a regional guarantee.

## 6. Error shapes

- Failure envelope: same JSON shell with `success: false` and error text in `msg`
  (S3 reads `root.msg` when `success !== true || code !== 200`).
- Platform error codes (S8 `docs.z.ai/api-reference/api-code`, documented for the model
  API gateway; monitor shares the envelope): `1000`→401 Authentication Failed; `1001`→401
  auth header missing; `1003`→401 token expired; `1005`→401 2FA required;
  `1113`→429 "Insufficient balance or no resource package"; `1210`→400 invalid
  parameter; `1200`→500 API call error.
- Invalid key on the monitor endpoint in practice: HTTP 401/403 (S4 maps both to
  "API key invalid"; S7 treats 401/403 as "no data" and falls back to local estimation).
- Team scope with missing org/project selectors (CN): HTTP 200 with `data: {}` —
  empty limits, not an error (S3 docs/zai.md).
- 429 on the monitor endpoint itself: no source documents rate-limiting behavior for
  `/api/monitor/...`; only S2's general `HTTP <status>` error string exists. Open
  question.
- Same key authenticates coding endpoints: yes — every client (S1 official plugin, S2,
  S4, S7) queries the monitor endpoint with the coding-plan key; S9 confirms pi's
  `zai`/`zai-coding-cn` providers use that key against the coding inference bases. Keys
  are scoped to the coding plan and separate from standard API keys since 2026-10-16
  (S8 api-key-management).

## 7. Official documentation vs reverse-engineering

Officially documented (S8):

- Plan semantics: 5h + weekly credits, reset rules, credit tables (Lite 2,000/10,000;
  Pro 12,000/60,000; Max 28,000/140,000), peak/off-peak charging, supported models —
  `docs.z.ai/devpack/overview`, `docs.z.ai/devpack/faq`, and CN mirrors
  `docs.bigmodel.cn/cn/coding-plan/overview`, `/faq`, `/team`, `/usage-notes`.
- Existence of a first-party usage-query client: `docs.z.ai/devpack/extension/usage-query-plugin`
  and `docs.bigmodel.cn/cn/coding-plan/extension/usage-query-plugin` document the
  `glm-plan-usage` plugin (personal plans only), whose source (S1) calls the monitor
  endpoints. So the endpoints are first-party-backed via an official client, even though
  no public API reference page exists for them.
- Error-code table: `docs.z.ai/api-reference/api-code`.
- Coding-plan key management: `docs.z.ai/devpack/notice/api-key-management`.

Reverse-engineered / community-established (field-level contract): the `limits[]` schema,
`unit` semantics (3=5h, 6=weekly), `usage`-means-limit gotcha, `nextResetTime` epoch-ms,
team headers — from S2–S7. S4 states plainly that the endpoints "are not documented in
Z.ai's public API reference… used internally by the subscription management UI". The
zcode.z.ai usage-stats page (S8) independently describes the same quota trio
("5-hour prompt pool, weekly quota, and monthly MCP quota") for Z.ai/BigModel.

## 8. Minimal client sketch for pi-usage-bar

```
GET {https://api.z.ai|https://open.bigmodel.cn}/api/monitor/usage/quota/limit
Authorization: Bearer <coding-plan API key>
Accept: application/json
```

1. Require HTTP 200 + `success === true` + `data.limits` array.
2. `windows = limits.filter(type in {TOKENS_LIMIT, CREDIT_LIMIT})`.
3. session = entry with `unit === 3`; weekly = entry with `unit === 6`.
4. Percent = `percentage` (int 0–100); optionally recompute
   `currentValue / usage` when both present.
5. `nextResetTime` (epoch ms) → countdown; sanity-clamp the 5h reset to ≤ now+5h+60s.
6. `TIME_LIMIT` (unit 5) is the monthly MCP lane — ignore for coding bars.
7. Show both platforms through one parser; only base URL + env override differ.

## Confidence & open questions

Confidence:

- **High** (≥4 independent implementations + official plugin agree): endpoint URLs and
  path identity across platforms; Bearer auth with the coding-plan key; envelope
  (`code`/`msg`/`success`/`data`); `data.limits[]` entry fields; `unit 3` = 5h session
  and `unit 6` = weekly; `percentage` integer 0–100; `nextResetTime` epoch ms; both
  platforms have 5h+weekly windows; `TIME_LIMIT` = monthly tools lane; 401/403 on bad
  key.
- **Medium**: `CREDIT_LIMIT` exact field parity with `TOKENS_LIMIT` (S2 fixture + S3
  parser say yes; no raw credit-plan capture seen); `data.level` / `planName` presence
  across plan generations; `usage` vs `total` field-name variance (S6 defends both);
  raw-token `Authorization` acceptance on the global host (only the official plugin does
  it, possibly via a different gateway path).
- **Low/open**:
  1. Weekly `number` value is observed as both `1` and `7` (S4 vs S5/S6) — anchor on
     `unit` only; which value ships today per plan/region is unverified.
  2. 429 / rate-limit behavior of the monitor endpoints is undocumented; unknown retry
     budget. S2 polls with internal throttling, implying caution.
  3. Exact error JSON body for an invalid key against the monitor endpoint (envelope vs
     plain status) — no source captures a raw 401 body.
  4. Whether `/api/biz/subscription/list` works on the CN host (only S4, global).
  5. Whether some CN plan tiers omit the weekly `unit:6` entry (S7 comment vs official
     docs saying all plans have weekly quotas).
  6. glm-quota's `resetTime`-in-seconds fallback (S6) — which API version emitted it.
  7. `dev.bigmodel.cn` and bare `bigmodel.cn` hosts: accepted by official/third-party
     code, but canonical status unverified; `open.bigmodel.cn` is what every footer
     implementation uses.
