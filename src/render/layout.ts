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

/** Base display name per plan; relay falls back to the provider id (e.g. "4sapi"). */
const PLAN_NAMES: Record<PlanKind, string> = {
	codex: "Codex",
	claude: "Claude",
	zai: "ZAI",
	"zai-cn": "ZAI",
	minimax: "MiniMax",
	"minimax-cn": "MiniMax",
	relay: "Relay",
};

const DIM_AFTER_MS = 3_600_000;

/** Short relay label only; provider identity and request URLs stay untouched. */
function relayDisplayName(provider: string): string {
	try {
		const host = new URL(
			provider.includes("://") ? provider : `https://${provider}`,
		).hostname.replace(/\.$/, "");
		if (!host.includes(".") || /^[\d.]+$/.test(host)) return provider;
		const labels = host.split(".");
		const suffix = labels.at(-1) ?? "";
		const second = labels.at(-2) ?? "";
		const compound =
			suffix.length === 2 &&
			["co", "com", "net", "org", "gov", "edu", "ac"].includes(second);
		return labels.at(compound ? -3 : -2) ?? provider;
	} catch {
		return provider;
	}
}

/** Regional suffixes distinguish twins only when both are present. */
function displayName(snap: UsageSnapshot, present: Set<PlanKind>): string {
	if (snap.plan === "relay") {
		return relayDisplayName(snap.provider);
	}
	const base = PLAN_NAMES[snap.plan];
	const isCn = snap.plan === "zai-cn" || snap.plan === "minimax-cn";
	if (!isCn) {
		return base;
	}
	const twin = snap.plan === "zai-cn" ? "zai" : "minimax";
	return present.has(twin) ? `${base} CN` : base;
}

/** Coarse countdown for compact rows: largest unit only ("5d", "2h", "37m"). */
function coarseCountdown(resetsAt: number, now: number): string {
	const total = Math.max(0, resetsAt - now);
	const m = Math.floor(total / 60_000);
	const h = Math.floor(m / 60);
	const d = Math.floor(h / 24);
	return d > 0 ? `${d}d` : h > 0 ? `${h}h` : `${m}m`;
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

/** Balance text (issue 013): relay `$200.00`; credits `$12.50 credits`. */
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
		return `${fg(palette.ok)}${config.currency}${bal.amount.toFixed(2)}${RESET}`;
	}
	return `${fg(palette.ok)}${config.currency}${bal.amount.toFixed(2)} credits${RESET}`;
}

/** ↻ next-reset announcement (issues 012/013). The text is pre-formatted. */
function announcementPart(text: string, palette: Palette): string {
	return `${fg(palette.ink)}↻${RESET} ${fg(palette.mute)}${text}${RESET}`;
}

/**
 * The announcement belongs to the Codex plan, but it answers a question about
 * the next reset — so it must not disappear when Codex is not the segment
 * that happens to be drawn: it rides the Codex segment on whichever line that
 * lands (first or second), and stands alone when Codex has no segment at all.
 *
 * Resolution and placement agree on one owner: the Codex snapshot. Anything
 * else carrying an announcement would be a bug, not a second source.
 */
interface AnnouncementWording {
	/** Full wording: "Reset announced · in 1h10m". */
	full: string;
	/**
	 * Compact wording for a secondary row: "in 1h10m". A forecast has no
	 * compact form — it keeps the full wording on every row.
	 */
	short: string;
}

function announcementWording(
	snapshots: readonly UsageSnapshot[],
	config: UsageBarConfig,
): AnnouncementWording | null {
	if (!config.show_resets) {
		return null;
	}
	const ann = snapshots.find((s) => s.plan === "codex")?.announcement;
	if (ann === undefined) {
		return null;
	}
	return { full: ann.text, short: ann.shortText ?? ann.text };
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

/** Compact one-line item for a non-active plan: `Name 5h·17%/7d·3%`. */
function compactItem(
	snap: UsageSnapshot,
	config: UsageBarConfig,
	palette: Palette,
	now: number,
	present: Set<PlanKind>,
	announcement: string | null = null,
): string | null {
	if (snap.status === "error") {
		// Never vanish silently: a failing plan stays visible as a warning
		// marker (last-good is normally served by the facade before this).
		return `${fg(palette.mute)}${displayName(snap, present)}${RESET} ${fg(palette.warn)}⚠${RESET}`;
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
		let bit = `${fg(palette.mute)}${w.label}·${RESET}${fg(sev ?? palette.ink)}${Math.round(w.percent)}%${RESET}`;
		if (config.show_reset_countdown && w.resetsAt !== null) {
			bit += `${fg(palette.mute)}·${coarseCountdown(w.resetsAt, now)}${RESET}`;
		}
		bits.push(bit);
	}
	if (snap.balance !== undefined && config.show_balance) {
		bits.push(
			`${fg(palette.ok)}${config.currency}${snap.balance.amount.toFixed(2)}${RESET}`,
		);
	}
	if (bits.length === 0 && announcement === null) {
		return null;
	}
	let item = `${fg(palette.mute)}${displayName(snap, present)}${RESET}`;
	if (bits.length > 0) {
		item += ` ${bits.join(" ")}`;
	}
	// The announcement stays with its plan even in the compact summary line —
	// dropping it here is what made the next reset invisible on line two.
	if (announcement !== null) {
		item += ` ${announcementPart(announcement, palette)}`;
	}
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
	present: Set<PlanKind>,
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
	if (parts.length === 0) {
		return null;
	}
	const sep = separator(config, palette);
	let seg = parts.join(sep);
	// Stale marking (issue 014): ⟳ past 3× the refresh interval; the whole
	// segment is dimmed past one hour (⟳ included in the dim wrap).
	const age = now - snap.fetchedAt;
	if (age > config.refresh_minutes * 3 * 60_000) {
		seg += ` ${fg(palette.mute)}⟳${RESET}`;
	}
	if (multi || snap.status === "error") {
		// Equal-width names keep the bars vertically aligned across lines.
		const name = displayName(snap, present).padEnd(nameWidth, " ");
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
	active?: { provider: string; plan: PlanKind | null },
): string[] {
	if (snapshots.length === 0) {
		return [];
	}
	const currentSnapshot =
		snapshots.find((s) => s.provider === active?.provider) ??
		(active?.plan
			? snapshots.find((s) => s.plan === active.plan)
			: undefined) ??
		snapshots[0];
	const selected =
		config.display.mode === "active"
			? snapshots.filter((s) => s === currentSnapshot)
			: snapshots.filter(
					(s) =>
						s.plan === "relay" ||
						config.display.providers.length === 0 ||
						config.display.providers.includes(s.plan),
				);
	const visible = selected.filter((s) => hasContent(s, config));
	if (visible.length === 0) {
		return [];
	}
	const multi = visible.length > 1;
	// One announcement for the whole bar: the next Codex reset, whenever the
	// Codex segment itself is drawn (first line, second line, or compact
	// summary line). The full wording belongs on the first row; a secondary
	// row gets the compact wording so it does not eat the row's width.
	const announcement = announcementWording(visible, config);

	// Compact mode: the active provider renders full, everyone else collapses
	// onto one summary line ({name} {p}%·{p}% / {name} $bal).
	if (
		multi &&
		config.display.compact_others &&
		active !== undefined &&
		active.provider !== ""
	) {
		const activeSnap =
			visible.find((s) => s.provider === active.provider) ??
			(active.plan === null
				? undefined
				: visible.find((s) => s.plan === active.plan)) ??
			visible[0];
		if (!activeSnap) {
			return [];
		}
		const rest = visible.filter((s) => s !== activeSnap);
		const present = new Set(visible.map((s) => s.plan));
		// The active line carries its name too — an anonymous bar row reads
		// as "not the current plan" even though it is. No column padding:
		// it is the only full row, so name + single space matches the
		// compact line's rhythm instead of aligning to the longest name.
		const activeSeg = renderSegment(
			activeSnap,
			config,
			palette,
			now,
			true,
			0,
			present,
		);
		// The announcement belongs to the Codex plan: it rides the active row
		// when Codex is active (row one → full wording), otherwise the Codex
		// item of the summary line (row two → compact wording).
		const items = rest.map((s) =>
			compactItem(
				s,
				config,
				palette,
				now,
				present,
				s.plan === "codex" ? (announcement?.short ?? null) : null,
			),
		);
		const lines: string[] = [];
		const activeLine =
			activeSeg === null
				? null
				: activeSnap.plan === "codex" && announcement !== null
					? `${activeSeg} ${announcementPart(announcement.full, palette)}`
					: activeSeg;
		if (activeLine !== null) {
			lines.push(activeLine);
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
	const present = new Set(visible.map((s) => s.plan));
	const nameWidth = multi
		? Math.max(...visible.map((s) => displayName(s, present).length))
		: 0;
	const base: { snap: UsageSnapshot; text: string }[] = [];
	for (const snap of visible) {
		const seg = renderSegment(
			snap,
			config,
			palette,
			now,
			multi,
			nameWidth,
			present,
		);
		if (seg !== null) {
			base.push({ snap, text: seg });
		}
	}
	const sep = separator(config, palette);
	const codexIndex = base.findIndex((b) => b.snap.plan === "codex");

	// Attach the announcement to the Codex segment (it rides whichever row
	// that segment lands on); when Codex has no segment of its own the
	// announcement stands alone rather than vanishing with it.
	const layoutWith = (text: string | null) => {
		const segs = base.map((b, i) => {
			if (text === null || i !== codexIndex) {
				return b.text;
			}
			// A stale segment is dimmed as a whole (issue 014); the
			// announcement rides along inside that dim, not outside it.
			const part = announcementPart(text, palette);
			const dimmed =
				now - b.snap.fetchedAt > DIM_AFTER_MS ? FAINT + part + UNFAINT : part;
			return `${b.text} ${dimmed}`;
		});
		if (text !== null && codexIndex === -1) {
			segs.push(announcementPart(text, palette));
		}
		return wrapSegments(segs, sep, width);
	};

	if (announcement === null) {
		return layoutWith(null).lines;
	}
	// The announcement's own width can push Codex onto a later row, so the
	// wording is chosen from the layout it actually produces:
	//   • Codex on the first row → full wording;
	//   • Codex on a later row   → compact wording;
	//   • the announcement stands alone (no Codex segment) → always full,
	//     because a lone "↻ in 1h10m" without its label says nothing.
	// When the full wording does not fit the first row, the compact wording
	// wins over moving Codex down a row — the segment keeps its place.
	const withFull = layoutWith(announcement.full);
	const announcementIndex = codexIndex === -1 ? base.length : codexIndex;
	const row = withFull.groups.findIndex((g) => g.includes(announcementIndex));
	if (codexIndex === -1) {
		return withFull.lines;
	}
	if (row <= 0) {
		return withFull.lines;
	}
	return layoutWith(announcement.short).lines;
}

/**
 * Pack segments into rows, breaking at provider boundaries. `groups` maps
 * each row to the segment indices it holds, so the caller can tell which row
 * a given segment ended up on.
 */
function wrapSegments(
	segments: string[],
	sep: string,
	width: number,
): { lines: string[]; groups: number[][] } {
	const lines: string[] = [];
	const groups: number[][] = [];
	let current = "";
	let currentGroup: number[] = [];
	segments.forEach((seg, index) => {
		if (current === "") {
			current = seg;
			currentGroup = [index];
			return;
		}
		if (
			visibleWidth(current) + visibleWidth(sep) + visibleWidth(seg) <=
			width
		) {
			current += sep + seg;
			currentGroup.push(index);
			return;
		}
		lines.push(current);
		groups.push(currentGroup);
		current = seg;
		currentGroup = [index];
	});
	if (current !== "") {
		lines.push(current);
		groups.push(currentGroup);
	}
	return { lines, groups };
}
