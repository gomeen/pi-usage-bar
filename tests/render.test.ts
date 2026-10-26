/**
 * Golden ANSI tests for the render seam. Baseline strings come from the
 * worked examples in research/cs-style-spec.md §6; display semantics from
 * issues 010/013/014. Several tests hardcode the full literal ANSI string to
 * lock the wire format.
 */
import { describe, expect, it } from "vitest";
import { auroraBar, classicBattery, ringGlyph } from "../src/render/bar";
import { formatCountdown, renderStatus } from "../src/render/layout";
import {
	applyColorOverrides,
	BOLD,
	blend,
	fg,
	GRAPHITE,
	parseHex,
	RESET,
	severityColor,
} from "../src/render/theme";
import {
	DEFAULT_CONFIG,
	type QuotaWindow,
	type UsageBarConfig,
	type UsageSnapshot,
} from "../src/types";

const NOW = 1_700_000_000_000;
const TWO_H_15M_MS = 2 * 3_600_000 + 15 * 60_000;
const THREE_D_04H_MS = 3 * 86_400_000 + 4 * 3_600_000;

function cfg(): UsageBarConfig {
	return { ...DEFAULT_CONFIG, show_reset_countdown: true };
}

function snap(): UsageSnapshot {
	return {
		provider: "openai",
		plan: "codex",
		windows: [],
		status: "ok",
		fetchedAt: NOW,
	};
}

function win(
	label: string,
	percent: number | null,
	resetsAt: number | null,
	durationSeconds: number | null = null,
): QuotaWindow {
	return { label, percent, resetsAt, durationSeconds };
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ESC is the ANSI marker we strip.
const strip = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, "");

/** The cs worked example data: 5h=42% reset 2h15m, 7d=83% reset 3d04h. */
function workedWindows(): QuotaWindow[] {
	return [
		win("5h", 42, NOW + TWO_H_15M_MS, 18_000),
		win("7d", 83, NOW + THREE_D_04H_MS, 604_800),
	];
}

// ---------------------------------------------------------------------------
// Hardcoded golden literals (research/cs-style-spec.md §6.1, §6.3, §6.4).
// ---------------------------------------------------------------------------

const BAR_42 =
	"\x1b[38;2;78;200;91m■" +
	"\x1b[38;2;106;196;91m■" +
	"\x1b[38;2;134;192;92m■" +
	"\x1b[38;2;162;188;93m■" +
	"\x1b[38;2;190;184;94m■" +
	"\x1b[38;2;75;80;88m■■■■■■■" +
	"\x1b[0m";

const BAR_83 =
	"\x1b[38;2;78;200;91m■" +
	"\x1b[38;2;106;196;91m■" +
	"\x1b[38;2;134;192;92m■" +
	"\x1b[38;2;162;188;93m■" +
	"\x1b[38;2;190;184;94m■" +
	"\x1b[38;2;218;180;95m■" +
	"\x1b[38;2;232;172;97m■" +
	"\x1b[38;2;232;161;101m■" +
	"\x1b[38;2;232;149;105m■" +
	"\x1b[38;2;232;138;108m■" +
	"\x1b[38;2;75;80;88m■■" +
	"\x1b[0m";

const AURORA_GOLDEN =
	"\x1b[38;2;120;125;132m5h\x1b[0m " +
	BAR_42 +
	" " +
	"\x1b[38;2;232;178;96m\x1b[1m42%\x1b[0m " +
	"\x1b[38;2;75;80;88m⏰\x1b[38;2;120;125;132m2h15m\x1b[0m" +
	" \x1b[38;2;75;80;88m│\x1b[0m " +
	"\x1b[38;2;120;125;132m7d\x1b[0m " +
	BAR_83 +
	" " +
	"\x1b[38;2;232;116;116m\x1b[1m83%\x1b[0m " +
	"\x1b[38;2;75;80;88m⏰\x1b[38;2;120;125;132m3d04h\x1b[0m";

const RING_GOLDEN =
	"\x1b[38;2;232;178;96m◑\x1b[0m " +
	"\x1b[38;2;218;221;225m\x1b[1m42%\x1b[0m " +
	"\x1b[38;2;120;125;132m5h · resets 2h15m\x1b[0m" +
	"   " +
	"\x1b[38;2;232;116;116m◕\x1b[0m " +
	"\x1b[38;2;218;221;225m\x1b[1m83%\x1b[0m " +
	"\x1b[38;2;120;125;132m7d · resets 3d04h\x1b[0m";

const PILL = "\x1b[38;2;238;235;224m";

const BATTERY_42 =
	`\x1b[48;2;232;178;96m${PILL} \x1b[0m` +
	`\x1b[48;2;204;157;84m${PILL} \x1b[0m` +
	`\x1b[48;2;177;136;73m${PILL} \x1b[0m` +
	`\x1b[48;2;150;115;62m${PILL}4\x1b[0m` +
	`\x1b[48;2;75;80;88m${PILL}2%    \x1b[0m`;

const BATTERY_83 =
	`\x1b[48;2;232;116;116m${PILL} \x1b[0m` +
	`\x1b[48;2;220;110;110m${PILL} \x1b[0m` +
	`\x1b[48;2;208;104;104m${PILL} \x1b[0m` +
	`\x1b[48;2;196;98;98m${PILL}8\x1b[0m` +
	`\x1b[48;2;185;92;92m${PILL}3\x1b[0m` +
	`\x1b[48;2;173;86;86m${PILL}%\x1b[0m` +
	`\x1b[48;2;161;80;80m${PILL} \x1b[0m` +
	`\x1b[48;2;150;75;75m${PILL} \x1b[0m` +
	`\x1b[48;2;75;80;88m${PILL}  \x1b[0m`;

const CLASSIC_GOLDEN =
	"\x1b[38;2;232;178;96m5h\x1b[0m" +
	"\x1b[38;2;120;125;132m[\x1b[0m" +
	BATTERY_42 +
	"\x1b[38;2;120;125;132m]\x1b[0m" +
	"\x1b[38;2;232;178;96m⏰2h15m\x1b[0m" +
	"\x1b[38;2;120;125;132m | \x1b[0m" +
	"\x1b[38;2;232;116;116m7d\x1b[0m" +
	"\x1b[38;2;120;125;132m[\x1b[0m" +
	BATTERY_83 +
	"\x1b[38;2;120;125;132m]\x1b[0m" +
	"\x1b[38;2;232;116;116m⏰3d04h\x1b[0m";

// ---------------------------------------------------------------------------
// Helper-built expectations for secondary tests.
// ---------------------------------------------------------------------------

const SEPARATOR = ` ${fg(GRAPHITE.edge)}│${RESET} `;

function aurora42(c: UsageBarConfig): string {
	const sev = severityColor(
		GRAPHITE,
		42,
		c.warning_threshold,
		c.critical_threshold,
	);
	return (
		fg(GRAPHITE.mute) +
		"5h" +
		RESET +
		" " +
		auroraBar(42, c.bar_width, "■", GRAPHITE) +
		" " +
		fg(sev ?? GRAPHITE.ink) +
		BOLD +
		"42%" +
		RESET +
		" " +
		fg(GRAPHITE.edge) +
		"⏰" +
		fg(GRAPHITE.mute) +
		"2h15m" +
		RESET
	);
}

// ---------------------------------------------------------------------------
// theme
// ---------------------------------------------------------------------------

describe("theme", () => {
	it("parses #rrggbb, #rgb, and bare hex; rejects garbage", () => {
		expect([...(parseHex("#4ec85b") ?? [])]).toEqual([78, 200, 91]);
		expect([...(parseHex("#abc") ?? [])]).toEqual([170, 187, 204]);
		expect([...(parseHex("4ec85b") ?? [])]).toEqual([78, 200, 91]);
		expect(parseHex("")).toBeNull();
		expect(parseHex("#12")).toBeNull();
		expect(parseHex("xyz")).toBeNull();
	});

	it("applies color overrides only where the hex parses", () => {
		const p = applyColorOverrides(GRAPHITE, "#ff0000", "", "nope");
		expect([...p.ok]).toEqual([255, 0, 0]);
		expect([...p.warn]).toEqual([...GRAPHITE.warn]);
		expect([...p.hot]).toEqual([...GRAPHITE.hot]);
	});

	it("blends component-wise with truncation", () => {
		expect([...blend([78, 200, 91], [232, 178, 96], 0)]).toEqual([78, 200, 91]);
		expect([...blend([78, 200, 91], [232, 178, 96], 1)]).toEqual([
			232, 178, 96,
		]);
		// Worked example cell i2 of a 12-cell bar: t=2/11, 2t=4/11.
		expect([...blend([78, 200, 91], [232, 178, 96], 4 / 11)]).toEqual([
			134, 192, 92,
		]);
	});

	it("walks the severity ladder", () => {
		expect(severityColor(GRAPHITE, 10, 30, 70)).toBe(GRAPHITE.ok);
		expect(severityColor(GRAPHITE, 30, 30, 70)).toBe(GRAPHITE.warn);
		expect(severityColor(GRAPHITE, 42, 30, 70)).toBe(GRAPHITE.warn);
		expect(severityColor(GRAPHITE, 70, 30, 70)).toBe(GRAPHITE.hot);
		expect(severityColor(GRAPHITE, 83, 30, 70)).toBe(GRAPHITE.hot);
		expect(severityColor(GRAPHITE, null, 30, 70)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// bar primitives
// ---------------------------------------------------------------------------

describe("bar", () => {
	it("quantizes the ring glyph in 25% steps (min ◔ when >0)", () => {
		expect(ringGlyph(null)).toBe("○");
		expect(ringGlyph(0)).toBe("○");
		expect(ringGlyph(1)).toBe("◔");
		expect(ringGlyph(12.4)).toBe("◔");
		expect(ringGlyph(12.5)).toBe("◔");
		expect(ringGlyph(14)).toBe("◔");
		expect(ringGlyph(37.5)).toBe("◑");
		expect(ringGlyph(42)).toBe("◑");
		expect(ringGlyph(62.5)).toBe("◕");
		expect(ringGlyph(83)).toBe("◕");
		expect(ringGlyph(87.5)).toBe("●");
		expect(ringGlyph(100)).toBe("●");
	});

	it("renders a null-percent bar as all-edge cells", () => {
		expect(auroraBar(null, 12, "■", GRAPHITE)).toBe(
			`${fg(GRAPHITE.edge)}■■■■■■■■■■■■${RESET}`,
		);
	});

	it("forces at least one filled cell for tiny percents", () => {
		expect(auroraBar(1, 12, "■", GRAPHITE)).toBe(
			`${fg(GRAPHITE.ok)}■${fg(GRAPHITE.edge)}■■■■■■■■■■■${RESET}`,
		);
	});

	it("renders an all-empty bar for 0%", () => {
		expect(auroraBar(0, 12, "■", GRAPHITE)).toBe(
			`${fg(GRAPHITE.edge)}■■■■■■■■■■■■${RESET}`,
		);
	});

	it("renders the worked-example batteries", () => {
		expect(classicBattery(42, GRAPHITE.warn, GRAPHITE)).toBe(BATTERY_42);
		expect(classicBattery(83, GRAPHITE.hot, GRAPHITE)).toBe(BATTERY_83);
	});

	it("renders a null-percent battery as an empty -- battery", () => {
		expect(classicBattery(null, null, GRAPHITE)).toBe(
			`\x1b[48;2;75;80;88m${PILL}    --    \x1b[0m`,
		);
	});
});

// ---------------------------------------------------------------------------
// countdown format
// ---------------------------------------------------------------------------

describe("formatCountdown", () => {
	it("formats short windows as h+mm / bare minutes", () => {
		expect(formatCountdown(NOW + TWO_H_15M_MS, NOW, 18_000, "5h")).toBe(
			"2h15m",
		);
		expect(formatCountdown(NOW + 37 * 60_000, NOW, 18_000, "5h")).toBe("37m");
		expect(formatCountdown(NOW + 4_020_000, NOW, 18_000, "5h")).toBe("1h07m");
	});

	it("formats long windows as d+hh / bare hours", () => {
		expect(formatCountdown(NOW + THREE_D_04H_MS, NOW, 604_800, "7d")).toBe(
			"3d04h",
		);
		expect(formatCountdown(NOW + 5 * 3_600_000, NOW, 604_800, "7d")).toBe("5h");
		// Label containing "d" selects the long format even without a duration.
		expect(formatCountdown(NOW + 5 * 3_600_000, NOW, null, "7d")).toBe("5h");
	});

	it("never goes negative and floors", () => {
		expect(formatCountdown(NOW - 5_000, NOW, 18_000, "5h")).toBe("0m");
		expect(formatCountdown(NOW - 5_000, NOW, 604_800, "7d")).toBe("0h");
	});
});

// ---------------------------------------------------------------------------
// golden looks
// ---------------------------------------------------------------------------

describe("renderStatus golden looks", () => {
	it("aurora block renders the cs worked example (hardcoded)", () => {
		const s = snap();
		s.windows = workedWindows();
		const lines = renderStatus([s], cfg(), 200, GRAPHITE, NOW);
		expect(lines).toEqual([AURORA_GOLDEN]);
		expect(strip(lines[0] ?? "")).toBe(
			"5h ■■■■■■■■■■■■ 42% ⏰2h15m │ 7d ■■■■■■■■■■■■ 83% ⏰3d04h",
		);
	});

	it("aurora thin swaps the glyph and nothing else", () => {
		const c = cfg();
		c.bar_glyph = "thin";
		const s = snap();
		s.windows = workedWindows();
		const lines = renderStatus([s], c, 200, GRAPHITE, NOW);
		expect(lines).toEqual([AURORA_GOLDEN.replaceAll("■", "━")]);
	});

	it("ring renders bold ink pcts and triple-space separator (hardcoded)", () => {
		const c = cfg();
		c.style = "ring";
		const s = snap();
		s.windows = workedWindows();
		const lines = renderStatus([s], c, 200, GRAPHITE, NOW);
		expect(lines).toEqual([RING_GOLDEN]);
		expect(strip(lines[0] ?? "")).toBe(
			"◑ 42% 5h · resets 2h15m   ◕ 83% 7d · resets 3d04h",
		);
	});

	it("classic renders the battery layout with mute ' | ' separator (hardcoded)", () => {
		const c = cfg();
		c.style = "classic";
		const s = snap();
		s.windows = workedWindows();
		const lines = renderStatus([s], c, 200, GRAPHITE, NOW);
		expect(lines).toEqual([CLASSIC_GOLDEN]);
		expect(strip(lines[0] ?? "")).toBe(
			"5h[   42%    ]⏰2h15m | 7d[   83%    ]⏰3d04h",
		);
	});
});

// ---------------------------------------------------------------------------
// error and relay segments
// ---------------------------------------------------------------------------

describe("error and relay segments", () => {
	it("renders a warn error segment with an ink name prefix (hardcoded)", () => {
		const s = snap();
		s.provider = "zai-glm";
		s.plan = "zai";
		s.status = "error";
		s.error = "429";
		expect(renderStatus([s], cfg(), 200, GRAPHITE, NOW)).toEqual([
			"\x1b[38;2;218;221;225mZAI\x1b[0m \x1b[38;2;232;178;96musage unavailable (429)\x1b[0m",
		]);
	});

	it("falls back to bare 'usage unavailable' without error text", () => {
		const s = snap();
		s.plan = "claude";
		s.provider = "anthropic";
		s.status = "error";
		const lines = renderStatus([s], cfg(), 200, GRAPHITE, NOW);
		expect(strip(lines[0] ?? "")).toBe("Claude usage unavailable");
	});

	it("silently skips relay 'no billing endpoint' errors", () => {
		const relay = snap();
		relay.provider = "4sapi";
		relay.plan = "relay";
		relay.status = "error";
		relay.error = "no billing endpoint";
		expect(renderStatus([relay], cfg(), 200, GRAPHITE, NOW)).toEqual([]);

		const codex = snap();
		codex.windows = [win("5h", 42, NOW + TWO_H_15M_MS, 18_000)];
		const lines = renderStatus([relay, codex], cfg(), 200, GRAPHITE, NOW);
		expect(lines).toHaveLength(1);
		expect(strip(lines[0] ?? "")).toBe("5h ■■■■■■■■■■■■ 42% ⏰2h15m");
	});
});

// ---------------------------------------------------------------------------
// balance and announcement
// ---------------------------------------------------------------------------

describe("balance and announcement", () => {
	it("renders a relay balance as 'bal $200.00' with no name when alone", () => {
		const s = snap();
		s.provider = "4sapi";
		s.plan = "relay";
		s.balance = { kind: "relay", amount: 200 };
		expect(renderStatus([s], cfg(), 200, GRAPHITE, NOW)).toEqual([
			`${fg(GRAPHITE.ok)}bal $200.00${RESET}`,
		]);
	});

	it("renders a credits balance and joins it after windows with the separator", () => {
		const s = snap();
		s.windows = workedWindows();
		s.balance = { kind: "credits", amount: 12.5 };
		const lines = renderStatus([s], cfg(), 200, GRAPHITE, NOW);
		expect(lines).toEqual([
			`${AURORA_GOLDEN}${SEPARATOR}${fg(GRAPHITE.ok)}$12.50 credits${RESET}`,
		]);
	});

	it("hides the balance when show_balance is off", () => {
		const c = cfg();
		c.show_balance = false;
		const s = snap();
		s.provider = "4sapi";
		s.plan = "relay";
		s.balance = { kind: "relay", amount: 200 };
		expect(renderStatus([s], c, 200, GRAPHITE, NOW)).toEqual([]);
	});

	it("uses the configured currency", () => {
		const c = cfg();
		c.currency = "¥";
		const s = snap();
		s.provider = "4sapi";
		s.plan = "relay";
		s.balance = { kind: "relay", amount: 352 };
		const lines = renderStatus([s], c, 200, GRAPHITE, NOW);
		expect(strip(lines[0] ?? "")).toBe("bal ¥352.00");
	});

	it("appends the ↻ announcement after a space, text verbatim", () => {
		const c = cfg();
		const s = snap();
		s.windows = [win("5h", 42, NOW + TWO_H_15M_MS, 18_000)];
		s.announcement = { kind: "scheduled", text: "in 2d14h" };
		expect(renderStatus([s], c, 200, GRAPHITE, NOW)).toEqual([
			aurora42(c) +
				" " +
				`${fg(GRAPHITE.ink)}↻${RESET}` +
				" " +
				`${fg(GRAPHITE.mute)}in 2d14h${RESET}`,
		]);
	});

	it("renders the announcement text verbatim, including chancePercent", () => {
		const s = snap();
		s.windows = [win("5h", 42, NOW + TWO_H_15M_MS, 18_000)];
		s.announcement = {
			kind: "watch",
			text: "~75% chance · in 2d14h",
			chancePercent: 75,
		};
		const lines = renderStatus([s], cfg(), 200, GRAPHITE, NOW);
		expect(strip(lines[0] ?? "")).toContain("↻ ~75% chance · in 2d14h");
	});

	it("hides the announcement when show_resets is off", () => {
		const c = cfg();
		c.show_resets = false;
		const s = snap();
		s.windows = [win("5h", 42, NOW + TWO_H_15M_MS, 18_000)];
		s.announcement = { kind: "scheduled", text: "in 2d14h" };
		const lines = renderStatus([s], c, 200, GRAPHITE, NOW);
		expect(strip(lines[0] ?? "")).not.toContain("↻");
	});
});

// ---------------------------------------------------------------------------
// stale marking (issue 014)
// ---------------------------------------------------------------------------

describe("stale marking", () => {
	it("appends a mute ⟳ past 3× the refresh interval", () => {
		const c = cfg();
		const s = snap();
		s.windows = [win("5h", 42, NOW + TWO_H_15M_MS, 18_000)];
		s.fetchedAt = NOW - 10 * 60_000; // 10min > 3 × 2min
		expect(renderStatus([s], c, 200, GRAPHITE, NOW)).toEqual([
			`${aurora42(c)} ${fg(GRAPHITE.mute)}⟳${RESET}`,
		]);
	});

	it("dims the whole segment (⟳ included) past one hour", () => {
		const c = cfg();
		const s = snap();
		s.windows = [win("5h", 42, NOW + TWO_H_15M_MS, 18_000)];
		s.fetchedAt = NOW - 2 * 3_600_000;
		expect(renderStatus([s], c, 200, GRAPHITE, NOW)).toEqual([
			`\x1b[2m${aurora42(c)} ${fg(GRAPHITE.mute)}⟳${RESET}\x1b[22m`,
		]);
	});

	it("does not mark fresh data", () => {
		const c = cfg();
		const s = snap();
		s.windows = [win("5h", 42, NOW + TWO_H_15M_MS, 18_000)];
		s.fetchedAt = NOW - 60_000;
		expect(renderStatus([s], c, 200, GRAPHITE, NOW)).toEqual([aurora42(c)]);
	});
});

// ---------------------------------------------------------------------------
// wrapping and density (issue 010)
// ---------------------------------------------------------------------------

describe("wrapping and density", () => {
	function claudeSnap(): UsageSnapshot {
		const s = snap();
		s.provider = "anthropic";
		s.plan = "claude";
		s.windows = [
			win("5h", 15, NOW + 4 * 3_600_000 + 2 * 60_000, 18_000),
			win("7d", 61, NOW + 5 * 86_400_000 + 12 * 3_600_000, 604_800),
		];
		return s;
	}

	it("breaks at provider boundaries when over wide (width 80 → 2 lines)", () => {
		const codex = snap();
		codex.windows = workedWindows();
		const lines = renderStatus([codex, claudeSnap()], cfg(), 80, GRAPHITE, NOW);
		expect(lines).toHaveLength(2);
		expect(strip(lines[0] ?? "")).toBe(
			"Codex 5h ■■■■■■■■■■■■ 42% ⏰2h15m │ 7d ■■■■■■■■■■■■ 83% ⏰3d04h",
		);
		expect(strip(lines[1] ?? "")).toBe(
			"Claude 5h ■■■■■■■■■■■■ 15% ⏰4h02m │ 7d ■■■■■■■■■■■■ 61% ⏰5d12h",
		);
	});

	it("keeps a single segment whole even when it overflows the width", () => {
		const codex = snap();
		codex.windows = workedWindows();
		const lines = renderStatus([codex], cfg(), 30, GRAPHITE, NOW);
		expect(lines).toHaveLength(1);
		expect(strip(lines[0] ?? "")).toContain("⏰3d04h");
	});

	it("pads the aurora separator by density (compact │ / regular │ / cozy)", () => {
		const parts = [
			"5h ■■■■■■■■■■■■ 42% ⏰2h15m",
			"7d ■■■■■■■■■■■■ 83% ⏰3d04h",
		];
		for (const density of ["compact", "regular", "cozy"] as const) {
			const c = cfg();
			c.density = density;
			const s = snap();
			s.windows = workedWindows();
			const lines = renderStatus([s], c, 200, GRAPHITE, NOW);
			const join =
				density === "compact" ? "│" : density === "regular" ? " │ " : "  │  ";
			expect(strip(lines[0] ?? "")).toBe(parts.join(join));
		}
	});

	it("uses 2/3/4 plain spaces between ring segments by density", () => {
		const parts = ["◑ 42% 5h · resets 2h15m", "◕ 83% 7d · resets 3d04h"];
		const seps = { compact: "  ", regular: "   ", cozy: "    " } as const;
		for (const density of ["compact", "regular", "cozy"] as const) {
			const c = cfg();
			c.style = "ring";
			c.density = density;
			const s = snap();
			s.windows = workedWindows();
			const lines = renderStatus([s], c, 200, GRAPHITE, NOW);
			expect(strip(lines[0] ?? "")).toBe(parts.join(seps[density]));
		}
	});

	it("classic ignores density and keeps the mute ' | ' separator", () => {
		const c = cfg();
		c.style = "classic";
		c.density = "cozy";
		const s = snap();
		s.windows = workedWindows();
		const lines = renderStatus([s], c, 200, GRAPHITE, NOW);
		expect(strip(lines[0] ?? "")).toContain("]⏰2h15m | 7d[");
	});
});

// ---------------------------------------------------------------------------
// remaining display semantics
// ---------------------------------------------------------------------------

describe("display semantics", () => {
	it("returns [] for an empty snapshot list", () => {
		expect(renderStatus([], cfg(), 200, GRAPHITE, NOW)).toEqual([]);
	});

	it("skips a snapshot that would render nothing", () => {
		const s = snap();
		s.windows = [];
		expect(renderStatus([s], cfg(), 200, GRAPHITE, NOW)).toEqual([]);
	});

	it("pads single-digit pcts to two cells", () => {
		const s = snap();
		s.windows = [win("5h", 7, null, 18_000)];
		const lines = renderStatus([s], cfg(), 200, GRAPHITE, NOW);
		expect(lines[0] ?? "").toContain(`${BOLD} 7%`);
	});

	it("renders a null-percent aurora window with an edge bar and --%", () => {
		const s = snap();
		s.windows = [win("5h", null, null, 18_000)];
		expect(renderStatus([s], cfg(), 200, GRAPHITE, NOW)).toEqual([
			"\x1b[38;2;120;125;132m5h\x1b[0m " +
				"\x1b[38;2;75;80;88m■■■■■■■■■■■■\x1b[0m " +
				"\x1b[38;2;120;125;132m--%\x1b[0m",
		]);
	});

	it("names each provider in multi display; relay uses its provider id", () => {
		const relay = snap();
		relay.provider = "4sapi";
		relay.plan = "relay";
		relay.balance = { kind: "relay", amount: 200 };
		const codex = snap();
		codex.windows = [win("5h", 42, NOW + TWO_H_15M_MS, 18_000)];
		const lines = renderStatus([relay, codex], cfg(), 200, GRAPHITE, NOW);
		expect(lines).toHaveLength(1);
		expect(strip(lines[0] ?? "")).toBe(
			"4sapi bal $200.00 │ Codex 5h ■■■■■■■■■■■■ 42% ⏰2h15m",
		);
	});
});

it("hides reset countdowns when show_reset_countdown is false (default)", () => {
	const s = snap();
	s.windows.push(win("5h", 42, NOW + TWO_H_15M_MS, 18000));
	const lines = renderStatus([s], { ...DEFAULT_CONFIG }, 120, GRAPHITE, NOW);
	expect(lines.length).toBeGreaterThan(0);
	expect(strip(lines[0] ?? "")).not.toContain("⏰");
	expect(strip(lines[0] ?? "")).not.toContain("resets ");
});
