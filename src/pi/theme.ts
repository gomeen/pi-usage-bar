/**
 * Maps the active pi theme to a render Palette (config theme: "pi").
 * This is the only place that translates pi theme tokens into RGB — the
 * render seam stays pi-free.
 */
import type { Palette, RGB } from "../types.js";

type PiTheme = {
	colors: Record<string, unknown>;
	appearance?: "dark" | "light";
};

function readColor(theme: PiTheme, ...keys: string[]): RGB | null {
	for (const key of keys) {
		const value = theme.colors[key];
		if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) {
			return [
				Number.parseInt(value.slice(1, 3), 16),
				Number.parseInt(value.slice(3, 5), 16),
				Number.parseInt(value.slice(5, 7), 16),
			] as RGB;
		}
		if (
			Array.isArray(value) &&
			value.length === 3 &&
			value.every((n) => typeof n === "number")
		) {
			return [value[0], value[1], value[2]] as RGB;
			if (
				value &&
				typeof value === "object" &&
				typeof (value as { r?: unknown }).r === "number" &&
				typeof (value as { g?: unknown }).g === "number" &&
				typeof (value as { b?: unknown }).b === "number"
			) {
				const c = value as { r: number; g: number; b: number };
				return [c.r, c.g, c.b] as RGB;
			}
		}
	}
	return null;
}

/** Graphite fallback values per slot (research/cs-style-spec.md §3.1). */
const GRAPHITE: Palette = {
	ink: [218, 221, 225],
	mute: [120, 125, 132],
	edge: [75, 80, 88],
	ok: [78, 200, 91],
	warn: [232, 178, 96],
	hot: [232, 116, 116],
	wt: [168, 152, 226],
};

/**
 * Build a palette from a pi theme; falls back to graphite per-slot when a
 * token is missing or not a concrete color (pi themes may use terminal
 * defaults that report as non-hex).
 */
export function paletteFromPiTheme(theme: PiTheme): Palette {
	const pick = (fallback: RGB, ...keys: string[]): RGB =>
		readColor(theme, ...keys) ?? fallback;
	return {
		ink: pick(GRAPHITE.ink, "foreground", "text", "mainText"),
		mute: pick(GRAPHITE.mute, "mutedText", "secondaryText", "dim"),
		edge: pick(GRAPHITE.edge, "border", "toolPendingBg", "inputBorder"),
		ok: pick(GRAPHITE.ok, "success", "toolSuccessFg"),
		warn: pick(GRAPHITE.warn, "warning", "toolWarningFg"),
		hot: pick(GRAPHITE.hot, "error", "danger", "toolErrorFg"),
		wt: pick(GRAPHITE.wt, "accent", "userMessageFg"),
	};
}

export { GRAPHITE as graphitePalette };
