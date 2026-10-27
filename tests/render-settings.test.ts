import { expect, test } from "vitest";
import { renderStatus } from "../src/render/layout";
import { GRAPHITE } from "../src/render/theme";
import { DEFAULT_CONFIG, type UsageSnapshot } from "../src/types";

const NOW = 1_700_000_000_000;
const SNAPSHOTS: UsageSnapshot[] = [
	{
		provider: "openai-codex",
		plan: "codex",
		status: "ok",
		fetchedAt: NOW,
		windows: [
			{
				label: "5h",
				percent: 42,
				durationSeconds: 18000,
				resetsAt: NOW + 8_100_000,
			},
			{
				label: "7d",
				percent: 83,
				durationSeconds: 604800,
				resetsAt: NOW + 273_600_000,
			},
		],
		announcement: {
			kind: "scheduled",
			text: "Reset announced · in 1h10m",
			shortText: "in 1h10m",
		},
	},
	{
		provider: "zai",
		plan: "zai",
		status: "ok",
		fetchedAt: NOW,
		windows: [
			{
				label: "5h",
				percent: 20,
				durationSeconds: 18000,
				resetsAt: NOW + 7_200_000,
			},
		],
	},
	{
		provider: "4sapi.com",
		plan: "relay",
		status: "ok",
		fetchedAt: NOW,
		windows: [],
		balance: { kind: "relay", amount: 200 },
	},
];
const strip = (s: string) =>
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI test comparison.
	s.replace(/\x1b\[[0-9;]*m/g, "");
const display = (config = structuredClone(DEFAULT_CONFIG)) =>
	renderStatus(SNAPSHOTS, config, 200, GRAPHITE, NOW, {
		provider: "openai-codex",
		plan: "codex",
	})
		.map(strip)
		.join("\n");

test("actual bar includes active quota windows and compact other plans", () => {
	expect(display().split("\n")).toHaveLength(2);
	expect(display()).toContain("Codex");
	expect(display()).toContain("ZAI");
	expect(display()).toContain("4sapi $200.00");
});

test("width, spacing, resets and balance settings affect the actual bar", () => {
	const config = structuredClone(DEFAULT_CONFIG);
	const before = display(config);
	config.bar_width = 8;
	expect(display(config)).not.toBe(before);
	config.show_reset_countdown = false;
	expect(display(config)).not.toContain("⏰");
	config.show_balance = false;
	expect(display(config)).not.toContain("4sapi");
	config.show_resets = false;
	expect(display(config)).not.toContain("Reset announced");
	config.display.compact_others = false;
	const regular = display(config);
	config.density = "cozy";
	expect(display(config)).not.toBe(regular);
});

test("actual bar respects active-only mode and plan filters", () => {
	const config = structuredClone(DEFAULT_CONFIG);
	config.display.mode = "active";
	expect(display(config)).not.toContain("ZAI");
	config.display.mode = "all";
	config.display.providers = ["zai"];
	expect(display(config)).not.toContain("Codex");
	expect(display(config)).toContain("ZAI");
});
