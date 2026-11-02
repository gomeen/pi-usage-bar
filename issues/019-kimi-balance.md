---
title: Kimi (Moonshot) balance provider
labels: [feature]
status: closed
---

## Problem

The user asked for Kimi balance support. Their setup routes a custom pi
provider id `kimi` at `https://api.moonshot.cn/anthropic` with an Open
Platform API key — pure pay-as-you-go, exactly the DeepSeek shape (issue
018): no subscription, no usage endpoint, only a documented balance route
(`research/kimi-usage-api.md`). map.md listed Kimi/Moonshot as out of scope
for v1 ("后续版本再议").

## Decisions

- New plan kinds `kimi` (global station, api.moonshot.ai, USD) and `kimi-cn`
  (China station, api.moonshot.cn, CNY) — the zai/minimax twin convention.
  pi builtin ids map `moonshotai` → `kimi`, `moonshotai-cn` → `kimi-cn`.
- **Detection amendment to issue 008**: unknown custom ids whose baseUrl
  host is a known first-party Kimi host route to that plan (new
  `FIRST_PARTY_HOSTS` table, source "builtin") instead of the relay probe.
  Justification: the key IS a vendor station key, so the probe would only
  ever 404; manual providerMap still outranks it. Table is deliberately
  narrow — prepaid plans only (adapter authenticates with the provider's
  own API key). Codex/Claude stay excluded: their usage endpoints need the
  OAuth subscription token a custom id's API key cannot provide.
- `Balance.kind` stays `"prepaid"` (deepseek precedent). Currency is NOT in
  the payload — the adapter stamps the station-implied ISO code
  (`kimi` → USD, `kimi-cn` → CNY); render's CNY→¥/USD→$ mapping is unchanged.
- `data.available_balance` is the one number shown; envelope non-zero
  `code` fails the body; `voucher_balance`/`cash_balance` breakdowns stay
  out of the bar (issue 013 "remaining only").
- Endpoints fixed first-party
  `https://api.moonshot.{ai,cn}/v1/users/me/balance`, overrides
  `PI_KIMI_USAGE_ENDPOINT` / `PI_KIMI_CN_USAGE_ENDPOINT`.
- `kimi-coding` (Kimi For Coding subscription, api.kimi.com) stays out of
  scope: no documented balance/usage endpoint; would be a windows-shaped
  plan anyway.

## Resolution

Implemented 2026-02: `src/providers/kimi.ts` adapter (deepseek-style pure
parse), facade/detect/config/render/commands wiring, fixture tests +
detect/facade cases, `research/kimi-usage-api.md`, README tables. Live
verified against api.moonshot.cn with the user's own key (HTTP 200,
`available_balance 468.11215`).
