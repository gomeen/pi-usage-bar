import { renderStatus } from "../render/layout.js";
import type { Palette, UsageBarConfig, UsageSnapshot } from "../types.js";

export type ActiveUsage = Parameters<typeof renderStatus>[5];

export function buildUsagePreview(
	snapshots: UsageSnapshot[],
	config: UsageBarConfig,
	width: number,
	palette: Palette,
	now: number,
	active?: ActiveUsage,
): { source: "live" | "sample"; lines: string[] } {
	const source = snapshots.length > 0 ? "live" : "sample";
	const data: UsageSnapshot[] =
		source === "live"
			? snapshots
			: [
					{
						provider: "openai-codex",
						plan: "codex",
						windows: [
							{
								label: "5h",
								percent: 42,
								durationSeconds: 18000,
								resetsAt: now + 8_100_000,
							},
							{
								label: "7d",
								percent: 83,
								durationSeconds: 604800,
								resetsAt: now + 273_600_000,
							},
						],
						status: "ok",
						fetchedAt: now,
						announcement: { kind: "latest", text: "Official reset · 2h ago" },
					},
					{
						provider: "zai",
						plan: "zai",
						windows: [
							{
								label: "5h",
								percent: 20,
								durationSeconds: 18000,
								resetsAt: now + 7_200_000,
							},
						],
						status: "ok",
						fetchedAt: now,
					},
					{
						provider: "4sapi.com",
						plan: "relay",
						windows: [],
						balance: { kind: "relay", amount: 200 },
						status: "ok",
						fetchedAt: now,
					},
				];
	const previewActive: ActiveUsage =
		source === "sample"
			? { provider: "openai-codex", plan: "codex" }
			: (active ?? {
					provider: data[0]?.provider ?? "",
					plan: data[0]?.plan ?? null,
				});
	return {
		source,
		lines: renderStatus(data, config, width, palette, now, previewActive),
	};
}
