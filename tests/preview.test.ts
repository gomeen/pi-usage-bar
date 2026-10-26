import { expect, test } from "vitest";
import { buildUsagePreview } from "../src/pi/preview";
import { GRAPHITE } from "../src/render/theme";
import { DEFAULT_CONFIG } from "../src/types";

const NOW = 1_700_000_000_000;
const strip = (s: string) =>
	// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI test comparison.
	s.replace(/\x1b\[[0-9;]*m/g, "");
const preview = (config = structuredClone(DEFAULT_CONFIG)) =>
	buildUsagePreview([], config, 200, GRAPHITE, NOW).lines.map(strip).join("\n");

test("sample preview includes both active quota windows and compact other plans", () => {
	const result = buildUsagePreview([], DEFAULT_CONFIG, 200, GRAPHITE, NOW);
	expect(result.source).toBe("sample");
	expect(result.lines).toHaveLength(2);
	expect(preview()).toContain("Codex");
	expect(preview()).toContain("ZAI");
	expect(preview()).toContain("4sapi $200.00");
});

test("width, spacing, reset countdown and relay balance are reflected in preview", () => {
	const config = structuredClone(DEFAULT_CONFIG);
	const before = preview(config);
	config.bar_width = 8;
	expect(preview(config)).not.toBe(before);
	config.show_reset_countdown = false;
	expect(preview(config)).not.toContain("⏰");
	config.show_balance = false;
	expect(preview(config)).not.toContain("4sapi");
	config.show_resets = false;
	expect(preview(config)).not.toContain("Official reset");
	config.display.compact_others = false;
	const regular = preview(config);
	config.density = "cozy";
	expect(preview(config)).not.toBe(regular);
});

test("active-only mode and configured plan filters are applied to full preview", () => {
	const config = structuredClone(DEFAULT_CONFIG);
	config.display.mode = "active";
	expect(preview(config)).not.toContain("ZAI");
	config.display.mode = "all";
	config.display.providers = ["zai"];
	expect(preview(config)).not.toContain("Codex");
	expect(preview(config)).toContain("ZAI");
});
