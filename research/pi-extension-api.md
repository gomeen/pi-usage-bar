# Pi extension API surface & packaging — research for pi-usage-bar

Investigated against pi **1.4.0** (`/Users/gomeen/.nvm/versions/node/v24.21.0/lib/node_modules/@earendil-works/pi-coding-agent`), its shipped docs, checked examples, `.d.ts` typings, the runtime bundle, and the real-world reference extension `@hk_net/pi-usage-bars` 0.7.1 (cloned to `/tmp/wayfinder-refs/pi-usage-bars`, built against pi 1.3.0). Sources cited per section as `[file]`.

---

## 1. Extension lifecycle: structure, loading, activate/deactivate, ExtensionContext, modes

**Structure & loading** — an extension is a TypeScript module with a default factory receiving `ExtensionAPI`. It can be:

- a single `.ts`/`.js` file (e.g. `~/.pi/agent/extensions/hello.ts`), or
- a directory containing `index.ts`/`index.js` as entry point. Multi-file extensions put npm dependencies in a nearby `package.json`. [docs/extensions.md §Add it to Pi]

Load locations: user `~/.pi/agent/extensions/` (or `<agent-dir>/extensions/`), project `.pi/extensions/` (after project trust), `--extension ./file.ts` / `-e <pkg>` for one-off, or via Pi packages. [docs/configuration.md, docs/packages.md]

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) { /* register capabilities */ }
```
[docs/extensions.md §Create and load an extension]

**TypeScript is loaded directly** — pi uses `jiti`, so "local TypeScript extensions do not need a separate compilation step". No bundling required. [docs/extensions.md]

**Factory rules** — sync or async; pi awaits async factories before startup continues. "Do not start processes, sockets, watchers, or timers in the factory because some invocations load extensions without starting a session." Start long-lived resources from `session_start` or from the command/tool that needs them. [docs/extensions.md §Understand the runtime lifecycle]

**There is no separate deactivate function.** Cleanup is event-driven:
- `pi.on("session_start", handler)` — initialize session-scoped resources, timers, first render.
- `pi.on("session_shutdown", handler)` — "Close session-scoped resources from an idempotent `session_shutdown` handler." Reload, `/new`, `/resume`, `/fork` all run `session_shutdown` then replace the runtime; the process exit path also goes through it. Keep cleanup idempotent. [docs/extensions.md lifecycle diagram + §Errors and cleanup]
- Reload invalidates the old runtime: "code after `await ctx.reload()` must not reuse state from the old runtime."
- `model_select` event fires when the user switches model (`pi.on("model_select", (event, ctx) => …)`) — needed for a usage bar that tracks the active provider. [dist/core/extensions/types.d.ts L1225; hknet index.ts uses it]

**ExtensionContext shape** (event handlers get `(event, ctx)`); command handlers get `ExtensionCommandContext extends ExtensionContext`:

```typescript
export type ExtensionMode = "tui" | "rpc" | "json" | "print";
export interface ExtensionContext {
    ui: ExtensionUIContext;                 // dialogs, notify, setStatus, custom, theme, ...
    mode: ExtensionMode;                    // guard with ctx.mode === "tui"
    hasUI: boolean;                         // true in TUI and RPC modes
    cwd: string;
    sessionManager: ReadonlySessionManager;
    modelRegistry: ModelRegistry;           // "Model registry for API key resolution"
    model: Model<any> | undefined;          // current model (may be undefined)
    scopedModels: readonly ScopedModel[];
    thinkingLevel?: ThinkingLevel;
    isIdle(): boolean;
    isProjectTrusted(): boolean;
    // + signal/abort/shutdown/compact/getContextUsage/getSystemPrompt actions
    //   (ExtensionContextActions, dist/core/extensions/types.d.ts L1661)
}
export interface ExtensionCommandContext extends ExtensionContext {
    getSystemPromptOptions(): BuildSystemPromptOptions;
    waitForIdle(): Promise<void>;
    newSession(opts?): Promise<{ cancelled: boolean }>;
    fork(entryId, opts?): Promise<{ cancelled: boolean }>;
    navigateTree(targetId, opts?): Promise<{ cancelled: boolean }>;
    switchSession(sessionPath, opts?): Promise<{ cancelled: boolean }>;
    reload(): Promise<void>;
}
```
[dist/core/extensions/types.d.ts L213–330, L1661–1707]

**Mode behavior**: interactive mode = full terminal UI; RPC mode can forward dialogs/notifications (not custom terminal components) via the RPC Extension-UI protocol; JSON and print modes have no UI. Guard with `ctx.mode === "tui"` and `ctx.hasUI`. [docs/extensions.md §UI and modes; docs/rpc-extension-ui.md]

**Handler signature**: `type ExtensionHandler<E, R = undefined> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void;` — `pi.on()` returns an unsubscribe function. Handlers run in extension load and registration order. [dist/core/extensions/types.d.ts L1182; docs/extensions.md §Events and concurrency]

---

## 2. Status bar: `ctx.ui.setStatus(key, text)`

Exact signature [dist/core/extensions/types.d.ts L84]:

```typescript
/** Set status text in the footer/status bar. Pass undefined to clear. */
setStatus(key: string, text: string | undefined): void;
```

Semantics, verified in the runtime bundle [dist/bundle/chunks/chunk-MM3LKT73.js, `FooterDataProvider`]:

- **Key uniqueness / map semantics**: statuses live in a `Map<string, string>`. `setExtensionStatus(key, text)`: `text === undefined ? this.extensionStatuses.delete(key) : this.extensionStatuses.set(key, text)`. Same key overwrites; `undefined` deletes the entry.
- **Ordering among extensions**: the footer renders `Array.from(extensionStatuses.entries()).sort(([a],[b]) => a.localeCompare(b))` — **statuses are sorted by key (localeCompare) and joined with a single space onto one line**, then truncated to width (`truncateToWidth`). So key choice controls display order across extensions; hknet uses `STATUS_KEY = "@hk_net/pi-usage-bars"` (its npm name) [hknet index.ts].
- **Live re-render**: every `setStatus` call also does `this.ui.requestRender()` — updates appear immediately (TUI coalesces render requests). [chunk-MM3LKT73.js `setExtensionStatus` caller]
- **`text` may contain ANSI** — extensions pass theme-styled strings (e.g. `theme.fg("dim", "…")` + block characters). hknet builds bars with `"█".repeat(filled)` + `"░"` spacers. The footer sanitizes via `sanitizeStatusText` then truncates by visible width. [chunk-MM3LKT73.js footer render; hknet index.ts `renderBar`]
- **Custom footers can read statuses**: `ctx.ui.setFooter(factory)` receives a `ReadonlyFooterDataProvider` exposing `getExtensionStatuses(): ReadonlyMap<string, string>` and git branch. [dist/core/extensions/types.d.ts L108–113; dist/core/footer-data-provider.d.ts]
- **Non-TUI modes**: RPC mode forwards `setStatus` as a fire-and-forget `extension_ui_request` (`{"method":"setStatus","statusKey":…,"statusText":…}`; `statusText: undefined` or omitted clears) — the client may display or ignore it. JSON/print modes have no UI. Safe pattern: hknet guards `if (!ctx || ctx.mode !== "tui") return;` before touching status. [docs/rpc-extension-ui.md §setStatus; hknet index.ts `updateStatus`]
- **Cleanup**: hknet clears its status on shutdown: `if (ctx.mode === "tui") ctx.ui.setStatus(STATUS_KEY, undefined);` inside `session_shutdown`. [hknet index.ts]

Related: `ctx.ui.setWidget(key, content, options)` places persistent content above/below the editor (alternative to footer status). [dist/core/extensions/types.d.ts L100–107; docs/tui.md]

---

## 3. Slash commands

Registration [dist/core/extensions/types.d.ts L1231, L1171]:

```typescript
pi.registerCommand(name: string, options: Omit<RegisteredCommand, "name" | "sourceInfo">): void;

export interface RegisteredCommand {
    name: string;
    sourceInfo: SourceInfo;
    description?: string;
    getArgumentCompletions?: (argumentPrefix: string) =>
        AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
    handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}
```

- **Argument handling**: the handler receives the raw argument string after the command name (`args: string`), not parsed argv. Parse yourself (`args.trim()`, split). Example `commands.ts` uses `args.trim()` as a filter value. [examples/extensions/commands.ts]
- **Autocomplete**: `getArgumentCompletions(prefix)` returns `{ value, label }` items shown while typing after the command. [examples/extensions/commands.ts]
- **cs-style `/usage-bar set …` mapping**: pi has no subcommand framework — a `set` subcommand is just string parsing in your handler. The idiomatic mapping is: parse the arg; if missing/ambiguous, open pi dialogs instead of a CLI-style flag parser — `await ctx.ui.select(title, options)`, `ctx.ui.confirm(title, message)`, `ctx.ui.input(title, placeholder?)`, `await ctx.ui.editor(title, prefill?)`, all returning the user's choice (or `undefined` on cancel). [dist/core/extensions/types.d.ts L72–77 `ExtensionUIContext`; examples/extensions/tools.ts, preset.ts]
- **Flags**: `pi.registerFlag(name, { description, type: "boolean"|"string", default })` + `pi.getFlag(name)` register CLI flags (hknet registers `--usage` for a one-shot print-and-exit mode). [dist/core/extensions/types.d.ts L1240–1252; hknet index.ts]
- Built-in command namespace: `/usage` was free for hknet to register; commands appear in the `/` menu with `description`. [docs/slash-commands.md §Commands added by resources]

---

## 4. Custom TUI components (the `/usage` detail view)

**Two tiers** [docs/tui.md]:

1. Prefer `ctx.ui` built-ins: `select()`, `confirm()`, `input()`, `editor()`, `notify()`, `setStatus()`, `setWidget()`.
2. `ctx.ui.custom<T>(factory, options?)` for a component that owns rendering + input:

```typescript
const result = await ctx.ui.custom<T>(
  (tui: TUI, theme: Theme, keybindings: KeybindingsManager, done: (result: T) => void) =>
    Component & { dispose?(): void },
  { overlay?: boolean; overlayOptions?: OverlayOptions | (() => OverlayOptions); onHandle?: (h: OverlayHandle) => void }
): Promise<T>;
```
[dist/core/extensions/types.d.ts L121–134]

**Component contract**: `render(width: number): string[]` (every line must fit width; use `visibleWidth()`, `truncateToWidth()`, `sliceByColumn()`, `wrapTextWithAnsi()` from `@earendil-works/pi-tui`), optional `handleInput(data: string)`, `invalidate()` to clear caches, optional `dispose()`. After state change: invalidate + `tui.requestRender()`. Complete worked example in docs/tui.md §Build a minimal custom screen and examples/extensions (pick-target example inline in tui.md). [docs/tui.md]

**Keyboard**: use `keybindings.matches(data, "tui.select.up" | "tui.select.down" | "tui.select.confirm" | "tui.select.cancel" | "tui.select.pageUp" | "tui.select.pageDown")`. [docs/tui.md; hknet index.ts `handleInput`]

**Component library** from `@earendil-works/pi-tui` (exports verified in node_modules/@earendil-works/pi-tui/dist/index.d.ts): `Text`, `Markdown`, `Image`, `TruncatedText`, `Container`, `VStack`, `HStack`, `Box`, `Spacer`, `Input`, `Editor`, `SelectList`, `SettingsList`, `ScrollView`, `Loader`, `CancellableLoader`, `MouseRegion`; colors: `mixColors`, `parseColor`, `rgbColor`, `okhslColor`, `indexedColor`, `foregroundAnsi`, `styleText`; utils `visibleWidth`, `truncateToWidth`, `sliceByColumn`, `wrapTextWithAnsi`, `stripTerminalSequences`. From `@earendil-works/pi-coding-agent` additionally: `DynamicBorder`, `CustomEditor`, `getSelectListTheme`, `getSettingsListTheme`, `getMarkdownTheme`, `initTheme`, concrete components (`SessionSelectorComponent`, `ModelSelectorComponent`, …). [pi-tui dist/index.d.ts; pi-coding-agent dist/index.d.ts L37–38]

**Focus & returning focus**: `ctx.ui.custom()` "temporarily gives one component control of the interactive area and resolves when that component calls the supplied completion callback" — calling `done(value)` resolves the promise, disposes the component, and returns focus to the editor automatically. A component with a text cursor must implement `Focusable` (`get/set focused`) and propagate `focused` to child `Input`/`Editor` (IME positioning). One instance per interaction. Overlays: pass `overlay: true`; overlay handles control focus/visibility; do NOT call `OverlayHandle.hide()` on a `ctx.ui.custom()` overlay. [docs/tui.md §Use custom screens and overlays]

**Reference implementation**: hknet's `/usage` view is `class UsageSelectorComponent extends Container implements Focusable` — search `Input`, filterable provider list, expanded detail rows under the selected item, manual viewport (`viewportSize()` from `tui.terminal.rows - 14`, `ensureSelectedVisible()`), `DynamicBorder` frame, per-item expansion rendered only for `selected` — a list-with-expand built from `Container`/`Text`/`Spacer`. Cancellation via AbortController aborted in `dispose()`. [hknet extensions/usage-bars/index.ts `UsageSelectorComponent`]

**Guard**: `if (ctx.mode !== "tui") { ctx.ui.notify(...) / return; }` before `ctx.ui.custom()`. [docs/tui.md example; hknet `/usage` handler]

---

## 5. Configuration: where an extension keeps its own config

- **Pi's own settings**: `~/.pi/agent/settings.json` (user) and `.pi/settings.json` (project, after trust); project overrides agent settings. `$schema: https://pi.dev/schemas/settings.schema.json`. `/settings` command edits common preferences; `/reload` after manual edits. Extensions can **read** merged settings via `pi.getSettings(): Settings`. There is **no documented extension-settings write API** — pi's settings.json schema is a fixed reference (model, interaction, tools, terminal, network, resources…); unknown keys aren't part of the documented contract. [docs/configuration.md; docs/settings.md; dist/core/extensions/types.d.ts `getSettings`]
- **Extension-own config convention** (what examples do): the `preset.ts` example reads its own JSON from two conventional locations — `~/.pi/agent/presets.json` (global) and `<cwd>/.pi/presets.json` (project) — using `getAgentDir()` (exported from `@earendil-works/pi-coding-agent`: `CONFIG_DIR_NAME`, `getAgentDir`, `getPackageDir`, `VERSION`) plus `node:fs` reads. No XDG base-dir convention is documented; pi's own convention is `~/.pi/agent` (relocatable via `PI_CODING_AGENT_DIR` env or SDK `agentDir`). [examples/extensions/preset.ts L9–90; dist/index.d.ts L2; docs/configuration.md §Agent directory]
- **State that participates in sessions**: `pi.appendEntry(customType, data)` for durable non-context data; tool-result `details` for branch-following tool state; `pi.sendMessage` for model-visible custom messages. [docs/extensions.md §State]
- **What hknet does**: no config file at all — runtime options come from environment variables (`PI_ZAI_USAGE_ENDPOINT`, `PI_MINIMAX_USAGE_ENDPOINT`, etc., each with a default), and a cross-process fetch cache at `os.tmpdir()/pi/usage-bars-cache.json` (version-tagged `{ version: 1, claude?: … }`). Registered MCP-server-style config would need re-registration per load ("Registrations are not saved: register again on every load, for example based on the extension's own settings"). [hknet core.ts `resolveUsageEndpoints`, `DEFAULT_USAGE_CACHE_FILE`; docs/extensions.md §MCP servers]
- Practical recommendation consistent with both: `getAgentDir() + "/<extension-name>.json"` for user config, `<cwd>/.pi/<extension-name>.json` for project overrides, env vars for endpoints/secrets.

---

## 6. Provider credentials WITHOUT reading `~/.pi/agent/auth.json`

The sanctioned path is `ctx.modelRegistry` (the `ModelRegistry` facade "exposed to extensions"; ExtensionContext doc: "Model registry for API key resolution"). [dist/core/model-registry.d.ts; dist/core/extensions/types.d.ts L225]

### (a) Current model's provider and baseUrl

`ctx.model` is `Model<any> | undefined`, and every model carries both fields on `BaseModel`:

```typescript
export interface BaseModel<TApi extends string> {
    id: string;
    name: string;
    api: TApi;
    provider: ProviderId;   // e.g. "anthropic", "openai-codex"
    baseUrl: string;        // e.g. "https://api.anthropic.com"
    input: ModelInputModality[];
    cost: ModelCost;
    headers?: Record<string, string>;
}
```
[node_modules/@earendil-works/pi-ai/dist/types.d.ts L628–640]

So `ctx.model.provider` + `ctx.model.baseUrl` directly answer (a). hknet additionally routes: it trusts the provider id only when the model's baseUrl host matches the official inference host (hardcoded `PROVIDER_HOSTS` map, e.g. `claude: ["api.anthropic.com"]`, `codex: ["chatgpt.com"]`, `zai: ["api.z.ai"]`, `minimax: ["api.minimax.io"]`, `"minimax-cn": ["api.minimaxi.com"]`); a model on an unknown host shows no bar, except gateway hosts (openrouter, vercel) where the *model's own* credential is used (`credential: "model"` vs `"provider"`). [hknet core.ts `PROVIDER_HOSTS`, `detectProviderRoute`, `isProviderRoute`]

### (b) Access token for a specific provider id

**Via `ModelRegistry`** [dist/core/model-registry.d.ts]:

```typescript
getProvider(provider: string): Provider | undefined;          // exists? (Provider has id, name, baseUrl?, headers?, auth, getModels(), stream…)
getProviderAuthStatus(provider: string): AuthStatus;           // { configured: boolean, … } — cheap check first
getProviderAuth(provider: string): Promise<AuthResult | undefined>;
getApiKeyForProvider(provider: string): Promise<string | undefined>;
getApiKeyAndHeaders(model: Model<Api>): Promise<ResolvedRequestAuth>;  // per-model (resolves overrides/models.json)
isUsingOAuth(model: Model<Api>): boolean;
```

`AuthResult` (from pi-ai) [node_modules/@earendil-works/pi-ai/dist/auth/types.d.ts L87–93]:

```typescript
export interface AuthResult {
    auth: ModelAuth;      // { apiKey?: string; headers?: ProviderHeaders; baseUrl?: string }
    env?: ProviderEnv;
    source?: string;      // human-readable label: "ANTHROPIC_API_KEY", "OAuth", "~/.aws/credentials"
}
```

**hknet's exact resolution flow** [hknet index.ts `resolveCredential` / `resolveModelCredential`]:

1. `ctx.modelRegistry.getProvider(providerId)` — skip if the provider id isn't registered.
2. `ctx.modelRegistry.getProviderAuthStatus(providerId)` — skip if `!status.configured`.
3. `const resolved = await ctx.modelRegistry.getProviderAuth(providerId)`:
   - token = `resolved?.auth.apiKey` if present;
   - else some OAuth flows expose the token only as a Bearer header: check `resolved?.auth.headers?.Authorization ?? .authorization`, strip `"Bearer "` prefix. (Kimi-coding OAuth works this way.)
4. For gateway-routed models, use the model's own credential: `await ctx.modelRegistry.getApiKeyAndHeaders(model)` → `ResolvedRequestAuth`:
   ```typescript
   export type ResolvedRequestAuth =
     | { ok: true; apiKey?: string; headers?: ProviderHeaders; baseUrl?: string; env?: Record<string,string> }
     | { ok: false; error: string };
   ```
   [dist/core/model-registry.d.ts L8–16]
5. Claude caveat: `AuthResult.source` is a human-readable label, not a type discriminator; hknet treats subscription (OAuth) only when `source === "OAuth"` and skips API-key Claude credentials, noting "Keep this source-label assumption in one place until ModelRegistry exposes the resolved credential type directly." `isUsingOAuth(model)` exists as a per-model alternative.

**Token refresh behavior**: OAuth refresh is owned by pi, not the extension. pi-ai's `CredentialStore.modify` doc: "`Models.getAuth()` runs OAuth refresh inside `modify` so concurrent requests cannot double-refresh a rotated token"; `getAuth` "Rejects with `ModelsError`: code 'oauth' when a token refresh fails (the stored credential is preserved for retry; re-login fixes it), code 'auth' when api-key resolution or the credential store fails." So each `getProviderAuth()` call returns a currently-valid access token (refreshing if the stored one is expired) and persists the rotated credential back to auth.json. Stored OAuth shape: `{ type: "oauth", refresh, access, expires }`. [pi-ai dist/auth/types.d.ts L24–68, L87; pi-ai dist/models.d.ts `getAuth`]

**Registering a provider purely to hold a credential** (for vendors whose usage API needs a different key than inference): hknet registers a model-less native provider so pi owns secret prompting/storage/resolution:

```typescript
pi.registerProvider(createProvider({
  id: "pi-usage-bars-xai-management",
  name: "xAI Management (pi-usage-bars)",
  auth: { apiKey: envApiKeyAuth("xAI read-only Management Key", ["XAI_MANAGEMENT_KEY"]) },
  models: [],
  api: { stream() { throw … }, streamSimple() { throw … } },
}));
```
with imports `import { createProvider, envApiKeyAuth } from "@earendil-works/pi-ai"`. Signatures: `createProvider<TApi>(input: CreateProviderOptions<TApi>): Provider<TApi>` and `envApiKeyAuth(name: string, envVars: readonly string[]): ApiKeyAuth` ("a stored credential key wins, otherwise the first set env var resolves. Includes a `login` that prompts for the key."). The provider then shows up in `/login` for its own credential, resolvable later via `getProviderAuth(id)`. [hknet index.ts; pi-ai dist/models.d.ts L256; pi-ai dist/auth/helpers.d.ts L8; docs/custom-provider.md §Provide authentication]

**Env fallback table** (first-set variable wins per provider, from docs/providers.md): `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ZAI_API_KEY`, `ZAI_CODING_CN_API_KEY`, `MINIMAX_API_KEY`, `MINIMAX_CN_API_KEY`, `KIMI_API_KEY`, … `auth.json` may also hold `!command` key resolvers and per-credential `env` objects. [docs/providers.md]

---

## 7. Theme access

`ctx.ui.theme: Theme` (also passed to custom/footer/widget factories). [dist/core/extensions/types.d.ts L178–179]

```typescript
export declare class Theme {
    get appearance(): ThemeAppearance;                       // "dark" | "light"
    get colors(): Readonly<Record<ThemeToken, Color>>;       // concrete colors for all tokens
    style(text: string, options: ThemeStyle): string;        // { fg?: ThemeColor | Color; bg?: ThemeBg | Color } extends TextAttributes (bold, …)
    fg(color: ThemeColor, text: string): string;
    bg(color: ThemeBg, text: string): string;
    bold(text: string): string;
}
export type ThemeAppearance = TerminalTheme;                 // "dark" | "light"
export interface ThemeStyle extends TextAttributes { fg?: ThemeColor | Color; bg?: ThemeBg | Color; }
```
[dist/modes/interactive/theme/theme.d.ts L36–72, L92]

- `theme.fg(token, text)` / `theme.bg(token, text)` apply one semantic token; foreground tokens are accepted as `fg`, background tokens as `bg`; to use a token's color in the other position pass its concrete color, e.g. `{ fg: theme.colors.userMessageBg }`. [docs/tui.md §Apply themes correctly]
- `theme.colors` gives concrete `Color` values for every token; tokens set to `""` (terminal default) report "the color the terminal announced for them, or a guess when it did not" — safe for math. [docs/tui.md; theme.d.ts L63–67]
- Token vocabulary (roles, from the theme schema groups): `accent`, `border*`, `text`, `muted`, `dim`, `success`, `error`, `warning`, `selectedBg`, `userMessage*`, `customMessage*`, `thinkingText`, `toolPendingBg`, `toolSuccessBg`, `toolErrorBg`, `toolTitle`, `toolOutput`, `md*`, `toolDiff*`, `syntax*`, … [docs/themes.md §Find the color to change]
- **Truecolor vs 256**: "Pi converts the result to truecolor or 256-color output based on terminal capabilities. Theme tokens are converted once per theme; compute concrete colors outside the render path when possible." Terminal override via `terminal.trueColor` setting. Raw escape building is available via `foregroundAnsi(color, mode)` / `backgroundAnsi(color, mode)` with `TerminalColorMode`. [docs/tui.md; docs/themes.md; pi-tui colors.d.ts L65–66]
- **`mixColors(first: Color, second: Color, amount: number, space?: ColorMixSpace): Color`** from `@earendil-works/pi-tui` for color math; sibling exports `colorToHex/Okhsl/Oklch/Rgb`, `parseColor`, `rgbColor`, `okhslColor`, `indexedColor`. [pi-tui dist/colors.d.ts L64; docs/tui.md]
- `theme.appearance` decides lighten-vs-darken choices; system theme rebuilds on terminal light/dark switch, and "A theme change clears render caches" — don't store ANSI-styled strings in long-lived state unless `invalidate()` rebuilds them. [docs/tui.md; docs/themes.md]
- Usage-bar color policy in hknet: `colorForPercent(percent)` returns a semantic token (`success`/`warning`/`error`) passed to `theme.fg`; percent bar uses `dim` for the empty part. [hknet index.ts/core.ts]

---

## 8. Timers / polling

- **Never in the factory** (some loads don't start a session). Start from `session_start` or lazily. [docs/extensions.md §Understand the runtime lifecycle]
- hknet's pattern: `POLL_INTERVAL_MS = 2*60*1000`; `session_start` clears any stale timer, runs one immediate poll, then `pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS)`. `session_shutdown` aborts in-flight fetch controllers, clears the interval, clears status. `model_select` re-polls. Every fetch takes an `AbortSignal` (`AbortSignal.any([sessionSignal, providerSignal])`) and checks `signal.aborted` after awaits. [hknet index.ts]
- Additional constraint from the poll loop design: re-entrancy guard (`pollInFlight`/`pollQueued`) so overlapping intervals don't duplicate requests; a provider switch aborts the previous provider's poll via a dedicated controller. [hknet index.ts `poll`/`runPoll`]
- Reload/session replacement converge on `session_shutdown` — cleanup must be idempotent (clearing an already-cleared interval is fine). [docs/extensions.md §Errors and cleanup]
- Commands and idle session events often have no operation signal (`ctx.signal` undefined) — use your own AbortControllers there. [docs/extensions.md §Events and concurrency]

---

## 9. Packaging & distribution

**Pi package model** [docs/packages.md]:

- A package = ordinary directory or npm package. Conventional resource dirs (`extensions/`, `skills/`, `prompts/`, `themes/`) are auto-discovered; or declare explicitly under `package.json` `"pi"`:
  ```json
  { "name": "…", "keywords": ["pi-package"],
    "pi": { "extensions": ["./extensions/usage-bars/index.ts"], "skills": […], "prompts": ["…*.md"], "themes": ["…*.json"] } }
  ```
  Paths relative to package root; arrays accept glob patterns and exclusions. `pi-package` keyword makes it discoverable in the pi.dev package gallery; optional `pi.image`/`pi.video` previews. (hknet also sets `pi.image`.)
- **Install forms**: `pi install npm:@example/pi-tools@1.0.0` (installed under pi's npm dir; **versioned npm specs are pinned**); `pi install git:github.com/example/pi-tools@v1` (cloned and reconciled to the ref; **git tags/commits pinned, `pi update` does not move a configured ref**); `pi install https://github.com/example/pi-tools` — "URL … treated as a git source"; `pi install ./local-package` (loaded from resolved path, not copied). [docs/packages.md §Install and manage packages, §Choose a source]
- **Where declarations go**: personal installs write to `~/.pi/agent/settings.json` under `packages`; `--local` writes `.pi/settings.json` (loads only after project trust). `pi list`, `pi remove <source>`, `pi update --extensions` reconcile. `-e <pkg>` tries one invocation without persisting. [docs/packages.md]
- **TypeScript loaded directly** — no build/bundle step needed (jiti). Ship `.ts` sources; list them under `pi.extensions`. [docs/extensions.md; docs/packages.md]
- **Dependencies**: runtime deps imported by extensions go in `dependencies`; pi installs package deps when installing an npm or git source. **Host-provided packages** — `@earendil-works/pi-ai`, `pi-agent-core`, `pi-coding-agent`, `pi-tui`, `typebox` — must be declared in `peerDependencies` with `"*"` and **must not** be bundled or listed in `dependencies` (a physical copy "can bypass Pi's extension module mapping … and create duplicate classes, registries"; pi warns on detecting it). hknet's package.json is the reference: peerDeps (optional meta) + pinned devDeps for typecheck. Installed packages get separate module roots — never rely on two packages sharing a dependency instance. [docs/packages.md §Declare dependencies; hknet package.json; examples/extensions/with-deps/package.json]
- **Local multi-file extension** (not a package): directory with `index.ts` + nearby `package.json` for deps. [docs/extensions.md §Add it to Pi]
- **Identity/dedupe**: npm by package name, git by repo URL sans ref, local by resolved absolute path; same package in personal + project scope — project entry replaces personal unless `autoload: false` (then it filters). [docs/packages.md §Understand scope and identity]

---

## 10. Built-in provider IDs (pi 1.4.0) for the four target vendors

Verified from the installed 1.4.0 model catalog bundle [dist/bundle/chunks/chunk-MM3LKT73.js provider definitions] and `pi --list-models` on this machine:

| Vendor | Provider ID | Display name | Default baseUrl | Auth |
|---|---|---|---|---|
| Anthropic | `anthropic` | "Anthropic" | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` api-key auth **and** OAuth "Anthropic (Claude Pro/Max)" subscription |
| OpenAI (chat) | `openai` | "OpenAI" | `https://api.openai.com/v1` | `OPENAI_API_KEY` + OAuth "OpenAI (ChatGPT subscription)" |
| OpenAI Codex | `openai-codex` | "OpenAI Codex (legacy)" in 1.4.0 | `https://chatgpt.com/backend-api` | OAuth "OpenAI (ChatGPT Plus/Pro)" only |
| ZAI global | `zai` | "Z.AI" | `https://api.z.ai/api/coding/paas/v4` | `ZAI_API_KEY` (docs: "ZAI Coding Plan (Global)") |
| ZAI China | `zai-coding-cn` | "Z.AI Coding CN" | `https://open.bigmodel.cn/api/coding/paas/v4` | `ZAI_CODING_CN_API_KEY` |
| MiniMax global | `minimax` | "MiniMax" | `https://api.minimax.io/anthropic` | `MINIMAX_API_KEY` |
| MiniMax China | `minimax-cn` | "MiniMax CN" | `https://api.minimaxi.com/anthropic` | `MINIMAX_CN_API_KEY` |

Notes:
- No other ids for these four vendors exist in the catalog (no `glm*`, no `zhipu` built-in; `cc-switch-zhipu-glm` on this machine is a user `models.json` custom provider). `pi --list-models` only lists providers with configured auth, so the bundle is the authoritative source for the full catalog.
- `openai-codex` is labeled "(legacy)" in 1.4.0 while `openai` gained a ChatGPT-subscription OAuth; hknet 0.7.1 (built for 1.3.0) still routes codex usage via `openai-codex` — verify which id actually carries the ChatGPT subscription credential on the pi version you target.
- Other ids referenced by the same family in docs: `kimi-coding` ("Kimi For Coding", `https://api.kimi.com/coding/v1`, `KIMI_API_KEY` + Kimi Code subscription OAuth), `moonshotai` / `moonshotai-cn`, `deepseek`, `openrouter`, `xai` (`https://api.x.ai/v1`). [docs/providers.md env table; bundle]
- `pi --version` = 1.4.0 on this machine; docs/providers.md labels rows "ZAI Coding Plan (Global)/(China)" and "MiniMax / MiniMax (China)" consistent with the above.

---

## Confidence & open questions

**High confidence** (documented + typings + runtime bundle + working extension all agree): lifecycle/factory rules, `session_start`/`session_shutdown` contract, `setStatus` map/sort-by-key/join-then-truncate semantics and RPC forwarding, command registration + raw-args string + `getArgumentCompletions`, `ctx.ui.custom()` contract and pi-tui component list, theme API (`fg`/`bg`/`style`/`colors`/`appearance`/`mixColors`), `ModelRegistry` credential methods and `AuthResult` shape, OAuth refresh-on-resolution behavior, packaging (`pi` manifest, peerDependencies rule, install sources, pinning), and the seven provider IDs above.

**Open questions the docs don't fully cover:**

1. **`AuthResult.source` string stability** — `"OAuth"` label matching (hknet's Claude-subscription heuristic) is not a documented contract; the docs themselves admit no type discriminator exists. `isUsingOAuth(model)` may be the better check but isn't documented for provider-id-level (only model-level) use.
2. **Extension-settings API** — no documented way to *write* pi settings or register an extension section in `/settings`; own-file convention (`~/.pi/agent/<name>.json` à la preset.ts) is example-only, not spec. No XDG involvement documented.
3. **`AuthStatus` exact shape** — `getProviderAuthStatus` returns `AuthStatus` from `provider-composer.ts` (not in the public typings read here); hknet only relies on `.configured`. Verify field list before depending on more.
4. **`openai` vs `openai-codex` subscription split in 1.4.0+** — which provider id holds the ChatGPT-plan OAuth credential and which usage endpoint answers for it (bundle shows `openai` with "Sign in with ChatGPT" OAuth; the codex usage API historically hangs off `chatgpt.com/backend-api`). Needs a live `/login` test.
5. **Status line width budget** — all extensions' statuses share one truncated footer line; no documented per-extension width guarantee or wrap behavior for very long bars (hknet keeps its bar ~60 cols; claude-code-style layouts may need `setFooter` instead).
6. **Rate-limit etiquette for usage polling** — no documented pi guidance on vendor usage-API rate limits (hknet chose 2-minute polling plus 429 backoff for Claude specifically); must be handled per vendor.
7. **`pi install <github-url>` ref defaults** — docs say URLs are treated as git sources and refs are pinned, but the default ref when none is specified (presumably default branch HEAD at install time) is not spelled out.
