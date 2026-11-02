---
title: DeepSeek balance provider
labels: [feature]
status: closed
---

## Problem

map.md listed DeepSeek (and Kimi, Moonshot, OpenRouter, …) as out of scope for
v1 ("后续版本再议"). The user asked for a DeepSeek source showing the account
balance. DeepSeek's first-party API has no subscription plans and no
usage/quota endpoint — only a documented balance endpoint
(`research/deepseek-usage-api.md`) — so the feature is exactly a balance
segment, reusing the relay-balance display vocabulary.

## Decisions

- New plan kind `deepseek` (official first-party plan, one slot per plan via
  `snapshotKey`), detection via builtin id `deepseek` + host
  `api.deepseek.com` (issue 008 rules unchanged: foreign host → relay probe).
- New `Balance.kind` value `"prepaid"` — reusing `"relay"` would lie in
  `/usage` details (`Balance: 110.00 (relay)`); `"prepaid"` reads true.
- `Balance.currency?: string` carries the API-reported ISO code; render maps
  CNY→`¥`, USD→`$`, else `config.currency`. Relay balances unaffected.
- First `balance_infos[]` entry, `total_balance` only; `is_available` ignored
  (sufficiency flag, not data — see research §2).
- Endpoint fixed first-party `https://api.deepseek.com/user/balance`,
  override `PI_DEEPSEEK_USAGE_ENDPOINT`; no CN twin.
- Settings: "Relay balance" renamed "Balances" (gates relay + DeepSeek).

## Resolution

Implemented 2026-02: `src/providers/deepseek.ts` adapter (parse-as-pure-
function, zai-style), facade/detect/config/render/commands wiring, fixture
tests, README tables updated.
