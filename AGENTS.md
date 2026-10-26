# pi-usage-bar

Subscription plan usage bars for the [Pi](https://github.com/earendil-works/pi) coding agent. Planned via a wayfinder map — `issues/map.md` is the canonical decision log, `research/` holds the API/style research documents both written before any code.

## Commands

```bash
npm install          # once
npx tsc --noEmit     # strict typecheck
npx vitest run       # all tests (or: npx vitest run tests/render.test.ts)
npx biome check .    # lint + format
npm run check        # all of the above
```

## Architecture — one deep module, three seams (issue 011)

The domain model `UsageSnapshot` (src/types.ts) flows through everything. Three consumers — footer status, `/usage` view, `--usage` JSON — all eat the same model.

1. **Data seam** `src/providers/` — one adapter per plan implementing `ProviderAdapter`. Each adapter separates fetch (IO) from parse (pure function over a payload). A failing provider damages only its own snapshot.
2. **Render seam** `src/render/` — pure functions, zero IO, zero pi imports. `renderStatus(snapshots, config, width, palette) → string[]` (ANSI, multi-line for wrapping).
3. **pi seam** `src/pi/` — the only code that imports pi packages. Footer/status, `/usage` view, commands, credential resolution, and `compat.ts` for undocumented pi surfaces.

`src/detect.ts` (provider id/host → plan, pure), `src/config.ts` (load/merge/validate), `src/index.ts` (thin pi entry: lifecycle, timers, wiring).

## Rules

- **Do not** add runtime dependencies (zero-dep is a locked decision). devDependencies only.
- **Do not** edit `package.json`, workflows, or files owned by another module without coordination.
- Code, identifiers, commit messages: English. Discussion with the user: Chinese.
- Tokens never appear in logs, snapshots, `/usage`, or `--usage` output.
- Windows labels come from real durations ("5h", "7d", "2h"), never invented.
- Tests: fixture-driven unit tests for parsers, golden ANSI snapshots for render (cs spec worked examples in `research/cs-style-spec.md` are the baseline).

## Specs by area

| Area                                | Spec source                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| Codex API                           | `research/codex-usage-api.md` — usage credential must resolve from pi's `openai-codex` provider (backend-api audience); the `openai` ChatGPT direct-use token gets 401 `no_matching_rule` (verified live) |
| Claude API                          | `research/claude-usage-api.md`                                                                  |
| ZAI API                             | `research/zai-usage-api.md`                                                                     |
| MiniMax API                         | `research/minimax-usage-api.md`                                                                 |
| pi extension API                    | `research/pi-extension-api.md`                                                                  |
| Style (looks, colors, formats)      | `research/cs-style-spec.md` + `issues/010-style-prototype.md`                                   |
| Detection & providerMap             | `issues/008-provider-detection-mapping-spec.md`                                                 |
| Config keys & commands              | `issues/009-config-schema-slash-commands.md`                                                    |
| Robustness (backoff/stale/fallback) | `issues/014-robustness-spec.md`                                                                 |
| Relay balance & resets              | `issues/012-official-resets-in-scope.md`, `issues/013-post-research-display-relay-decisions.md` |
| Release                             | `issues/015-release-process.md`                                                                 |
