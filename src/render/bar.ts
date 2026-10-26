/**
 * Bar primitives: aurora block/thin bar, ring glyph, classic battery.
 * Ported from research/cs-style-spec.md §1 (cs/styles.py, cxs/styles.py,
 * cs/progress.py). Pure functions only.
 */
import type { Palette, RGB } from "../types";
import { bg, blend, fg, PILL_INK, RESET } from "./theme";

/** Cell color is fixed by position: ok→warn over the first half of the bar,
 *  warn→hot over the second half, regardless of current usage (cs/styles.py:244-249). */
function cellColor(i: number, width: number, palette: Palette): RGB {
	const t = width > 1 ? i / (width - 1) : 0;
	return t < 0.5
		? blend(palette.ok, palette.warn, t * 2)
		: blend(palette.warn, palette.hot, (t - 0.5) * 2);
}

/**
 * Aurora bar: `width` cells of `glyph`; filled = round-half-up(p/100*width),
 * at least 1 cell when p > 0; null percent → all cells in edge color.
 */
export function auroraBar(
	percent: number | null,
	width: number,
	glyph: "■" | "━",
	palette: Palette,
): string {
	if (percent === null) {
		return fg(palette.edge) + glyph.repeat(width) + RESET;
	}
	const clamped = Math.max(0, Math.min(100, percent));
	let filled = Math.trunc((clamped / 100) * width + 0.5);
	if (percent > 0 && filled === 0) {
		filled = 1;
	}
	let out = "";
	for (let i = 0; i < filled; i++) {
		out += fg(cellColor(i, width, palette)) + glyph;
	}
	if (filled < width) {
		out += fg(palette.edge) + glyph.repeat(width - filled);
	}
	return out + RESET;
}

const RING_GLYPHS = ["○", "◔", "◑", "◕", "●"] as const;

/** Ring fill glyph: idx = round-half-up(p/25), forced to >= 1 when p > 0;
 *  null percent → "○" (cxs/styles.py:259-268). */
export function ringGlyph(percent: number | null): string {
	if (percent === null) {
		return "○";
	}
	const clamped = Math.max(0, Math.min(100, percent));
	let idx = Math.trunc(clamped / 25 + 0.5);
	if (clamped > 0 && idx === 0) {
		idx = 1;
	}
	return RING_GLYPHS[idx] ?? "○";
}

/** Colored ring mark: severity color when the percent is known, edge otherwise. */
export function ringMark(
	percent: number | null,
	sev: RGB | null,
	palette: Palette,
): string {
	const color = percent === null || sev === null ? palette.edge : sev;
	return fg(color) + ringGlyph(percent) + RESET;
}

/**
 * Classic battery: fixed 10 cells, `{pct}%` (or "MAX" above 100) centered over
 * the cells, filled cells fade the severity color toward black
 * (`t = i/(filled-1)`, darkened 35%), empty cells bg edge, fg pill_ink
 * (cs/progress.py:231-276). Null percent → empty battery with "--" centered.
 */
export function classicBattery(
	percent: number | null,
	sev: RGB | null,
	palette: Palette,
): string {
	const width = 10;
	const text =
		percent === null ? "--" : percent > 100 ? "MAX" : `${Math.round(percent)}%`;
	const left = Math.max(0, Math.floor((width - text.length) / 2));
	const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
	let filled = Math.trunc((clamped / 100) * width + 0.5);
	if (percent !== null && percent > 0 && filled === 0) {
		filled = 1;
	}
	const fill = sev ?? palette.ok;
	const dark = blend(fill, [0, 0, 0], 0.35);
	const pill = fg(PILL_INK);
	let out = "";
	for (let i = 0; i < filled; i++) {
		const ch =
			i >= left && i < left + text.length ? text.charAt(i - left) : " ";
		out +=
			bg(blend(fill, dark, filled > 1 ? i / (filled - 1) : 0)) +
			pill +
			ch +
			RESET;
	}
	if (filled < width) {
		let rest = "";
		for (let i = filled; i < width; i++) {
			rest += i >= left && i < left + text.length ? text.charAt(i - left) : " ";
		}
		out += bg(palette.edge) + pill + rest + RESET;
	}
	return out;
}
