/**
 * Graphite palette, color math, and ANSI helpers for the render seam.
 * Ported from research/cs-style-spec.md §3 (cs/themes.py, cs/progress.py).
 * Pure functions only — no IO, no pi imports.
 */
import type { Palette, RGB } from "../types";

/** The built-in graphite theme (cs/themes.py:46-56). */
export const GRAPHITE: Palette = {
	ink: [218, 221, 225],
	mute: [120, 125, 132],
	edge: [75, 80, 88],
	ok: [78, 200, 91],
	warn: [232, 178, 96],
	hot: [232, 116, 116],
	wt: [168, 152, 226],
};

/** Text color inside classic battery cells (cs `pill_ink`). */
export const PILL_INK: RGB = [238, 235, 224];

export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
/** Faint (dim) SGR pair, used to dim stale segments (issue 014). */
export const FAINT = "\x1b[2m";
export const UNFAINT = "\x1b[22m";

/** Truecolor foreground `\033[38;2;r;g;bm` (cs/styles.py:74). */
export function fg(rgb: RGB): string {
	return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

/** Truecolor background `\033[48;2;r;g;bm` (cs/progress.py:65). */
export function bg(rgb: RGB): string {
	return `\x1b[48;2;${rgb[0]};${rgb[1]};${rgb[2]}m`;
}

/**
 * Component-wise linear blend, truncating per channel:
 * `int(a[i] + (b[i]-a[i])*t)` (cs/progress.py:60-63).
 */
export function blend(a: RGB, b: RGB, t: number): RGB {
	const mix = (x: number, y: number): number => Math.trunc(x + (y - x) * t);
	return [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])];
}

/**
 * Parse a hex color override: `#rrggbb`, `#rgb`, or the bare forms.
 * Returns null for anything else (cs parse_hex_color; empty string = no override).
 */
export function parseHex(value: string): RGB | null {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
	const h = m?.[1];
	if (!h) {
		return null;
	}
	if (h.length === 3) {
		return [
			Number.parseInt(h.charAt(0) + h.charAt(0), 16),
			Number.parseInt(h.charAt(1) + h.charAt(1), 16),
			Number.parseInt(h.charAt(2) + h.charAt(2), 16),
		];
	}
	return [
		Number.parseInt(h.slice(0, 2), 16),
		Number.parseInt(h.slice(2, 4), 16),
		Number.parseInt(h.slice(4, 6), 16),
	];
}

/**
 * Apply the color_ok/color_warn/color_hot overrides onto a palette.
 * Invalid or empty strings keep the original slot; never mutates the input.
 */
export function applyColorOverrides(
	palette: Palette,
	ok: string,
	warn: string,
	hot: string,
): Palette {
	return {
		...palette,
		ok: parseHex(ok) ?? palette.ok,
		warn: parseHex(warn) ?? palette.warn,
		hot: parseHex(hot) ?? palette.hot,
	};
}

/**
 * Severity ladder (cs §3.3): percent >= critical → hot, >= warning → warn,
 * else ok; null percent (unknown) → null.
 */
export function severityColor(
	palette: Palette,
	percent: number | null,
	warningThreshold: number,
	criticalThreshold: number,
): RGB | null {
	if (percent === null) {
		return null;
	}
	if (percent >= criticalThreshold) {
		return palette.hot;
	}
	if (percent >= warningThreshold) {
		return palette.warn;
	}
	return palette.ok;
}
