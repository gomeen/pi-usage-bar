# claude-code-usage-bar / codex-statebar — Complete Style + Configuration Spec

Purpose: allow a pixel-exact TypeScript re-implementation of the status-line
renderers **without reading the Python**. Every claim cites `file:line` in the
two primary sources (cloned at `/tmp/wayfinder-refs/`):

- `cs/*` = `claude-code-usage-bar/src/claude_statusbar/`
- `cxs/*` = `codex-statebar/src/codex_statebar/`

Scope: the four looks a TS port must mirror — **aurora block** (default),
**aurora thin**, **ring** (codex-statebar only), **classic** — plus formatting
rules, the color system, thresholds, density, and the config surface.

Note on a naming trap: `cs/render_thin.py` is **not** the `━` renderer — it is
the daemon-client render path ("thin status-line render client", cs/render_thin.py:1-9).
The thin *look* is the `bar_glyph="thin"` branch inside `render_aurora`
(cs/styles.py:233, cxs/styles.py:216).

---

## 0. Shared vocabulary

| Term | Meaning | Source |
|---|---|---|
| style | layout (aurora / ring / classic / capsule / hairline) | cs/styles.py:1-6 |
| theme | palette (graphite only in cs; 8 themes in cxs) | cs/themes.py:1-7 |
| line 1 | the quota/model/cost line produced by the renderer | cs/styles.py:946-967 |
| segment | one `parts[]` element; segments are joined by the style's separator | cs/styles.py:287 |

ANSI primitives (cs/styles.py:14-17, cs/styles.py:74):
`RESET = "\033[0m"`, `BOLD = "\033[1m"`, `ITAL = "\033[3m"`,
`FAINT = "\033[2m"`, and truecolor foreground
`_fg(rgb) = f"\033[38;2;{r};{g};{b}m"` (identical in cxs/styles.py:75-76; a
`_bg(rgb) = "\033[48;2;…m"` variant exists at cs/progress.py:65). When
`use_color=False` the finished line is passed through `_strip`, a regex
`\033\[[0-9;]*m` removal (cs/styles.py:78-79, applied at cs/styles.py:318-320).

---

## 1. The four looks

### 1.1 aurora (default) — 12-cell block bars

Renderer: `render_aurora` (cs/styles.py:205-322; codex twin cxs/styles.py:120-255).

**Window segment** (`window(label, p, chip, forecast, reset, emoji)`,
cs/styles.py:261-270). Exact layout — single spaces between the five zones:

```
{MUTE}{label}{RESET} {bar} {pct_text} {EDGE}⏰{MUTE}{reset or '--'}{emoji}{RESET}
```

- label: `"5h"` / `"7d"` in `theme.mute` (cs/styles.py:264).
- reset: the pre-formatted countdown string; `'--'` when falsy
  (cs/styles.py:265). Emoji (if any) is appended directly after the reset text
  inside the same MUTE run.
- After the window: if a projection chip exists, append `" " + chip`
  (cs/styles.py:266-267); if a forecast chip exists AND the chip yields no
  usable projection (`projection_pct(chip) is None`), append `" " + forecast`
  (cs/styles.py:268-269). A usable projection always wins over the ⚠ forecast —
  both are never shown together.

**The 12-cell bar** (`bar(p, width)`, width=12 at cs/styles.py:264/282/285;
body cs/styles.py:235-253):

- cell glyph: `cell = "━" if bar_glyph == "thin" else "■"`
  (cs/styles.py:233).
- `p is None` → all `width` cells in `theme.edge` (cs/styles.py:237-238).
- clamp p to [0,100]; `filled = int(clamped/100*width + 0.5)` (round-half-up
  via +0.5 truncation); if `p > 0 and filled == 0` force `filled = 1`
  (cs/styles.py:239-242).
- Each filled cell's color is **fixed by its position**, not by severity:
  `t = i/(width-1)` (0 when width==1); if `t < 0.5`:
  `rgb = _blend(s_ok, s_warn, t*2)`; else `rgb = _blend(s_warn, s_hot, (t-0.5)*2)`
  (cs/styles.py:244-249). So the bar sweeps green→amber over the first half of
  the cells and amber→red over the second half regardless of current usage.
- Empty cells (`i >= filled`) render in `theme.edge` (cs/styles.py:250-251).
- Trailing `RESET` closes the bar (cs/styles.py:252).
- codex variant differs only in degenerate cases: `p is None` renders
  `'·' * width` (edge-colored), and empty cells render `'·'` instead of the
  cell glyph when `use_color` is False (cxs/styles.py:222-224, 229).

**Percentage text** (`pct_text(p, rgb)`, cs/styles.py:255-258):

- `p is None` → `{MUTE}--%{RESET}`.
- else `{fg(severity_rgb)}{BOLD}{int(round(p)):>2}%{RESET}` — **bold**,
  right-aligned to 2 characters (so `7%` not `7 %`; 100% overflows to 3).
  Color = the window's severity RGB (`window_severity_rgb`, §3.3), or `ink`
  if that returned None.

**Quota leading segments** (cs/styles.py:275-286):

- `no_quota` (relay/Bedrock/Vertex): one segment
  `{MUTE}ctx{RESET} {bar(ctx_pct, 12)} {pct_text(ctx_pct, ctx_rgb)}` where
  ctx_rgb uses the *context* thresholds 70/85 via `_severity_color`
  (cs/styles.py:276-278).
- `quota_stale and msgs_pct is None and weekly_pct is None`: the whole line 1
  lead becomes the single notice `{fg(s_warn)}⟳ 5h/7d stale·restart{RESET}`
  (cs/styles.py:279-280). codex inserts a space and adapts the label:
  `⟳ 5h/7d stale·restart` or `⟳ 7d stale·restart` when `show_five_hour` is off
  (cxs/styles.py:230-232).
- normal: `window("5h", msgs_pct, projection_5h, forecast_5h, reset_5h, countdown_emoji)`
  then, if `show_weekly`, `window("7d", weekly_pct, projection_7d, forecast_7d, reset_7d)`
  — note the emoji is passed **only to the 5h window** (cs/styles.py:282-285).
  codex additionally gates the 5h window behind `show_five_hour`
  (cxs/styles.py:233-239).

**Model + ctx mini bar** (cs/styles.py:291-296):

- accent color: `accent = _fg(_blend(theme.s_hot, theme.wt, 0.5))` — a rose
  between hot and the worktree hue (cs/styles.py:292). **codex blends hot with
  `ink` instead: `_blend(theme.s_hot, theme.ink, 0.5)`** (cxs/styles.py:220).
- With `ctx_pct` and not no_quota: strip the trailing `(…)` group from the
  model name (regex `\s*\([^()\n]*\)$`, cs/styles.py:192-193), then
  `{accent}{name}{RESET} {bar(ctx_pct, 6)} {fg(ctx_rgb)}{int(round(ctx_pct))}%{RESET}`
  — a **6-cell** mini bar, same positional-blend colors, and a plain
  (non-bold, non-aligned) percent colored by the context band (cs/styles.py:293-296).
  codex drops the mini bar entirely when both quota windows are shown with a
  known 5h pct: `ctx_bar = "" if show_five_hour and msgs_pct is not None else bar(...)+" "`
  (cxs/styles.py:225).
- Without ctx: just `{accent}{model}{RESET}` (full model string incl. parens)
  (cs/styles.py:295-296).

**Trailing segments**, in order (cs/styles.py:298-315):

1. `balance_text` (non-empty) → `{fg(s_ok)}{balance_text}{RESET}`.
2. `cost_text` → `{MUTE}$ {INK}{cost_text}{RESET}`.
3. `lang_body` → `{MUTE}{lang_body}{RESET}`.
4. `cache_age_text` → `{fg(_cache_severity(theme, cache_age_text))}❄ {text}{RESET}`
   where text passes `_aurora_cache_text` (§2.4) and `_cache_severity` maps
   COLD→s_hot, contains 'm'/'h'→s_ok, else (bare seconds)→s_warn
   (cs/styles.py:101-115, 309-311).
5. `bypass` → `{fg(s_hot)}{BOLD}⚠ BYPASS{RESET}` (cs/styles.py:313-314).

**Separator** (`_line_separator`, cs/styles.py:116-126): for non-classic
renderers `sep = f"{pad}{fg(edge)}│{RESET}{pad}"` where pad comes from
`DENSITY_PAD = {"compact": "", "regular": " ", "cozy": "  "}`
(cs/styles.py:85). So: compact `│`, regular ` │ `, cozy `  │  `. codex builds
the same inline (cxs/styles.py:241-242).

### 1.2 aurora thin

Identical renderer, identical colors, identical config surface — only the cell
glyph changes: `bar_glyph="thin"` → `cell = "━"` (cs/styles.py:233; codex
cxs/styles.py:216). The picker exposes it as its own look: LOOKS = block /
thin / classic with commands `cs config set bar_glyph thin` etc.
(cs/picker.py:13-17). Colors are the same (cs/config.py:32-34 comment).

### 1.3 ring (codex-statebar only)

Renderer: `render_ring` (cxs/styles.py:270-366). Tagline in the source:
"`◔ 14% 5h · resets 1h07m   ◕ 83% 7d · resets 3d04h`: a fill ring per window"
(cxs/styles.py:290; also the CLI description cxs/cli.py:137).

**Ring glyph quanta** (`_ring_glyph(p)`, cxs/styles.py:259-268):

- `_RING_GLYPHS = "○◔◑◕●"` (cxs/styles.py:257) — indexes 0..4.
- `p is None` → `"○"`; clamp p to [0,100]; `idx = int(clamped/25 + 0.5)`
  (nearest multiple of 25); if `clamped > 0 and idx == 0` force `idx = 1`
  (any nonzero usage shows at least ◔).
- Net mapping: 0% → ○; >0–12.5% → ◔; 12.5–37.5% → ◑… wait — precisely:
  idx = round(p/25), so p<12.5 → 0 (→ forced 1 if p>0), 12.5–37.5 → 1 (◔),
  37.5–62.5 → 2 (◑), 62.5–87.5 → 3 (◕), ≥87.5 → 4 (●). (int(x+0.5) rounds
  half-up; boundary 12.5 → idx 1 → ◔, boundary 87.5 → idx 4 → ●.)
  Worked checks: 14% → int(0.56+0.5)=1 → ◔; 83% → int(3.32+0.5)=3 → ◕.

**Ring window segment** (`window`, cxs/styles.py:310-321):

```
out = f"{ring(p, rgb)} {pct_text(p)} {MUTE}{label}"
if reset and reset != "--":
    out += f" · resets {reset}{emoji}"
out += RESET
if chip:      out += " " + _render_projection(chip, ...)
if forecast and projection_pct(chip) is None:
              out += " " + _render_forecast(forecast, ...)
```

- `ring(p, rgb)` = the glyph colored `{fg(rgb)}` when both rgb and p are
  known, else `EDGE` (cxs/styles.py:300-302). rgb = `window_severity_rgb(...)`
  — same projection-first logic as aurora (cxs/styles.py:311-312).
- `pct_text(p)` = `{INK}{BOLD}{int(round(p))}%{RESET}` — bold ink, **no
  right-alignment, no severity color** (severity lives in the glyph)
  (cxs/styles.py:304-308). `None` → `{MUTE}--%{RESET}`.
- ` · resets {reset}` — the literal string ` · resets ` (space, U+00B7 middle
  dot, space) — continues the MUTE run started by the label (no RESET between
  label and resets); `emoji` may follow the reset text (cxs/styles.py:313-314).
  Shown only when reset is truthy and not `"--"`.

**Separator**: `_RING_SEP = {"compact": "  ", "regular": "   ", "cozy": "    "}`
— 2/3/4 plain spaces; regular density is the **triple-space separator**
(cxs/styles.py:368, used at cxs/styles.py:324). The multi-line `render()`
wrapper reuses `" | "` for classic, `"   "` for ring, ` │ ` otherwise when
packing rows (cxs/styles.py:1296-1310).

**Other ring segments** (cxs/styles.py:323-352): identical to aurora —
no_quota variant is `ring(ctx_pct, ctx_rgb) pct ctx` i.e.
`{ring} {pct_text} {MUTE}ctx{RESET}` (cxs/styles.py:325-327); stale notice
(cxs/styles.py:328-331); model with accent `_blend(s_hot, ink, 0.5)` but the
ctx readout is textual: `{accent}{name}{RESET} {MUTE}ctx {fg(ctx_rgb)}{pct}%{RESET}`
(cxs/styles.py:338-345); balance / `$ cost` / lang / `❄ cache` / `⚠ BYPASS`
identical to aurora (cxs/styles.py:346-352).

### 1.4 classic — the original battery layout

`render_classic` wraps `format_status_line` (cs/styles.py:327-381 →
cs/progress.py:468-643). Layout per quota dimension
(`_build_dimension`, cs/progress.py:300-315 + calls):

```
{severity}{label}{RESET}{mute}[{RESET}{battery}{mute}]{RESET}⏰{reset}{emoji} [ →NN% | ⚠~eta ]
```

- separator between segments: `" | "` colored mute (cs/progress.py:641,
  cs/styles.py:121-122).
- battery = `build_battery_bar(pct, width=10)` (cs/progress.py:231-276):
  - text overlay `"MAX"` if pct>100 else `f"{pct:.0f}%"`, `.center(width)`
    (cs/progress.py:238-239);
  - `filled = int(clamped/100*10 + 0.5)`, min 1 cell when pct>0
    (cs/progress.py:236-237);
  - filled cells: `bg(_blend(fill_rgb, fill_dark, t))` with
    `t = i/(filled-1)` and `fill_dark = _blend(fill_rgb, (0,0,0), 0.35)`
    — same-hue fade toward black, first cell = exact severity color
    (cs/progress.py:110-117, 244-246); glyph/overlay fg = `theme.pill_ink`;
  - empty cells: `bg(theme.edge)` (cs/progress.py:247);
  - the % digits inside the bar ride on whichever bg their column has
    (cs/progress.py:244-246, 266-268);
  - optional `shimmer_phase` (default-off `bar_shimmer`) twinkles star glyphs
    in empty cells — deterministic hashes, `⋆` field 1-in-4 cells, flare
    `✦/✧` 1 tick in 6 (cs/progress.py:69-133) — out of scope for a port's
    v1, but the *plain* render must skip it when phase is None.
- fill_rgb for 5h/7d = the window severity rgb (projection-first;
  cs/progress.py:586-596); the label color and the `⏰{reset}` use the same
  color (cs/progress.py:597-601); the emoji is appended only on the 5h reset
  (cs/progress.py:598); 7d gets `⏰{reset_7d}` with no emoji, and only when
  `reset_time_7d` is truthy (cs/progress.py:603-606).
- projection chip appended after a space (cs/progress.py:599-600, 607-608);
  forecast only when no usable projection (cs/progress.py:601-602, 609-610).
- model via `_format_model`: name in model color, parens in mute, inner text
  in model color, anchored to the **last** `(...)` group
  (cs/progress.py:447-467); model color = ink when ctx unknown, else
  context-band 70/85 color (cs/progress.py:613-627).
- `$ {cost}` ink, `📚 {lang}` s_ok, `⚠️BYPASS` hot (note: classic uses the
  emoji-variation `⚠️BYPASS`, aurora uses plain `⚠ BYPASS`;
  cs/progress.py:629-634 vs cs/styles.py:313-314).
- cache age is appended **by `render_classic`, after** format_status_line:
  ` | cache {text}` three-level severity (cs/styles.py:372-381).
- no_quota (cs/progress.py:496-537): `ctx[battery]` (context band 70/85,
  fill_rgb preset so the battery shows the same color), then neutral-ink
  model, then balance — fuel-gauge `bal[battery]` on *remaining* % when
  `balance_pct` is known (fill green-full→red-empty, thresholds ≤10% hot /
  ≤25% warn, cs/progress.py:38-56), `bal $X`-style text otherwise, then cost.
- classic ignores `density` (its separator is fixed `" | "`, and
  `DENSITY_PAD` is not consulted — cs/styles.py:118-122).

---

## 2. Formatting rules

### 2.1 Reset countdown (⏰ text)

Produced upstream in `core.main`, never by the renderers (cs/core.py:1472-1496):

- 5h: `total_min = max(0, floor(diff_seconds/60))`; `h = total_min//60`,
  `m = total_min%60`; `h>0 → f"{h}h{m:02d}m"` (e.g. `2h15m`, `1h07m`) else
  `f"{m}m"`; missing resets_at → `"--"` (cs/core.py:1472-1482).
- 7d: from total seconds; `d>0 → f"{d}d{h:02d}h"` (e.g. `3d04h`); elif
  `h>0 → f"{h}h{m:02d}m"`; else `f"{m}m"`; missing → `""` (cs/core.py:1483-1496).
- No seconds ever appear in the reset countdown.

### 2.2 Cache-age countdown + the 10-minute seconds rule

Raw countdown from `format_cache_countdown`/`format_cache_remaining`
(cs/activity.py:139-176): `COLD` when expired/absent; else ceil-to-second
remaining as `XhMMmSSs` / `MmSSs` / `Ys` (sub-minute drops the `m`).

Aurora/ring then apply `_aurora_cache_text` (cs/styles.py:196-203,
cxs/styles.py:113-120): regex `(\d+)m\d+s$` — drop the `SSs` when the text
contains `h` **or** minutes ≥ 10 (`1h00m00s` → `1h00m`, `59m12s` → `59m`);
**under 10 minutes the seconds stay** (`4m23s`). Classic shows the raw string
as `cache {text}` (cs/styles.py:372-381).

### 2.3 Percentage text

aurora: bold, right-aligned `{int(round(p)):>2}%` (cs/styles.py:257-258;
note Python banker's rounding via round()). ring: bold ink, unaligned
`{int(round(p))}%` (cxs/styles.py:306-307). classic battery overlay:
`{pct:.0f}%` centered in the 10 cells, `MAX` above 100 (cs/progress.py:238-239).

### 2.4 ⏰ emoji (`countdown_emoji`)

`get_countdown_emoji(minutes_to_reset)` (cs/progress.py:432-438): None → "";
≤1 → `" 🎉"`; ≤10 → `" ✨"`; ≤30 → `" ⚡"`; else `""`. Wired only into the 5h
window (cs/core.py:1526, cs/styles.py:282-285, cs/progress.py:598).

### 2.5 Amount formatting (K abbreviation)

`format_number` (cs/core.py:877-884): ≥1e9 → `{n/1e9:.1f}B`; ≥1e6 →
`{n/1e6:.1f}M`; ≥1e3 → `{n/1e3:.1f}k`; else `{n:.0f}`. This is what produces
model suffixes like `(280.0k/1.0M)`.

### 2.6 Projection & forecast chips (grammar + render rules)

- Projection chip grammar: `→{pct:.0f}%` clamped 0–100
  (`_format_projection_pct`, cs/predict.py:1160-1161); when depletion is
  projected the ETA is appended: `chip += f"·{_format_eta(eta)}"` →
  `→100%·1h12m` (cs/predict.py:1272-1278); `_format_eta`: <60s → `<1m`,
  <3600 → `Mm`, <86400 → `HhMMm` (or `Hh` when m==0), else `DdHh`
  (cs/predict.py:1163-1173). Not-yet-computable placeholder is `→--`
  (cs/predict.py:51).
- Forecast chip grammar: `~` + `format_eta`: `~30s` / `~40m` / `~2h10m`
  (cs/predict.py:227-234).
- Rendering: `_render_projection` = the chip in `_projection_color`
  (cs/progress.py:428-430): parse int after stripping `→` and `%`; ≥85 → hot,
  ≥70 → warn, else mute; unparseable (`→--`) → mute (cs/progress.py:400-416).
  `_render_forecast`: `~…` → `⚠{chip}` in `_forecast_color` — hot when the
  body is bare seconds or `~Nm` with N≤10, else warn; a bare `→NN%` forecast
  (rare) colors like a projection (cs/progress.py:385-426).
- Suppression rule: the ⚠ forecast renders only when
  `projection_pct(chip) is None` — `→96%` would otherwise contradict
  `⚠~25m` (cs/styles.py:268-269, cs/progress.py:601-602). `projection_pct`
  itself: regex `→?\s*(\d+(?:\.\d+)?)%` on the leading number (handles the
  `·1h12m` suffix), None for empty/`→--`/unparseable (cs/progress.py:174-194).

### 2.7 no-quota and stale states

- no_quota (config `api_mode`): quota bars dropped, ctx promoted to a full
  window-style bar (aurora cs/styles.py:276-278; ring cxs/styles.py:325-327;
  classic battery cs/progress.py:496-537) with the **context band 70/85**, not
  the comfort band (cs/progress.py:31-34).
- quota_stale (daemon/cache rot, both pcts None): `⟳ 5h/7d stale·restart`
  warn-colored as the lead segment (cs/styles.py:279-280); classic path
  cs/progress.py:539-566.

---

## 3. Color system

### 3.1 graphite palette (exact RGB)

cs `themes.py` — the only theme (cs/themes.py:46-56):

| Role | RGB | Meaning |
|---|---|---|
| ink | (218, 221, 225) | primary text (numbers, model) |
| mute | (120, 125, 132) | secondary (labels, separators, units) |
| edge | (75, 80, 88) | faint dividers, empty bar cells |
| s_ok | **(78, 200, 91)** | calm green |
| s_warn | (232, 178, 96) | amber |
| s_hot | (232, 116, 116) | red |
| pill_5h / pill_7d / pill_model / pill_lang / pill_cost | (38,70,83) / (42,56,79) / (60,47,65) / (52,65,47) / (48,56,50) | classic/capsule pill bg (kept for Theme compat) |
| pill_ink | (238, 235, 224) | text on pill/battery bg |
| wt | (168, 152, 226) | worktree marker violet |

codex-statebar's graphite is **identical except s_ok = (120, 200, 192)** (teal)
(cxs/themes.py:42-49), and cxs ships 7 more themes (twilight, linen, nord,
dracula, sakura, mono, catppuccin-mocha, tokyo-night — cxs/themes.py:51-121).
Unknown theme names fall back to graphite (cs/themes.py:59-61).

### 3.2 `_blend` formula

`_blend(a, b, t) = tuple(int(a[i] + (b[i]-a[i])*t))` — component-wise lerp,
truncating per channel, t=0 → a, t=1 → b (cs/progress.py:60-63). Sibling
`_lighten(rgb, amount)` lerps toward white (cs/progress.py:68-70).

### 3.3 `window_severity_rgb` — how the pct picks the color

(cs/progress.py:196-224; identical constants in cxs/progress.py:14-34, 211-212.)

1. `proj = projection_pct(chip)`; if a usable projection exists, judge **the
   projection** against the fixed cap thresholds `PROJECTION_WARNING_THRESHOLD
   = 70.0` / `PROJECTION_CRITICAL_THRESHOLD = 85.0` (cs/progress.py:21-30) —
   the window is colored by where it is *headed*. (The docstring's "warn 80 /
   crit 100" is stale; the constants at lines 25-26 are authoritative.)
2. else if `current_pct` is not None, judge current pct against the
   **configurable comfort thresholds** (`normalize_thresholds`, default
   30/70, §4).
3. else return None (nothing to color → caller uses mute/ink).
4. `pct >= critical → s_hot; pct >= warning → s_warn; else s_ok`.

Non-window gauges: context uses fixed 70/85 (`CONTEXT_WARNING_THRESHOLD` /
`CONTEXT_CRITICAL_THRESHOLD`, cs/progress.py:31-34); classic battery fallback
`color_for_percent` (cs/progress.py:154-163) and `_severity_color` in styles
(cs/styles.py:88-96) implement the same ≥crit/≥warn/else ladder.

### 3.4 FAINT / dim usage

`FAINT = "\033[2m"` (cs/styles.py:16). Used for: the main-checkout worktree
marker on the identity line (`{FAINT}{fg(wt)}worktree (🌳N){RESET}`,
cs/styles.py:493-497), the trailing version segment
(`{FAINT}{EDGE}· vX.Y.Z{RESET}`, cs/styles.py:578-580), and the thin client's
stale-serve mark `\x1b[2m⟳\x1b[0m` (cs/render_thin.py:478). Line-1 renderers
proper do not use FAINT.

### 3.5 color_* overrides

Config keys `color_ok` / `color_warn` / `color_hot` (both repos) and
`color_worktree` store hex strings (cs/config.py:151-160, cxs/config.py:96-99).
`parse_hex_color` accepts `#rrggbb`, `#rgb`, bare `rrggbb`/`rgb`, strict
ValueError otherwise (cs/themes.py:71-84). `apply_color_overrides` returns a
new Theme (never mutates) replacing only `s_ok/s_warn/s_hot/wt` where provided
(cs/themes.py:88-113). Empty string clears an override to None
(cs/config.py:418-425).

### 3.6 Truecolor emission

All color is 24-bit SGR: fg `\033[38;2;{r};{g};{b}m` (cs/styles.py:74),
bg `\033[48;2;{r};{g};{b}m` (cs/progress.py:65). `use_color=False` strips all
CSI-m sequences from the final string (cs/styles.py:77-79, 318-320).

---

## 4. Thresholds & density

- `warning_threshold` default **30.0**, `critical_threshold` default **70.0**
  (`DEFAULT_WARNING_THRESHOLD`/`DEFAULT_CRITICAL_THRESHOLD`,
  cs/progress.py:13-14). `normalize_thresholds` enforces
  `0 <= warning < critical <= 100` else ValueError (cs/progress.py:138-145);
  config `set_value` refuses a pair that breaks it (cs/config.py:398-417).
  Resolution: explicit flag → config → default (cs/core.py:1111-1124).
- Projection band (fixed, not configurable): warn 70 / crit 85
  (cs/progress.py:25-26). Context band (fixed): 70 / 85 (cs/progress.py:32-33).
  Balance fuel gauge (fixed, on remaining %): warn ≤25 / hot ≤10
  (cs/progress.py:38-40).
- Density: `DENSITY_PAD = {"compact": "", "regular": " ", "cozy": "  "}`
  pads the `│` separator (cs/styles.py:85,116-126); ring uses
  `_RING_SEP = {"compact": "  ", "regular": "   ", "cozy": "    "}`
  (cxs/styles.py:368). Valid values {compact, regular, cozy}
  (cs/config.py:446, cxs/config.py:229); default regular.
- `narrow_layout` (line 1 wider than the pane):
  - **drop** (cs default, cs/config.py:38, cs/styles.py:936): shed optional
    segments least-important-first until the first line fits — order: cache →
    lang → cost → balance → forecast → projection, then shrink the model name
    in two steps (drop context denominator, then whole `(…)` suffix)
    (cs/styles.py:1008-1033, `_shorter_models` cs/styles.py:151-155).
  - **stack** (codex default, cxs/config.py:47, cxs/styles.py:1254): cs's
    `_stack` re-flows — each quota bar (labels right-aligned so bars line up)
    gets its own row, remaining segments pack after
    (cs/styles.py:170-193, 969-1000); cxs instead packs whole segments into
    rows, dropping trailing ones only in drop mode (cxs/styles.py:1301-1316).
  Final output is width-clipped per physical line (cs/styles.py:1101,
  `clip_lines`).

---

## 5. Config keys the TS port must mirror

### 5.1 claude-code-usage-bar (`~/.claude/claude-statusbar.json`, cs/config.py)

Resolution: CLI flag → env (`CLAUDE_STATUSBAR_STYLE`/`_THEME`) → file → default
(cs/config.py:1-9, 487-503). Persistence is **sparse** (only non-default keys
written, cs/config.py:297-317).

| key | type | default | notes |
|---|---|---|---|
| style | str | `"aurora"` | aurora \| classic (cs/styles.py:1223-1226) |
| theme | str | `"graphite"` | cs/config.py:24 |
| density | str | `"regular"` | compact \| regular \| cozy |
| bar_glyph | str | `"block"` | block \| thin — aurora cells |
| looks_seen | int | 0 | picker bookkeeping, LOOKS_VERSION=1 |
| auto_compact_width | int | 0 | deprecated no-op |
| show_weekly | bool | true | 7d window |
| show_per_model | bool | false | per-model scoped bars |
| show_language | bool | true | `📚 ZH:band↑` segment |
| show_cost | bool | false | `$ x.xx` segment |
| show_balance | bool | true | relay balance (no-quota) |
| balance_bar | bool | true | fuel-gauge vs text |
| show_cache_age | bool | true | `❄` segment |
| show_project_branch | bool | true | 2nd line |
| show_ocs | bool | true | ocs address line |
| show_cwd | bool | false | cwd segment (#30) |
| cwd_style | str | `"basename"` | basename \| full |
| narrow_layout | str | `"drop"` | drop \| stack |
| show_todos | bool | true | activity line |
| show_tools | bool | false | active tool |
| show_tool_rollup | bool | false | completed tools rollup |
| show_agents | bool | false | subagent lines |
| show_ip_risk | bool | false | egress IP chip |
| show_fp_risk | bool | true | custom-endpoint notice |
| show_duration | bool | false | session duration |
| show_lines | bool | true | +added −removed |
| show_ahead_behind | bool | false | ↑N↓N |
| show_version | bool | true | faint version |
| show_mode | bool | false | ⚙ effort line |
| mode_gradient | bool | true | static gradient on mode line |
| bar_shimmer | bool | false | battery particles (classic) |
| show_forecast | bool | true | `⚠~eta` chip |
| show_projection | bool | true | `→NN%` chip |
| cache_ttl_seconds | int | 300 | deprecated, auto-detected |
| api_mode | str | `"auto"` | auto \| on \| off |
| warning_threshold | float\|null | null→30.0 | comfort band |
| critical_threshold | float\|null | null→70.0 | comfort band |
| color_ok / color_warn / color_hot | str\|null | null | hex overrides |
| color_worktree | str\|null | null | wt hue override |
| worktree_glyph | str | `"🌳"` | 1-2 cells |
| auto_upgrade | bool | true | |
| lang | str | `"auto"` | auto \| zh \| en |

(cs/config.py:42-170 for defaults; VALID_KEYS at 318-344; bool parsing `_to_bool`
accepts 1/true/yes/on/y/t, cs/config.py:173-176.)

### 5.2 codex-statebar (`~/.codex/codex-statebar.json`, cxs/config.py)

Same design plus a fallback chain: CLI → env (`CODEX_STATEBAR_*` or
`CLAUDE_STATUSBAR_*`) → codex file → **claude file** → default
(cxs/config.py:1-11, 44-51, 353-381). Key differences:

| key | type | default | delta vs cs |
|---|---|---|---|
| style | str | `"aurora"` | adds ring, capsule, hairline (cxs/styles.py:1223-1229) |
| narrow_layout | str | **`"stack"`** | cs defaults drop (cxs/config.py:47) |
| show_mode | bool | **true** | cs false |
| show_resets | bool | true | **codex-only** (announcements/reset line) |
| show_party | bool | true | **codex-only** (AgentParty line) |
| show_per_model | — | absent | not in cxs |
| lang | str | `"auto"` | validates auto\|zh\|en\|zh-TW\|ja\|ko (cxs/config.py:330-335) |
| looks_seen | int | 0 | LOOKS_VERSION=2 (cxs/config.py:22) |
| bar_glyph, density, thresholds, color_*, worktree_glyph, show_weekly, show_cost, show_balance, balance_bar, show_cache_age, show_project_branch, show_ocs, show_cwd, cwd_style, show_todos, show_tools, show_tool_rollup, show_agents, show_ip_risk, show_fp_risk, show_duration, show_lines, show_ahead_behind, show_version, mode_gradient, bar_shimmer, show_forecast, show_projection, cache_ttl_seconds, api_mode, auto_upgrade | | same | cxs/config.py:42-99, VALID_KEYS 205-227 |

codex's renderer-level extras: `show_five_hour` (kwarg on renderers,
cxs/styles.py:126) and the picker's ring look (cxs/picker.py:13-17).

---

## 6. Worked examples

Pseudo-markup: `<rgb:r,g,b>` = `\033[38;2;r;g;bm`, `<bg:r,g,b>` = bg form,
`<bold>` = `\033[1m`, `<r>` = `\033[0m`. Sample data: 5h=42% reset 2h15m,
7d=83% reset 3d04h, model `Opus 4.7(280.0k/1.0M)` (ctx 28%), no
projection/forecast, density=regular, graphite, `countdown_emoji=""`.

### 6.1 aurora block

Severity: 42% ≥ 30 → warn (232,178,96); 83% ≥ 70 → hot (232,116,116).
5h bar (12 cells, filled=5): position-blend greens→ambers
i0 (78,200,91), i1 (106,196,91), i2 (134,192,92), i3 (162,188,93),
i4 (190,184,94); i5-11 edge (75,80,88).
7d bar (filled=10): i0-i4 as above, i5 (218,180,95) [t=0.4545<0.5],
i6 (232,172,97), i7 (232,161,101), i8 (232,149,105), i9 (232,138,108)
[warn→hot, (t-0.5)*2]; i10-11 edge.
Model accent = blend(hot, wt, 0.5) = (200,134,171); ctx mini bar 6 cells
filled=2: i0 (78,200,91), i1 (139,191,93); ctx 28% < 70 → s_ok.

```
<mute:120,125,132>5h<r> <78,200,91>■<106,196,91>■<134,192,92>■<162,188,93>■<190,184,94>■<75,80,88>■■■■■■■<r> <232,178,96><bold>42%<r> <75,80,88>⏰<120,125,132>2h15m<r>
<edge>│<r>   ← separator " │ " (regular)
<mute>7d<r> <…10 position-blend cells…><75,80,88>■■<r> <232,116,116><bold>83%<r> <75,80,88>⏰<120,125,132>3d04h<r>
<sep>
<200,134,171>Opus 4.7<r> <78,200,91>■<139,191,93>■<75,80,88>■■■■<r> <78,200,91>28%<r>
```

Plain text: `5h ■■■■■■■■■■■■ 42% ⏰2h15m │ 7d ■■■■■■■■■■■■ 83% ⏰3d04h │ Opus 4.7 ■■■■■■ 28%`

### 6.2 aurora thin

Byte-identical structure; every `■` (both filled and edge-empty cells)
replaced by `━` (cs/styles.py:233). Example window:

```
<mute>5h<r> <78,200,91>━<106,196,91>━<134,192,92>━<162,188,93>━<190,184,94>━<75,80,88>━━━━━━━<r> <232,178,96><bold>42%<r> <75,80,88>⏰<120,125,132>2h15m<r>
```

### 6.3 ring (codex graphite)

Glyphs: 42% → idx=int(42/25+0.5)=int(2.18)=2 → ◑; 83% → 3 → ◕.
Colors: 42% → s_warn (232,178,96); 83% → s_hot (232,116,116); pct bold ink
(218,221,225); `· resets …` inherits MUTE from the label run; separator is
three spaces.

```
<232,178,96>◑<r> <218,221,225><bold>42%<r> <120,125,132>5h · resets 2h15m<r>
<232,116,116>◕<r> <218,221,225><bold>83%<r> <120,125,132>7d · resets 3d04h<r>
   <200,134,171>Opus 4.7<r> <120,125,132>ctx <78,200,91>28%<r>   ← codex s_ok is teal (120,200,192)
```

Plain text: `◑ 42% 5h · resets 2h15m   ◕ 83% 7d · resets 3d04h   Opus 4.7 ctx 28%`
(For the canonical 14% example: `<120,200,192>◔<r> <bold ink>14%<r> <mute>5h · resets 1h07m<r>`.)

### 6.4 classic

5h battery: 42% → filled=4, overlay `"   42%    "` (`.center(10)`); fill
s_warn (232,178,96) fading to fill_dark blend(fill,black,0.35)=(150,115,62);
t=i/3 over filled: cell bgs (232,178,96), (204,157,84), (177,136,73),
(150,115,62); '4' rides the last filled bg, '2'/'%' ride bg edge; all fg
pill_ink (238,235,224). 7d battery: 83% → filled=8, fill s_hot.

```
<232,178,96>5h<r><120,125,132>[<r><bg:232,178,96><238,235,224> <r><bg:204,157,84><238,235,224> <r><bg:177,136,73><238,235,224> <r><bg:150,115,62><238,235,224>4<r><bg:75,80,88><238,235,224>2%<r><bg:75,80,88><238,235,224>    <r><120,125,132>]<r><232,178,96>⏰2h15m<r>
<mute> | <r>
<232,116,116>7d<r><mute>[<r><…8-cell hot fade… "   83%    " overlay…><mute>]<r><232,116,116>⏰3d04h<r>
<mute> | <r>
<218,221,225>Opus 4.7<mute>(<r><ink>280.0k/1.0M<r><mute>)<r>
```

Plain text: `5h[   42%    ]⏰2h15m | 7d[   83%    ]⏰3d04h | Opus 4.7(280.0k/1.0M)`
(`"42%".center(10)` and `"83%".center(10)` both pad 3 left / 4 right —
`str.center` puts the odd extra space on the right; the trailing spaces sit on
bg-edge like the other empty cells.)

---

## Confidence & open questions

**High confidence** (read directly, cited): all four looks' segment grammar,
glyph quanta, separators/density, graphite RGBs, `_blend`,
`window_severity_rgb` ladder incl. 70/85 projection band, threshold defaults
30/70 + validation, `countdown_emoji` tiers, reset/cache formatters incl. the
keep-seconds-under-10-minutes rule, chip grammar (`→NN%`, `→100%·1h12m`,
`→--`, `~25m`) and render/suppression rules, `format_number` thresholds,
color override mechanism, full config tables, drop vs stack behavior.

**Discrepancies worth deciding in the port:**

1. `window_severity_rgb`'s docstring says "warn 80 / crit 100" but the code
   constants are 70/85 (cs/progress.py:200 vs 25-26). Trust the constants.
2. cs vs cxs graphite `s_ok` differ: (78,200,91) green vs (120,200,192) teal;
   model accent blends hot→wt in cs but hot→ink in cxs. A single TS theme
   must pick per-source or parameterize.
3. codex aurora renders `·` for empty cells in no-color mode and for
   pct=None; claude always renders the cell glyph in edge color.
4. Classic's `"⚠️BYPASS"` (emoji VS) vs aurora's `"⚠ BYPASS"` (space) —
   intentional per-file difference, keep both verbatim.

**Open questions:**

- Exact upstream construction of the model string (`display_name` +
  `(used/size)` suffix assembly) and cost_text/balance_text formatting live in
  cs/core.py beyond the cited lines; the renderers treat them as opaque
  strings, which is the correct seam for the TS port.
- `percent:.0f` vs `int(round(p))`: Python's round() is banker's rounding and
  `:.0f` rounds half-to-even too — JS `Math.round` differs on exact .5
  (up vs even). Negligible in practice but a port should note it.
- Shimmer/star-field details (bar_shimmer) and the identity/activity/ocs/mode
  lines are summarized but not fully specified here; they are outside the
  four-looks scope.
