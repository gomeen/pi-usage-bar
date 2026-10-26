# Codex (ChatGPT-plan) usage data contract

Research ticket: complete data contract for showing official ChatGPT/Codex subscription usage bars in pi's footer. All claims cite primary sources. No authenticated calls were made; everything below comes from source code of three independent implementations plus official help-center articles.

**Sources (trust order):**

1. **openai/codex CLI (official, Rust)** — cloned to `/tmp/wayfinder-refs/codex` (branch `main`, shallow clone). Paths below are relative to `codex-rs/`.
2. **hknet/pi-usage-bars (community, working pi extension)** — `/tmp/wayfinder-refs/pi-usage-bars/extensions/usage-bars/core.ts` (referenced as `pi-usage-bars core.ts`).
3. **steipete/CodexBar (community, Swift menubar app)** — cloned to `/tmp/wayfinder-refs/CodexBar`.
4. **OpenAI Help Center articles** (titles + snippets verified via search; full pages blocked by bot challenge from this environment).

The three implementations agree on every field they share. The official CLI's generated OpenAPI models (`codex-backend-openapi-models`) are the strongest evidence for the wire format.

---

## 1. Endpoint and auth

### 1.1 Usage endpoint

```
GET https://chatgpt.com/backend-api/wham/usage
```

- pi-usage-bars: `fetchCodexUsage` calls exactly this URL ([pi-usage-bars core.ts:605-613]).
- CodexBar: `defaultChatGPTBaseURL = "https://chatgpt.com/backend-api/"` + `chatGPTUsagePath = "/wham/usage"` (`Sources/CodexBarCore/Providers/Codex/CodexOAuth/CodexOAuthUsageFetcher.swift:381-383,403`); test asserts `https://chatgpt.com/backend-api/wham/usage` (`Tests/CodexBarTests/OpenAIDashboardFetcherCreditsWaitTests.swift:291`).
- Official CLI: `rate_limit_status_url()` returns `{base}/wham/usage` for `PathStyle::ChatGptApi`, or `{base}/api/codex/usage` for `PathStyle::CodexApi` (`codex-rs/backend-client/src/client/rate_limit_resets.rs:105-110`). `PathStyle` is chosen by whether the base URL contains `/backend-api` (`codex-rs/backend-client/src/client.rs:150-155`), and `chatgpt.com` / `chat.openai.com` bases are normalized to append `/backend-api` (`client.rs:227-237`). So the same backend is reachable as `https://chatgpt.com/backend-api/wham/usage` or (on a non-backend-api host) `/api/codex/usage`.

Related endpoints discovered (not needed for a usage bar, listed for completeness):

| Endpoint                                                    | Purpose                                                   | Source                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET {base}/wham/rate-limit-reset-credits`                  | list purchasable/banked reset credits (`available_count`) | `rate_limit_resets.rs:71-79`; CodexBar `fetchRateLimitResetCredits` |
| `POST {base}/wham/rate-limit-reset-credits/consume`         | redeem a reset credit                                     | `rate_limit_resets.rs:82-104`                                       |
| `GET {base}/wham/accounts/check`                            | account/workspace bootstrap info                          | `client.rs:425-438`                                                 |
| `GET {base}/wham/profiles/me`                               | token usage profile                                       | `client.rs:440-453`                                                 |
| `GET {base}/wham/spend-controls/current-user/monthly-usage` | workspace monthly spend                                   | CodexBar `fetchSpendControlsMonthlyUsage`                           |
| `GET {base}/wham/accounts/{account_id}/remaining_balance`   | workspace credit balance                                  | CodexBar `fetchWorkspaceRemainingBalance`                           |

### 1.2 Authentication

The token is the **OAuth access token (a JWT) from the ChatGPT "Sign in with ChatGPT" flow**, not an API key. Sent as:

```
Authorization: Bearer <access_token>
```

- pi-usage-bars: `{ headers: { Authorization: `Bearer ${token}` } }` only — no other headers ([core.ts:606-609]). The token comes from Pi's provider registry: `ctx.modelRegistry.getProviderAuth("openai-codex")` → `resolved.auth.apiKey` (or a `Bearer …` Authorization header) ([pi-usage-bars extensions/usage-bars/index.ts:644-656,686]).
- CodexBar: `Authorization: Bearer <accessToken>` plus `User-Agent: CodexBar`, `Accept: application/json` (`CodexOAuthUsageFetcher.swift:409-418`).
- Official CLI: `self.auth_provider.add_auth_headers(&mut h)` adds the bearer header; plus `User-Agent: codex-cli` fallback (`codex-rs/backend-client/src/client.rs:293-312`).

**OAuth flow details (official CLI):** issuer `https://auth.openai.com`, token endpoint `{issuer}/oauth/token`, CLI client id `app_EMoamEEZ73f0CkXaXp7hrann` (`codex-rs/login/src/auth/manager.rs:1784`, `login/src/server.rs:77,708`). Credentials live in `~/.codex/auth.json` as `TokenData { id_token, access_token, refresh_token }` + `last_refresh` (`login/src/token_data.rs:10-22`, `login/src/auth/storage.rs:47-60`). The id_token's JWT claims (namespace `https://api.openai.com/auth`) carry `chatgpt_plan_type`, `chatgpt_user_id`, `chatgpt_account_id`, `chatgpt_account_is_fedramp` (`login/src/token_data.rs:46-64,88-96`).

**`ChatGPT-Account-Id` header:** the official CLI sends `ChatGPT-Account-Id: <account_id>` whenever the token/profile provides one (required routing for workspace accounts) and `X-OpenAI-Fedramp: true` for FedRAMP workspaces (`backend-client/src/client.rs:300-310`). CodexBar sets `ChatGPT-Account-Id` only when an account id exists (`CodexOAuthUsageFetcher.swift:415-417`). pi-usage-bars never sends it and works for personal-plan accounts. CodexBar's docs note its usage probes "accept OAuth tokens only, ignoring API-key entries" (`docs/codex.md:90`) — i.e. API-key bearer tokens are not expected to authorize `wham/usage` (community-implied, not verified against OpenAI docs).

Official docs confirm the two auth modes: "Codex supports two ways to sign in when using OpenAI models: Sign in with ChatGPT for subscription access; Sign in with an API key for usage-based access" (developers.openai.com/codex/auth, search-snippet verified).

---

## 2. Response JSON, field by field

Consensus wire shape of `GET /wham/usage` (from `codex-rs/codex-backend-openapi-models/src/models/rate_limit_status_payload.rs`, `rate_limit_status_details.rs`, `rate_limit_window_snapshot.rs`, `credit_status_details.rs`, `spend_control_status_details.rs`, `spend_control_limit_details.rs`, `additional_rate_limit_details.rs`; cross-checked with CodexBar's `CodexUsageResponse` decoder and pi-usage-bars' `parseCodexRateLimit` [core.ts:570-603]):

```jsonc
{
	"plan_type": "plus", // enum, see §3
	"rate_limit": {
		// nullable (whole object)
		"allowed": true, // bool
		"limit_reached": false, // bool
		"primary_window": {
			// nullable; a window object, see below
			"used_percent": 42, // int, 0-100
			"limit_window_seconds": 18000, // int, window length (18000 = 5h, 604800 = 7d)
			"reset_after_seconds": 9123, // int, seconds until this window resets
			"reset_at": 1750000000 // int, Unix epoch SECONDS of reset
		},
		"secondary_window": {
			/* same shape */
		}
	},
	"credits": {
		// nullable
		"has_credits": false, // bool
		"unlimited": false, // bool
		"balance": "12.50", // string OR number (CodexBar decodes both), nullable
		"approx_local_messages": null, // opaque arrays, ignored by all three consumers
		"approx_cloud_messages": null
	},
	"spend_control": {
		// nullable; workspace/individual spend caps
		"reached": false, // bool
		"individual_limit": {
			// nullable
			"limit": 100.0, // number
			"used": 37.2, // number
			"remaining_percent": 62.8, // number
			"resets_at": 1750100000 // int, epoch seconds
		}
	},
	"additional_rate_limits": [
		// optional; model-specific quotas
		{
			"limit_name": "GPT-5.3-Codex-Spark", // display name
			"metered_feature": "codex_spark", // stable id; CLI uses it as limit_id
			"rate_limit": {
				/* same window shape */
			}
		}
	],
	"rate_limit_reached_type": {
		// nullable
		"type": "rate_limit_reached" // or workspace_owner_credits_depleted |
	}, // workspace_member_credits_depleted |
	// workspace_owner_usage_limit_reached |
	// workspace_member_usage_limit_reached
	// Fields the official CLI also reads on this endpoint (types.rs:56-70),
	// present in responses but not in the generated OpenAPI export:
	"account_id": "...",
	"user_id": "...",
	"rate_limit_reset_credits": { "available_count": 0 },
	"rate_limit_upsell": {
		/* opaque, both impls keep it as raw JSON */
	}
}
```

Notes, field by field:

- **`plan_type`** — enum string. Official CLI model values: `guest, free, go, plus, pro, prolite, promax, free_workspace, team, self_serve_business_prolite, self_serve_business_usage_based, business, ent26, enterprise_cbp_automation, enterprise_cbp_usage_based, education, quorum, k12, enterprise, edu, edu_plus, edu_pro, sci, sci_plus, unknown` (`plan_type.rs`). CodexBar decodes the common subset (`guest, free, go, plus, pro, free_workspace, team, business, education, quorum, k12, enterprise, edu`) with an `unknown(String)` fallback (`CodexOAuthUsageFetcher.swift:139-165`). Plan buckets exist: the id_token carries the plan too, and `is_workspace_account()` distinguishes workspace plans (`login/src/token_data.rs:75-84`).
- **`rate_limit.primary_window` / `secondary_window`** — each independently nullable (double-option in the OpenAPI model). `used_percent` is `i32` in the official model (0-100, integer); pi-usage-bars tolerates 0-1 floats as a defensive fallback (`readPercentCandidate`, core.ts:411-416).
- **`reset_after_seconds` vs `reset_at`** — both exist in the official model (`rate_limit_window_snapshot.rs:10-21`). pi-usage-bars uses only `reset_after_seconds` (core.ts:596-598); CodexBar decodes only `reset_at` (`WindowSnapshot`, CodexOAuthUsageFetcher.swift:224-236). Either suffices.
- **`individual_limit` placement varies**: CodexBar accepts it at the response root, inside `rate_limit`, or inside `spend_control` (`resolvedIndividualLimit` precedence root → rate_limit → spend_control, CodexOAuthUsageFetcher.swift:71-73). Official model only declares `spend_control.individual_limit`; CodexBar's defensive decoding documents real-world variance. Its `SpendControlLimitSnapshot` also accepts `remaining_percent`/`remainingPercent` and `resets_at`/`reset_at` spellings (CodexOAuthUsageFetcher.swift:280-305).
- **`credits.balance`** — string or number (CodexBar decodes `Double` then falls back to parsing a trimmed `String`, CodexOAuthUsageFetcher.swift:258-268). Official model types it as an optional string.
- **camelCase tolerance** — CodexBar accepts `accountId`/`account_id`, `individualLimit`/`individual_limit` etc., evidence that some responses have appeared in camelCase (CodexOAuthUsageFetcher.swift CodingKeys).

---

## 3. Quota window semantics

- **Two windows per quota:** a short "session" window and a long "weekly" window. Official help center: "Codex can have both a 5-hour usage limit and a weekly limit. On plans with both, the same usage counts toward each, but the windows reset independently" (help.openai.com/en/articles/20001498-how-resets-work-in-codex, snippet).
- **Durations seen in code:** 5h session = `limit_window_seconds` 18000 (300 minutes); weekly = 604800 s (10080 minutes). CodexBar classifies by minutes: `300 → session`, `10080 → weekly`, anything else `unknown` (`CodexRateWindowNormalizer.swift:40-55`). The official TUI labels 5h/daily/weekly/monthly/annual with ±5% tolerance (`codex-rs/tui/src/chatwidget/rate_limits.rs:89-112`), so other window lengths exist in the wild.
- **Position is not identity.** pi-usage-bars explicitly warns: "Some Codex accounts return their seven-day quota as primary_window and omit secondary_window, so position alone does not identify it" and classifies by `limit_window_seconds >= 2*24*3600` (core.ts:577-586). CodexBar swaps windows when the weekly lands in the primary slot (`CodexRateWindowNormalizer.swift:16-25`). **A consumer must classify by duration, not position.**
- **Absent windows are common.** Accounts on some plans (notably Pro, per community lore) expose only the weekly window. Both `primary_window` and `secondary_window` may be `null`; pi-usage-bars reacts by hiding that bar (`sessionHidden`/`weeklyHidden`, core.ts:590-592) rather than showing 0%.
- **Plan differences:**
  - Official help: "Codex is included in your ChatGPT Plus, Pro, Business, Edu, or Enterprise plan. For a limited time, try Codex for free in ChatGPT Free and Go…" (developers.openai.com/codex/pricing + help article 11369540, snippets).
  - The official CLI's `warning_threshold` special-cases only Plus/Team on the 5h window (warn at 50% instead of 75%) (`tui/src/chatwidget/usage_notice.rs:154-164`) — evidence that Plus/Team have meaningful 5h windows.
  - Workspace plans (Business/Enterprise/Team) additionally use `credits`, `spend_control`, and the `workspace_*_credits_depleted` / `workspace_*_usage_limit_reached` reached-types (`rate_limit_status_payload.rs RateLimitReachedKind`).
  - No official per-plan table of window counts/limits was verifiable from this environment (see open questions).
- **Paid/banked resets:** official help describes purchasable rate-limit resets for eligible Plus/Pro accounts that "restore both limits immediately", and banked resets (help article 20001498, snippet; also 20001507 "Paid weekly Work and Codex rate limit resets"). The backing API is `/wham/rate-limit-reset-credits[.../consume]` above.

## 4. Reset-time formats

- **`reset_at`: Unix epoch seconds** (integer, `i32` on the wire). The official protocol type documents it as "Unix timestamp (seconds since epoch) when the window resets" (`codex-rs/protocol/src/protocol.rs:2541-2549`), and the CLI maps it straight into a chrono `DateTime<Utc>` when rendering (`codex-rs/codex-api/src/api_bridge.rs:207-211`). **Not ISO 8601.**
- **`reset_after_seconds`: relative seconds until reset** (integer). Format a countdown from it (pi-usage-bars `formatDuration`, core.ts:596-598).
- The 429 error body's `resets_at` is likewise epoch seconds (parsed with `DateTime::<Utc>::from_timestamp(seconds, 0)`, `api_bridge.rs:207-211`).
- The header form (`x-codex-*-reset-at`, §5) is also epoch seconds (`codex-api/src/rate_limits.rs:150-160`).

## 5. Error shapes

For the polling client (what pi-usage-bar will be):

- **401 Unauthorized** — expired/invalid access token. CodexBar maps this to "Codex OAuth token expired or invalid. Run `codex login` to re-authenticate" (`CodexOAuthFetchError.unauthorized`, CodexOAuthUsageFetcher.swift:348-352). Remedy: refresh via the refresh-token grant at `https://auth.openai.com/oauth/token` (official CLI `login/src/auth/manager.rs:1793-1799`) or re-login. pi-usage-bars surfaces the HTTP error string only.
- **429** on `/wham/usage` itself is not specifically handled by any of the three implementations (pi-usage-bars reports `error`; CodexBar buckets it under `serverError`). Its retry/backoff machinery exists only in pi-usage-bars' _Claude_ path, not the Codex path.

For the chat-completion stream (documented because it defines Codex rate-limit semantics), the official CLI shows two channels:

- **429 JSON body** (`codex-rs/codex-api/src/api_bridge.rs:174-226,344-357`):

```jsonc
{
	"error": {
		"type": "usage_limit_reached", // or "usage_not_included", "insufficient_quota"
		"code": "...", // alt discriminator: insufficient_quota |
		// credit_balance_exhausted |
		// organization_spend_limit_exceeded |
		// project_spend_limit_exceeded |
		// organization_usage_limit_exceeded
		"plan_type": "plus",
		"resets_at": 1750000000, // epoch seconds
		"limit_window_minutes": 300 // which window hit the cap
	}
}
```

- **Rate-limit response headers on every request** (parsed by `codex-api/src/rate_limits.rs:34-119,270-330`): `x-codex-primary-used-percent`, `x-codex-primary-window-minutes`, `x-codex-primary-reset-at`, `x-codex-secondary-used-percent`, `x-codex-secondary-window-minutes`, `x-codex-secondary-reset-at`, `x-codex-credits-has-credits`, `x-codex-credits-unlimited`, `x-codex-credits-balance`, `x-codex-active-limit`, `x-codex-limit-name`, `x-codex-promo-message`, `x-codex-rate-limit-reached-type`. Additional quota families reuse the pattern keyed by limit id (e.g. `x-codex-bengalfox-primary-used-percent`, `x-codex-secondary-primary-*`). Header values carry the same semantics as the JSON windows (percent 0-100, minutes, epoch reset).
- **WebSocket/agent-server event**: `{"type": "codex.rate_limits", plan_type, rate_limits: {primary, secondary}, credits, …}` with window fields `used_percent`, `window_minutes`, `reset_at` (`rate_limits.rs:122-175`).

## 6. Official documentation vs reverse engineering

- **The endpoint itself is undocumented.** No OpenAI page describes `chatgpt.com/backend-api/wham/usage`. It is an internal ChatGPT backend API. The contract above rests on (a) the **official open-source Codex CLI**, whose `backend-client` crate calls it and whose `codex-backend-openapi-models` crate contains a **generated OpenAPI client for it** — effectively first-party source, the strongest available evidence; and (b) two independent community implementations that agree.
- **Semantics are officially documented.** Help Center articles cover the 5h + weekly windows and independent resets (article 20001498), paid/banked resets (20001498, 20001507), and plan inclusion (11369540, "Using Codex with your ChatGPT plan: usage limits and troubleshooting"). developers.openai.com/codex/auth documents ChatGPT-sign-in vs API-key auth. Full page text was not retrievable from this environment (bot challenge); titles and quoted snippets are cited above.
- Community sources sometimes call the same surface "ChatGPT backend-api" usage; pi-usage-bars' README credits CodexBar and pins the endpoint to first-party services ("The Codex and Claude usage endpoints are fixed to their first-party services", README.md:137).

## Implementation guidance for pi-usage-bar (synthesis)

1. Poll `GET https://chatgpt.com/backend-api/wham/usage` with `Authorization: Bearer <pi openai-codex OAuth access token>` (+ `ChatGPT-Account-Id` if the provider context exposes an account id).
2. Read `rate_limit.primary_window` / `secondary_window`; classify each by `limit_window_seconds` (>= 2 days ⇒ weekly lane, else session lane); hide lanes whose window is `null` or when the whole `rate_limit` object is `null`.
3. Render `used_percent` (0-100). Countdown from `reset_after_seconds` (or `reset_at` epoch seconds minus now).
4. Treat 401 as "re-auth needed"; surface any other non-200 as an error string (match pi-usage-bars behavior).
5. Optional richness: `plan_type` label, `credits`/`spend_control` for workspace accounts, `additional_rate_limits` for model-specific quotas.

## Confidence & open questions

**High confidence (multi-source, includes official CLI source):** endpoint URL and path variants; bearer OAuth auth; `ChatGPT-Account-Id` header existence and conditional use; full window-object field set (`used_percent`, `limit_window_seconds`, `reset_after_seconds`, `reset_at`) and their types; epoch-seconds reset format; nullable windows; duration-based classification (not position); 429 body shape incl. `usage_limit_reached` and `resets_at`; response-header rate-limit family.

**Could not verify from primary sources / open questions:**

1. **Full text of the Help Center articles** (20001498, 20001507, 11369540) — pages are bot-gated from this environment; only search-provider snippets and titles were citable. Exact wording on when the 5h window starts (community lore says it starts at your first request in a session, not a fixed clock boundary) is unconfirmed.
2. **Per-plan window matrix** — no primary source states which plans expose which windows (e.g. "Pro = weekly only"). Inferred only from pi-usage-bars' comment about accounts omitting `secondary_window` and CodexBar's normalization logic.
3. **Whether API-key bearer tokens authorize `/wham/usage`** — CodexBar refuses them by policy; no official statement either way.
4. **Whether `ChatGPT-Account-Id` is strictly required for workspace (Business/Team) accounts** on this endpoint — the CLI always sends it when present; pi-usage-bars never sends it and reportedly works (personal plans). No workspace account was available to test (and none was used, per constraints).
5. **`rate_limit_upsell` payload shape** — both the CLI and CodexBar keep it as raw/untyped JSON.
6. **`credits.balance` currency/precision** — decoded as string-or-number by CodexBar; no live sample seen to confirm format or currency units.
7. **camelCase variant origin** — CodexBar tolerates camelCase keys (`accountId`, `individualLimit`), implying at least one backend/edge returns camelCase; which deployments do so is unknown.
8. **Polling rate limits on `/wham/usage` itself** — no documentation of a request budget; pi-usage-bars applies no backoff for Codex (unlike its Claude path). Choose a conservative poll interval (pi-usage-bars default appears to be its standard refresh cadence; exact interval not re-verified here).
