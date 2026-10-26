/**
 * renderStatus: the render seam (issue 011, seam 2). Pure ANSI string
 * building — zero IO, zero pi imports. Look grammar from
 * research/cs-style-spec.md §1-2; display semantics from issues 010
 * (wrapping), 013 (relay balance, error segments, announcements), 014
 * (stale marking).
 */
import type {
	Palette,
	PlanKind,
	QuotaWindow,
	UsageBarConfig,
	UsageSnapshot,
} from "../types";
import { auroraBar, classicBattery, ringMark } from "./bar";
import { BOLD, FAINT, fg, RESET, severityColor, UNFAINT } from "./theme";

/** Ink display name per plan; relay falls back to the provider id (e.g. "4sapi"). */
const PLAN_NAMES: Record<PlanKind, string> = {
	codex: "Codex",
	claude: "Claude",
	zai: "ZAI",
	"zai-cn": "ZAI CN",
	minimax: "MiniMax",
	"minimax-cn": "MiniMax CN",
	relay: "Relay",
};

const DIM_AFTER_MS = 3_600_000;

function displayName(snap: UsageSnapshot): string {
	return snap.plan === "relay" ? snap.provider : PLAN_NAMES[snap.plan];
}

/** Strip ANSI SGR sequences — the visible width of a string. */
function visibleWidth(s: string): number {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the ANSI marker we strip.
	return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

/**
 * ⏰ countdown (cs §2.1, adapted per issues 010/013): windows of >= 3.5 days
 * (or labeled with "d") render `3d04h` (d + zero-padded h, else bare `5h`);
 * shorter windows render `2h15m` (h + zero-padded m, else `37m`). Floors the
 * remaining time and is never negative. A missing resetsAt omits ⏰ entirely.
 */
export function formatCountdown(
	resetsAt: number,
	now: number,
	durationSeconds: number | null,
	label: string,
): string {
	const totalSeconds = Math.max(0, Math.floor((resetsAt - now) / 1000));
	const longWindow =
		(durationSeconds ?? 0) >= 86_400 * 3.5 || label.includes("d");
	if (longWindow) {
		const days = Math.floor(totalSeconds / 86_400);
		const hours = Math.floor((totalSeconds % 86_400) / 3600);
		return days > 0
			? `${days}d${String(hours).padStart(2, "0")}h`
			: `${hours}h`;
	}
	const totalMinutes = Math.floor(totalSeconds / 60);
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return hours > 0
		? `${hours}h${String(minutes).padStart(2, "0")}m`
		: `${minutes}m`;
}

/** Style separator, used between segments and between windows inside a segment. */
function separator(config: UsageBarConfig, palette: Palette): string {
	if (config.style === "classic") {
		return `${fg(palette.mute)} | ${RESET}`;
	}
	if (config.style === "ring") {
		const ringSep: Record<UsageBarConfig["density"], string> = {
			compact: "  ",
			regular: "   ",
			cozy: "    ",
		};
		return ringSep[config.density];
	}
	const pad: Record<UsageBarConfig["density"], string> = {
		compact: "",
		regular: " ",
		cozy: "  ",
	};
	const p = pad[config.density];
	return `${p}${fg(palette.edge)}│${RESET}${p}`;
}

/** Aurora window: `MUTE label · bar · bold severity pct · EDGE ⏰ MUTE countdown`. */
function auroraWindow(
	w: QuotaWindow,
	config: UsageBarConfig,
	palette: Palette,
	now: number,
): string {
	const sev = severityColor(
		palette,
		w.percent,
		config.warning_threshold,
		config.critical_threshold,
	);
	const glyph = config.bar_glyph === "thin" ? "━" : "■";
	let out = fg(palette.mute) + w.label + RESET;
	out += ` ${auroraBar(w.percent, config.bar_width, glyph, palette)}`;
	if (w.percent === null) {
		out += ` ${fg(palette.mute)}--%${RESET}`;
	} else {
		out += ` ${fg(sev ?? palette.ink)}${BOLD}${String(Math.round(w.percent)).padStart(2, " ")}%${RESET}`;
	}
	if (config.show_reset_countdown && w.resetsAt !== null) {
		out += ` ${fg(palette.edge)}⏰${fg(palette.mute)}${formatCountdown(w.resetsAt, now, w.durationSeconds, w.label)}${RESET}`;
	}
	return out;
}

/** Ring window: `sev glyph · bold ink pct · MUTE label [· resets countdown]`. */
function ringWindow(
	w: QuotaWindow,
	config: UsageBarConfig,
	palette: Palette,
	now: number,
): string {
	const sev = severityColor(
		palette,
		w.percent,
		config.warning_threshold,
		config.critical_threshold,
	);
	const pct =
		w.percent === null
			? `${fg(palette.mute)}--%${RESET}`
			: `${fg(palette.ink)}${BOLD}${Math.round(w.percent)}%${RESET}`;
	const reset =
		w.resetsAt === null || !config.show_reset_countdown
			? ""
			: ` · resets ${formatCountdown(w.resetsAt, now, w.durationSeconds, w.label)}`;
	return `${ringMark(w.percent, sev, palette)} ${pct} ${fg(palette.mute)}${w.label}${reset}${RESET}`;
}

/** Classic window: `sev label · mute [ · battery · mute ] · sev ⏰countdown`. */
function classicWindow(
	w: QuotaWindow,
	config: UsageBarConfig,
	palette: Palette,
	now: number,
): string {
	const sev = severityColor(
		palette,
		w.percent,
		config.warning_threshold,
		config.critical_threshold,
	);
	const color = sev ?? palette.mute;
	let out = fg(color) + w.label + RESET;
	out += `${fg(palette.mute)}[${RESET}${classicBattery(w.percent, sev, palette)}${fg(palette.mute)}]${RESET}`;
	if (config.show_reset_countdown && w.resetsAt !== null) {
		out += `${fg(color)}⏰${formatCountdown(w.resetsAt, now, w.durationSeconds, w.label)}${RESET}`;
	}
	return out;
}

function windowPart(
	w: QuotaWindow,
	config: UsageBarConfig,
	palette: Palette,
	now: number,
): string {
	switch (config.style) {
		case "ring":
			return ringWindow(w, config, palette, now);
		case "classic":
			return classicWindow(w, config, palette, now);
		default:
			return auroraWindow(w, config, palette, now);
	}
}

/** Balance text (issue 013): relay `bal $200.00`; credits `$12.50 credits`. */
function balancePart(
	snap: UsageSnapshot,
	config: UsageBarConfig,
	palette: Palette,
): string | null {
	const bal = snap.balance;
	if (bal === undefined || !config.show_balance) {
		return null;
	}
	if (bal.kind === "relay") {
		return `${fg(palette.ok)}bal ${config.currency}${bal.amount.toFixed(2)}${RESET}`;
	}
	return `${fg(palette.ok)}${config.currency}${bal.amount.toFixed(2)} credits${RESET}`;
}

/** ↻ official reset announcement appended to the codex segment (issues 012/013).
 *  The snapshot text is pre-formatted (chancePercent already inside it). */
function announcementPart(
	snap: UsageSnapshot,
	config: UsageBarConfig,
	palette: Palette,
): string | null {
	const ann = snap.announcement;
	if (ann === undefined || !config.show_resets) {
		return null;
	}
	return `${fg(palette.ink)}↻${RESET} ${fg(palette.mute)}${ann.text}${RESET}`;
}

/** Would this snapshot render anything (windows, balance, announcement, error)? */
function hasContent(snap: UsageSnapshot, config: UsageBarConfig): boolean {
	if (snap.status === "error") {
		// Relay with no billing endpoint hides silently (issue 013).
		return !(snap.error ?? "").startsWith("no billing endpoint");
	}
	if (snap.windows.length > 0) {
		return true;
	}
	if (snap.balance !== undefined && config.show_balance) {
		return true;
	}
	return snap.announcement !== undefined && config.show_resets;
}

/**
 * The plan kind the active provider maps to, taken from its own snapshot
 * when present (the snapshot may be hidden from `visible`, so search all).
 */
function activePlanFor(
	snapshots: UsageSnapshot[],
	activeProvider: string,
): PlanKind | null {
	return snapshots.find((s) => s.provider === activeProvider)?.plan ?? null;
}

/** Compact one-line item for a non-active plan: `Name 5h·17%/7d·3%`. */
function compactItem(
	snap: UsageSnapshot,
	config: UsageBarConfig,
	palette: Palette,
	now: number,
): string | null {
	if (snap.status === "error") {
		return null;
	}
	const bits: string[] = [];
	for (const w of snap.windows) {
		if (w.percent === null) continue;
		const sev = severityColor(
			palette,
			w.percent,
			config.warning_threshold,
			config.critical_threshold,
		);
		bits.push(
			`${fg(palette.mute)}${w.label}·${RESET}${fg(sev ?? palette.ink)}${Math.round(w.percent)}%${RESET}`,
		);
	}
	if (snap.balance !== undefined) {
		bits.push(
			`${fg(palette.ok)}${config.currency}${snap.balance.amount.toFixed(2)}${RESET}`,
		);
	}
	if (bits.length === 0) {
		return null;
	}
	let item = `${fg(palette.mute)}${displayName(snap)}${RESET} ${bits.join(" ")}`;
	if (now - snap.fetchedAt > config.refresh_minutes * 3 * 60_000) {
		item += ` ${fg(palette.mute)}⟳${RESET}`;
	}
	return item;
}

function renderSegment(
	snap: UsageSnapshot,
	config: UsageBarConfig,
	palette: Palette,
	now: number,
	multi: boolean,
	nameWidth: number,
): string | null {
	const parts: string[] = [];
	if (snap.status === "error") {
		const err =
			snap.error === undefined
				? "usage unavailable"
				: `usage unavailable (${snap.error})`;
		parts.push(fg(palette.warn) + err + RESET);
	} else {
		for (const w of snap.windows) {
			parts.push(windowPart(w, config, palette, now));
		}
		const bal = balancePart(snap, config, palette);
		if (bal !== null) {
			parts.push(bal);
		}
	}
	const ann = announcementPart(snap, config, palette);
	if (parts.length === 0 && ann === null) {
		return null;
	}
	const sep = separator(config, palette);
	let seg = parts.length > 0 ? parts.join(sep) : "";
	if (ann !== null) {
		seg += `${seg.length > 0 ? " " : ""}${ann}`;
	}
	// Stale marking (issue 014): ⟳ past 3× the refresh interval; the whole
	// segment is dimmed past one hour (⟳ included in the dim wrap).
	const age = now - snap.fetchedAt;
	if (age > config.refresh_minutes * 3 * 60_000) {
		seg += ` ${fg(palette.mute)}⟳${RESET}`;
	}
	if (multi || snap.status === "error") {
		// Equal-width names keep the bars vertically aligned across lines.
		const name = displayName(snap).padEnd(nameWidth, " ");
		seg = `${fg(palette.ink)}${name}${RESET} ${seg}`;
	}
	if (age > DIM_AFTER_MS) {
		seg = FAINT + seg + UNFAINT;
	}
	return seg;
}

/**
 * Render snapshots to ANSI status lines. One provider per segment; segments
 * (and windows within a segment) are joined by the style's density separator.
 * A single provider gets no name prefix (cs behavior); multiple providers each
 * get an ink display-name prefix, and error segments are always named.
 * When the joined line's visible width exceeds `width`, lines break at provider
 * boundaries (segments stay whole; an overwide segment overflows its own line).
 */
export function renderStatus(
	snapshots: UsageSnapshot[],
	config: UsageBarConfig,
	width: number,
	palette: Palette,
	now: number,
	activeProvider?: string,
): string[] {
	if (snapshots.length === 0) {
		return [];
	}
	const visible = snapshots.filter((s) => hasContent(s, config));
	if (visible.length === 0) {
		return [];
	}
	const multi = visible.length > 1;

	// Compact mode: the active provider renders full, everyone else collapses
	// onto one summary line ({name} {p}%·{p}% / {name} $bal).
	if (
		multi &&
		config.display.compact_others &&
		activeProvider !== undefined &&
		activeProvider !== ""
	) {
		const activePlan = activePlanFor(snapshots, activeProvider);
		const active =
			visible.find((s) => s.provider === activeProvider) ??
			(activePlan === null
				? undefined
				: visible.find((s) => s.plan === activePlan)) ??
			visible[0];
		if (!active) {
			return [];
		}
		const rest = visible.filter((s) => s !== active);
		const activeSeg = renderSegment(active, config, palette, now, false, 0);
		const items = rest.map((s) => compactItem(s, config, palette, now));
		const lines: string[] = [];
		if (activeSeg !== null) {
			lines.push(activeSeg);
		}
		const summary = items
			.filter((i) => i !== null)
			.join(`${fg(palette.edge)} │ ${RESET}`);
		if (summary !== "") {
			lines.push(summary);
		}
		if (lines.length > 0) {
			return lines;
		}
	}
	const nameWidth = multi
		? Math.max(...visible.map((s) => displayName(s).length))
		: 0;
	const segments: string[] = [];
	for (const snap of visible) {
		const seg = renderSegment(snap, config, palette, now, multi, nameWidth);
		if (seg !== null) {
			segments.push(seg);
		}
	}
	const sep = separator(config, palette);
	const line = segments.join(sep);
	if (visibleWidth(line) <= width) {
		return [line];
	}
	const lines: string[] = [];
	let current = "";
	for (const seg of segments) {
		if (current === "") {
			current = seg;
		} else if (
			visibleWidth(current) + visibleWidth(sep) + visibleWidth(seg) <=
			width
		) {
			current += sep + seg;
		} else {
			lines.push(current);
			current = seg;
		}
	}
	if (current !== "") {
		lines.push(current);
	}
	return lines;
}
