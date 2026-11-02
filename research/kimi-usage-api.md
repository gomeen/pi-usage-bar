# Kimi (Moonshot AI Open Platform) usage API

Researched 2026-02 for issue 019 (Kimi balance). Sources: the official
docs are served as llms-friendly pages from both stations —
`https://platform.kimi.com/docs/api/balance` (China) and
`https://platform.kimi.ai/docs/api/balance` (international), each with a
full OpenAPI block. Cross-checked against CodexBar's Moonshot provider
docs (github.com/steipete/CodexBar, `docs/moonshot.md`). The `api.moonshot.cn`
response shape was verified live with the user's own key (2026-02).

## 1. Stations and hosts

Kimi's Open Platform has two independent stations; keys are **station-bound**
and a key from one gets `401` on the other (both docs carry this warning):

| Station | Platform console | API host | Balance unit |
| --- | --- | --- | --- |
| China | platform.kimi.com | `api.moonshot.cn` | CNY (人民币元) |
| International | platform.kimi.ai | `api.moonshot.ai` | USD |

pi 1.4.0 builtin provider ids: `moonshotai` (default baseUrl
`https://api.moonshot.ai/v1`) and `moonshotai-cn` (`https://api.moonshot.cn/v1`),
both API-key auth via `MOONSHOT_API_KEY`. There is **no** builtin `kimi` id;
users on the Anthropic-compatible surface define custom ids, e.g. this
machine's `kimi` → `https://api.moonshot.cn/anthropic` (models.json, inline
apiKey). Custom ids on first-party Kimi hosts are routed to the plan by the
host table (issue 019 amendment to issue 008).

## 2. Balance endpoint (documented)

```
GET /v1/users/me/balance        # full: https://api.moonshot.cn/v1/users/me/balance
Authorization: Bearer <MOONSHOT_API_KEY>
Accept: application/json
```

Response (identical shape on both stations):

```json
{
    "code": 0,
    "data": {
        "available_balance": 49.58894,
        "voucher_balance": 46.58893,
        "cash_balance": 3.00001
    },
    "scode": "0x0",
    "status": true
}
```

Field semantics (both stations' docs agree):

- `code` — envelope code; `0` = success. Documented errors: `401` (bad/missing
  key), `500`. A non-zero `code` over HTTP 200 is possible (error envelope).
- `data.available_balance` — spendable balance = cash + voucher. **≤ 0 means
  the inference API refuses calls** (`exceeded_current_quota_error`).
- `data.voucher_balance` — voucher balance, cannot be negative (vouchers can
  expire; the docs warn to check validity when available hits 0).
- `data.cash_balance` — cash balance, **can be negative (deficit)**. When
  negative, `available_balance` equals `voucher_balance`.
- Currency is NOT a response field — the unit is the station's own currency
  (CN: CNY, global: USD). CodexBar treats it the same way.

Live check (user's key, api.moonshot.cn, 2026-02): HTTP 200 with
`available_balance 468.11215, voucher 0, cash 468.11215`.

## 3. Quota windows

None. The Open Platform is pure pay-as-you-go; no session/weekly windows, no
reset timestamps, no usage endpoint (per-token spend lives only in the
console's billing detail pages). The snapshot is therefore a `prepaid`
balance with zero windows — the DeepSeek shape (issue 018).

## 4. `kimi-coding` (Kimi For Coding) — out of scope

pi's third Kimi-adjacent builtin id, `kimi-coding` (`https://api.kimi.com/coding/v1`),
is the Kimi **Code subscription** (OAuth + `KIMI_API_KEY`). Its docs
(kimi.com/code/docs) describe plan/membership management in the console only;
no documented balance or usage endpoint exists for the subscription. If one
appears, it is a windows-shaped plan, not a balance — separate issue.

## 5. Parsing rules adopted (issue 019)

- Envelope: reject when a `code` field is present and non-zero; accept a
  missing `code` if `data.available_balance` parses (shape-drift defense).
- Amount: number or numeric string, must be finite and `>= 0` (a negative
  `available_balance` is not a documented state).
- Currency: region-implied ISO code stamped by the adapter (`kimi` → USD,
  `kimi-cn` → CNY); render's CNY→¥ / USD→$ mapping does the rest.
- `voucher_balance` / `cash_balance` breakdowns are not displayed
  (issue 013 "balance shows remaining amount only").
