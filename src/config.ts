/**
 * Config seam (issue 009): `~/.pi/agent/usage-bar.json`.
 *
 * Load is total: missing file, corrupt JSON, wrong types — all silently fall
 * back to DEFAULT_CONFIG. validateConfig never throws. sparseSave persists only
 * non-default keys (cs-style sparse config). read/write are injectable so tests
 * never touch the filesystem. The only non-pi module allowed to import node
 * builtins (it runs under pi's node).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { isPlanKind } from "./detect.js";
import type { UsageBarConfig } from "./types.js";
import { DEFAULT_CONFIG } from "./types.js";

export function configFilePath(explicitPath?: string): string {
	return explicitPath ?? join(homedir(), ".pi", "agent", "usage-bar.json");
}

function defaultReader(p: string): string | undefined {
	try {
		return readFileSync(p, "utf8");
	} catch {
		return undefined; // missing or unreadable -> defaults
	}
}

function defaultWriter(p: string, s: string): void {
	mkdirSync(dirname(p), { recursive: true });
	writeFileSync(p, s, "utf8");
}

function jsonClone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Load + merge + validate. Merge order: defaults < file (env overrides stay
 * env-only, issue 009). `display` merges field-by-field; other keys replace.
 */
export function loadConfig(
	read: (p: string) => string | undefined = defaultReader,
	pathOverride?: string,
): UsageBarConfig {
	let raw: string | undefined;
	try {
		raw = read(configFilePath(pathOverride));
	} catch {
		raw = undefined;
	}
	if (raw === undefined) return jsonClone(DEFAULT_CONFIG);
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return jsonClone(DEFAULT_CONFIG); // corrupt -> defaults, silently
	}
	return mergeIntoDefaults(parsed);
}

function mergeIntoDefaults(raw: unknown): UsageBarConfig {
	const merged: Record<string, unknown> = jsonClone(
		DEFAULT_CONFIG,
	) as unknown as Record<string, unknown>;
	if (isPlainObject(raw)) {
		for (const [key, value] of Object.entries(raw)) {
			if (key === "display" && isPlainObject(value)) {
				const baseDisplay = isPlainObject(merged.display) ? merged.display : {};
				merged.display = { ...baseDisplay, ...value };
			} else {
				merged[key] = value;
			}
		}
	}
	return validateConfig(merged as unknown as UsageBarConfig);
}

const STYLE_VALUES: ReadonlySet<string> = new Set([
	"aurora",
	"ring",
	"classic",
]);
const GLYPH_VALUES: ReadonlySet<string> = new Set(["block", "thin"]);
const THEME_VALUES: ReadonlySet<string> = new Set(["graphite", "pi"]);
const DENSITY_VALUES: ReadonlySet<string> = new Set([
	"compact",
	"regular",
	"cozy",
]);
const DISPLAY_MODES: ReadonlySet<string> = new Set(["active", "all"]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function enumOr<T extends string>(
	value: unknown,
	allowed: ReadonlySet<string>,
	fallback: T,
): T {
	return typeof value === "string" && allowed.has(value)
		? (value as T)
		: fallback;
}

function finiteOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, lo: number, hi: number): number {
	return Math.min(hi, Math.max(lo, value));
}

function colorOr(value: unknown): string {
	return typeof value === "string" && HEX_COLOR.test(value) ? value : "";
}

/** 0 <= warning < critical <= 100: swap reversed pairs, nudge equal pairs apart. */
function normalizeThresholds(
	warning: number,
	critical: number,
): [number, number] {
	const w = clamp(warning, 0, 100);
	const c = clamp(critical, 0, 100);
	if (w > c) return [c, w];
	if (w === c) return c < 100 ? [w, Math.min(100, c + 1)] : [99, c];
	return [w, c];
}

function normalizeProviderMap(
	value: unknown,
): Record<string, string | { type: "relay" }> {
	if (!isPlainObject(value)) return {};
	const out: Record<string, string | { type: "relay" }> = {};
	for (const [id, entry] of Object.entries(value)) {
		if (isPlanKind(entry)) {
			out[id] = entry;
		} else if (isPlainObject(entry) && entry.type === "relay") {
			out[id] = { type: "relay" };
		}
		// Anything else is dropped (issue 009: string plan or relay object only).
	}
	return out;
}

/**
 * Clamp/coerce every field to a valid config. Total function: runtime data fed
 * in by loadConfig may violate the UsageBarConfig type, so every field is
 * checked defensively. Never throws.
 */
export function validateConfig(cfg: UsageBarConfig): UsageBarConfig {
	// Trust the type for ergonomics, re-check at runtime for total safety.
	const src = cfg as unknown as Record<string, unknown>;
	const display = isPlainObject(src.display) ? src.display : {};
	const providers = Array.isArray(display.providers)
		? (display.providers as unknown[]).filter(isPlanKind)
		: [];
	const [warning, critical] = normalizeThresholds(
		finiteOr(src.warning_threshold, DEFAULT_CONFIG.warning_threshold),
		finiteOr(src.critical_threshold, DEFAULT_CONFIG.critical_threshold),
	);
	return {
		style: enumOr(src.style, STYLE_VALUES, DEFAULT_CONFIG.style),
		bar_glyph: enumOr(src.bar_glyph, GLYPH_VALUES, DEFAULT_CONFIG.bar_glyph),
		theme: enumOr(src.theme, THEME_VALUES, DEFAULT_CONFIG.theme),
		density: enumOr(src.density, DENSITY_VALUES, DEFAULT_CONFIG.density),
		bar_width: Math.round(
			clamp(finiteOr(src.bar_width, DEFAULT_CONFIG.bar_width), 4, 24),
		),
		color_ok: colorOr(src.color_ok),
		color_warn: colorOr(src.color_warn),
		color_hot: colorOr(src.color_hot),
		warning_threshold: warning,
		critical_threshold: critical,
		display: {
			mode: enumOr(display.mode, DISPLAY_MODES, DEFAULT_CONFIG.display.mode),
			providers,
			compact_others:
				typeof display.compact_others === "boolean"
					? display.compact_others
					: DEFAULT_CONFIG.display.compact_others,
		},
		providerMap: normalizeProviderMap(src.providerMap),
		refresh_minutes: Math.max(
			1,
			finiteOr(src.refresh_minutes, DEFAULT_CONFIG.refresh_minutes),
		),
		show_resets:
			typeof src.show_resets === "boolean"
				? src.show_resets
				: DEFAULT_CONFIG.show_resets,
		show_reset_countdown:
			typeof src.show_reset_countdown === "boolean"
				? src.show_reset_countdown
				: DEFAULT_CONFIG.show_reset_countdown,
		show_balance:
			typeof src.show_balance === "boolean"
				? src.show_balance
				: DEFAULT_CONFIG.show_balance,
		currency:
			typeof src.currency === "string" ? src.currency : DEFAULT_CONFIG.currency,
	};
}

/**
 * Persist only keys whose value differs from DEFAULT_CONFIG (sparse, cs-style).
 * `display` compares as a whole: if it differs, the entire nested object is
 * written. Key order follows DEFAULT_CONFIG so output is deterministic.
 */
export function sparseSave(
	cfg: UsageBarConfig,
	write: (p: string, s: string) => void = defaultWriter,
	pathOverride?: string,
): void {
	const sparse: Record<string, unknown> = {};
	const values = cfg as unknown as Record<string, unknown>;
	for (const [key, defaultValue] of Object.entries(DEFAULT_CONFIG)) {
		if (JSON.stringify(values[key]) !== JSON.stringify(defaultValue)) {
			sparse[key] = values[key];
		}
	}
	write(configFilePath(pathOverride), `${JSON.stringify(sparse, null, 2)}\n`);
}

/** PI_*_ENDPOINT env vars -> provider fetch endpoint keys (env-only, never persisted). */
const ENDPOINT_ENV: ReadonlyArray<{
	readonly env: string;
	readonly key: string;
}> = [
	{ env: "PI_ZAI_USAGE_ENDPOINT", key: "zai" },
	{ env: "PI_ZAI_CODING_CN_USAGE_ENDPOINT", key: "zai-cn" },
	{ env: "PI_MINIMAX_USAGE_ENDPOINT", key: "minimax" },
	{ env: "PI_MINIMAX_CN_USAGE_ENDPOINT", key: "minimax-cn" },
	{ env: "PI_MINIMAX_LEGACY_USAGE_ENDPOINT", key: "minimax-legacy" },
	{ env: "PI_MINIMAX_CN_LEGACY_USAGE_ENDPOINT", key: "minimax-cn-legacy" },
];

export function resolveEndpointOverrides(
	env: Record<string, string | undefined> = process.env,
): Record<string, string> {
	const out: Record<string, string> = {};
	for (const { env: name, key } of ENDPOINT_ENV) {
		const value = env[name];
		if (value !== undefined && value !== "") {
			out[key] = value;
		}
	}
	return out;
}
