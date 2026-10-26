import { describe, expect, it } from "vitest";
import { renderStatus } from "../src/render/layout";
import { GRAPHITE } from "../src/render/theme";
import { DEFAULT_CONFIG, type UsageSnapshot } from "../src/types";

const NOW = 1_700_000_000_000;

function snap(
	provider: string,
	plan: UsageSnapshot["plan"],
	percents: [number, number],
): UsageSnapshot {
	return {
		provider,
		plan,
		windows: [
			{
				label: "5h",
				percent: percents[0],
				resetsAt: NOW + 90 * 60_000,
				durationSeconds: 18000,
			},
			{
				label: "7d",
				percent: percents[1],
				resetsAt: NOW + 5 * 86_400_000,
				durationSeconds: 604800,
			},
		],
		status: "ok",
		fetchedAt: NOW,
	};
}

describe("user scenario: glm model via custom provider (cc-switch → zai-cn)", () => {
	const snapshots = [
		snap("cc-switch-zhipu-glm", "zai-cn", [62, 68]),
		snap("openai-codex", "codex", [38, 6]),
		snap("minimax-cn", "minimax-cn", [2, 0]),
	];
	const cfg = { ...DEFAULT_CONFIG, show_reset_countdown: true };

	it("first line = active plan matched by provider id", () => {
		const lines = renderStatus(snapshots, cfg, 120, GRAPHITE, NOW, {
			provider: "cc-switch-zhipu-glm",
			plan: "zai-cn",
		});
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI in tests.
		const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
		expect(strip(lines[0] ?? "")).toContain("ZAI");
		expect(strip(lines[0] ?? "")).toContain("■");
		expect(strip(lines[1] ?? "")).not.toContain("ZAI ");
	});

	it("first line = active plan matched by plan when provider snapshot is absent", () => {
		const withoutCustom = [
			snap("zai-coding-cn", "zai-cn", [62, 68]),
			...snapshots.slice(1),
		];
		const lines = renderStatus(withoutCustom, cfg, 120, GRAPHITE, NOW, {
			provider: "cc-switch-zhipu-glm",
			plan: "zai-cn",
		});
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI in tests.
		const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
		expect(strip(lines[0] ?? "")).toContain("ZAI");
	});

	it("CN suffix dropped when the global twin is absent", () => {
		const lines = renderStatus(snapshots, cfg, 120, GRAPHITE, NOW, {
			provider: "cc-switch-zhipu-glm",
			plan: "zai-cn",
		});
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI in tests.
		const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
		expect(strip(lines.join(" "))).not.toContain("CN");
	});

	it("CN suffix kept when both global and CN plans are present", () => {
		const both = [...snapshots, snap("zai", "zai", [10, 20])];
		const lines = renderStatus(both, cfg, 120, GRAPHITE, NOW, {
			provider: "cc-switch-zhipu-glm",
			plan: "zai-cn",
		});
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI in tests.
		const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
		expect(strip(lines.join(" "))).toContain("ZAI CN");
	});
});
