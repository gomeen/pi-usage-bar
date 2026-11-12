/**
 * Editor chrome layout (prototype D3, prototype/footer-merged-line.html).
 *
 * The input editor's top border carries a right-aligned legend chip
 * (`branch · ctx%`), and the current model label rides the usage bar's
 * first row, flush right. The stats row and the project path are gone by
 * decision of the prototype review.
 *
 * Pure ANSI string building — zero IO, zero pi imports (render seam, issue
 * 011 seam 2). The pi seam (src/pi/editor-chip.ts) feeds live data in and
 * paints the border dashes with pi's own border color.
 */
import type { Palette } from "../types.js";
import { fg, RESET } from "./theme.js";

/**
 * Strip ANSI SGR sequences and count UTF-16 units — an APPROXIMATION of
 * terminal width. Emoji (e.g. the ⏰ countdown marker, rendered 2 columns
 * wide) and CJK are undercounted, so seam callers must inject the host's
 * width function (pi seam passes pi-tui's grapheme-aware visibleWidth).
 */
export function visibleWidth(s: string): number {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the ANSI marker we strip.
	return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/** Terminal-width function injected by the host seam. */
export type WidthOf = (s: string) => number;

export interface ModelInfo {
	id: string;
	/** Current thinking level (pi ctx.thinkingLevel). Absent → "off". */
	thinkingLevel?: string | undefined;
	/** Whether the model supports reasoning at all (pi model.reasoning). */
	reasoning?: boolean | undefined;
}

/** Full model label, mirroring pi's built-in footer right side. */
export function modelLabel(model: ModelInfo): string {
	if (model.reasoning !== true) return model.id;
	const level = model.thinkingLevel ?? "off";
	return level === "off"
		? `${model.id} • thinking off`
		: `${model.id} • ${level}`;
}

export interface ChipSource {
	/** Git branch short name; null = unavailable (omit). */
	branch: string | null;
	/** Context usage percent 0..100; null = unknown (omit). */
	percent: number | null;
}

/** Percent color: pi footer parity — plain ≤70, warn >70, hot >90. */
function pctColor(palette: Palette, percent: number): string {
	if (percent > 90) return fg(palette.hot);
	if (percent > 70) return fg(palette.warn);
	return fg(palette.mute);
}

function joinChip(parts: (string | null)[], palette: Palette): string | null {
	const kept = parts.filter((p): p is string => p !== null);
	if (kept.length === 0) return null;
	return kept.join(`${fg(palette.edge)} · ${RESET}`);
}

/** Legend chip `branch · 60.8%` as one ANSI string; null when nothing to show. */
export function chipText(src: ChipSource, palette: Palette): string | null {
	return joinChip(
		[
			src.branch === null ? null : `${fg(palette.mute)}${src.branch}${RESET}`,
			src.percent === null
				? null
				: `${pctColor(palette, src.percent)}${src.percent.toFixed(1)}%${RESET}`,
		],
		palette,
	);
}

export interface ChromeLayoutInput {
	/** The rendered usage row that owns the model (first row). */
	line1: string;
	width: number;
	model: ModelInfo | null;
	chip: ChipSource;
	palette: Palette;
	/** Width function; defaults to the ASCII approximation above. The caller
	 * must pass one that agrees with how the row will actually be rendered
	 * (emoji/CJK wide), or the right-aligned label overflows the row. */
	widthOf?: WidthOf;
}

export interface ChromeLayout {
	/** Text to right-align onto line1, or null when the row is empty or tight. */
	modelRight: string | null;
	/** Legend chip for the editor top border, or null (plain border). */
	chip: string | null;
	/** What got dropped or demoted, for diagnostics. */
	dropped: string[];
}

/** Space around the chip (2+2) plus the short right dash run (4). */
const CHIP_OVERHEAD = 8;

/**
 * D3 layout: the model rides line1's right edge when it fits (full label
 * first, bare id as fallback). When there is no usage row, the caller can
 * render the model against an empty left side; when a populated row is too
 * full, the model is omitted. It never merges into the branch/context chip,
 * so the context percentage remains in its own location.
 */
export function layoutChrome(input: ChromeLayoutInput): ChromeLayout {
	const widthOf = input.widthOf ?? visibleWidth;
	const dropped: string[] = [];
	const w1 = widthOf(input.line1);
	const full = input.model === null ? null : modelLabel(input.model);
	const short = input.model?.id ?? null;

	let modelRight: string | null = null;
	if (input.model !== null) {
		if (w1 + 2 + widthOf(full as string) <= input.width) {
			modelRight = full;
		} else if (w1 + 2 + widthOf(short as string) <= input.width) {
			modelRight = short;
			dropped.push("thinking level");
		} else {
			dropped.push("model row 1 → omitted");
		}
	}

	// The context chip is independent from model placement. It always sheds
	// branch first, then percent, as the available border width decreases.
	const pctPart =
		input.chip.percent === null
			? null
			: `${pctColor(input.palette, input.chip.percent)}${input.chip.percent.toFixed(1)}%${RESET}`;
	const branchPart =
		input.chip.branch === null
			? null
			: `${fg(input.palette.mute)}${input.chip.branch}${RESET}`;
	// Each drop label names what is lost when THIS candidate is skipped for
	// the next, narrower one ("branch · context percent" etc. chains down).
	const candidates: { text: string | null; drop: string }[] = [
		{
			text: joinChip([branchPart, pctPart], input.palette),
			drop: "branch",
		},
		{
			text: joinChip([pctPart], input.palette),
			drop: "context percent",
		},
		{
			text: joinChip([], input.palette),
			drop: "",
		},
	];

	let chip: string | null = null;
	const shed: string[] = [];
	for (const candidate of candidates) {
		if (
			candidate.text !== null &&
			widthOf(candidate.text) + CHIP_OVERHEAD <= input.width
		) {
			chip = candidate.text;
			break;
		}
		if (candidate.drop !== "") shed.push(candidate.drop);
	}
	dropped.push(...shed);

	return { modelRight, chip, dropped };
}

/**
 * Right-align `right` onto `line` at `width` (flush to the edge). When tight,
 * `right` degrades to its bare text truncated with an ellipsis (color lost —
 * the ladder in `layoutChrome` normally prevents this path); when there is no
 * room at all, `line` comes back unchanged.
 */
export function appendRight(
	line: string,
	right: string | null,
	width: number,
	widthOf: WidthOf = visibleWidth,
): string {
	if (right === null) return line;
	const w1 = widthOf(line);
	const wR = widthOf(right);
	const gap = width - w1 - wR;
	if (gap >= 2) return `${line}${" ".repeat(gap)}${right}`;
	const avail = width - w1 - 2;
	if (avail < 1) return line;
	const cut =
		wR <= avail
			? right
			: `${truncateToVisibleUnits(right, avail - 1, widthOf)}…`;
	return `${line}${" ".repeat(Math.max(2, width - w1 - widthOf(cut)))}${cut}`;
}

/** Cut the visible units of `right` down to at most `max` (measured with widthOf). */
function truncateToVisibleUnits(
	right: string,
	max: number,
	widthOf: WidthOf,
): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the ANSI marker we strip.
	const plain = right.replace(/\x1b\[[0-9;]*m/g, "");
	let cut = "";
	for (const ch of plain) {
		if (widthOf(cut + ch) > max) break;
		cut += ch;
	}
	return cut;
}
