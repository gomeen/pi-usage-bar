# pi-usage-bar

[English](README.md) · [简体中文](README.zh.md)

Subscription plan usage bars for the [Pi](https://github.com/earendil-works/pi) coding agent — quota windows, reset countdowns, relay balances, and official reset announcements, styled after [claude-code-usage-bar](https://github.com/leeguooooo/claude-code-usage-bar).

## What you get

- **Footer usage bars** for the plan of your active model — two quota windows (session + weekly) with per-cell gradient bars and `⏰` reset countdowns
- **Four looks**: aurora block (default), aurora thin, ring (`◔ 14% 5h · resets 1h07m`), and classic battery — all switchable live
- **Relay balances**: custom providers on one-api/new-api relays — or Sub2API-style sites exposing `/v1/usage` — automatically show their remaining balance (`$200.00`)
- **Next official reset** for Codex plans via [codex-resets.com](https://codex-resets.com) — shown only while a reset is announced ahead of time (`↻ Reset announced · in 1h10m`)
- **`/usage`** opens a single menu for provider details, **Appearance**, **Display**, and **Advanced**, with changes applied to the actual usage bar; **`--usage`** prints a one-line JSON smoke test

## Supported plans

| Plan | Pi provider ids | Auth |
|---|---|---|
| OpenAI Codex (ChatGPT) | `openai`, `openai-codex` | ChatGPT subscription OAuth — **usage queries require the `openai-codex` ("OpenAI Codex") login**: the `openai` provider's ChatGPT direct-use token cannot access the backend-api usage endpoint. Run `/login` → OpenAI Codex once and both providers share the subscription. |
| Anthropic Claude | `anthropic` | Claude Pro/Max OAuth |
| ZAI Coding Plan (Global/China) | `zai`, `zai-coding-cn` | API key |
| MiniMax Token Plan (Global/China) | `minimax`, `minimax-cn` | API key |
| Relays (one-api/new-api, Sub2API-style `/v1/usage`) | any custom provider id | API key |

Custom provider ids (proxies, cc-switch entries) are auto-probed for relay billing endpoints — the one-api/new-api dashboard family first, then a Sub2API-style `{site}/v1/usage` fallback; map them to a plan explicitly with `providerMap`.

## Install

```bash
pi install npm:@gomeen/pi-usage-bar
```

Restart Pi (or `/reload`). Authenticate your plans through Pi's `/login` — the extension resolves credentials through Pi's provider API and never reads `auth.json`.

## Configuration

Everything lives in `~/.pi/agent/usage-bar.json` (sparse — only non-default keys are written). Edit it directly or open `/usage`. Choose **Appearance**, **Display**, or **Advanced** to change values with Enter/Space; changes save immediately. Changes are visible directly in the actual usage bar; no duplicate preview panel is shown. **Appearance** → **Bar style** lets you switch between four styles with ↑↓; each move saves and applies immediately. **Display** controls visible plans, reset information, and balances. **Advanced** contains the refresh interval and **Provider mapping** instructions for editing `providerMap` in the JSON file. Esc returns one level at a time without reverting saved changes. Relay domain labels are shortened for display (`api.4sapi.com` → `4sapi`); provider IDs and request URLs stay unchanged.

| Key | Default | Meaning |
|---|---|---|
| `style` | `"aurora"` | `aurora` \| `ring` \| `classic` |
| `bar_glyph` | `"block"` | `block` \| `thin` (aurora) |
| `theme` | `"graphite"` | `graphite` \| `"pi"` (follow your pi theme) |
| `density` | `"regular"` | `compact` \| `regular` \| `cozy` |
| `bar_width` | `12` | bar cells |
| `color_ok` / `color_warn` / `color_hot` | `""` | `#rrggbb` overrides |
| `warning_threshold` / `critical_threshold` | `30` / `70` | percent |
| `display.mode` | `"all"` | `active` (current model's plan) \| `all` (every configured plan) |
| `display.providers` | `[]` | plan filter for `all` mode |
| `display.compact_others` | `true` | non-active plans collapse to one summary line |
| `providerMap` | `{}` | custom id → plan, e.g. `{"cc-switch-zhipu-glm": "zai-cn"}` or `{"my-relay": {"type": "relay"}}` |
| `refresh_minutes` | `2` | poll interval |
| `show_resets` | `true` | codex-resets.com announcements |
| `show_reset_countdown` | `false` | per-window `⏰` reset countdowns |
| `show_balance` | `true` | relay balance probe |
| `currency` | `"$"` | balance unit |

First-party monitoring endpoints can be overridden with `PI_ZAI_USAGE_ENDPOINT`, `PI_ZAI_CODING_CN_USAGE_ENDPOINT`, `PI_MINIMAX_USAGE_ENDPOINT`, `PI_MINIMAX_CN_USAGE_ENDPOINT` (plus legacy variants). **The provider token is sent as a bearer token to the configured endpoint — only override with endpoints you trust.**

## Security

- Tokens are only sent to first-party endpoints (or the relay's own host, with its own key)
- Tokens never appear in logs, `/usage`, or `--usage` output
- `auth.json` is never read or written; credentials resolve through Pi's `modelRegistry`

## Development

```bash
npm install
npm run check   # tsc --noEmit + biome + vitest
```

Architecture: one deep module (`UsageSnapshot` pipeline) behind three seams — data (`src/providers/`), render (`src/render/`, pure), and the pi adapter (`src/pi/`). See [AGENTS.md](AGENTS.md).

## Credits

This project is inspired by and borrows ideas (never code) from three MIT projects:

- [hknet/pi-usage-bars](https://github.com/hknet/pi-usage-bars) — provider usage API research reference
- [leeguooooo/claude-code-usage-bar](https://github.com/leeguooooo/claude-code-usage-bar) — the aurora look and config vocabulary
- [leeguooooo/codex-statebar](https://github.com/leeguooooo/codex-statebar) — the ring look and the official-reset line

## License

[MIT](LICENSE)
