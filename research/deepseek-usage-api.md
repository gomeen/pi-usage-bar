# DeepSeek balance API data contract

Spec source for the `deepseek` plan (issue 018). Verified against the official
API docs at <https://api-docs.deepseek.com/api/get-user-balance> (2026-02).
DeepSeek has no subscription plans and **no usage/quota endpoint** — the
balance endpoint is the only account data the first-party API exposes, so the
plan renders a balance segment and never quota windows.

## 1. Endpoint

- `GET https://api.deepseek.com/user/balance` (international docs; same
  platform for CNY and USD accounts — there is no CN twin host).
- Auth: `Authorization: Bearer <DEEPSEEK_API_KEY>`, `Accept: application/json`.
- The pi builtin `deepseek` provider's baseUrl is `https://api.deepseek.com`
  (verified in the pi 1.4.0 bundle), which is the documented API root.
- Overridable via `PI_DEEPSEEK_USAGE_ENDPOINT` (key `deepseek`), consistent
  with the other plans.

## 2. Success (200)

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "110.00",
      "granted_balance": "10.00",
      "topped_up_balance": "100.00"
    }
  ]
}
```

- `is_available` (boolean): "Whether the user's balance is sufficient for API
  calls" — a sufficiency flag, not data. **Display decision (issue 018):**
  ignored; the balance amount is what the user needs, and `false` with a
  nonzero balance is still worth seeing.
- `balance_infos[]`: one entry per currency the account holds
  (`currency` ∈ `CNY` | `USD`; all amount fields are **strings**).
  **Display decision (issue 018):** the **first entry** is displayed
  (`total_balance` only — issue 013's "bal shows remaining amount only"
  applies to `granted_balance`/`topped_up_balance` too). Accounts holding two
  currencies show the first; the API does not document its ordering.
- The ISO `currency` is stamped on `Balance.currency` (new optional field);
  render maps `CNY`→`¥`, `USD`→`$`, and falls back to `config.currency` for
  anything else. Relay balances carry no `currency` and keep using
  `config.currency` unchanged.

## 3. Failures

- 401 (bad key): JSON error envelope (`error.type: "authentication_error"`) —
  surfaced as `unavailable (401)` like every other plan; body never parsed for
  detail text (robustness rule: no upstream text into the bar).
- 429: `unavailable (429)` — the facade's generic 1→5→15 min backoff applies.
- No caching layer of its own: unlike the relay probe (issue 013), the balance
  rides the normal refresh cadence (`refresh_minutes`, default 2 min) and the
  facade's last-good slot. DeepSeek's billing docs impose no per-key read
  limit at this cadence.
