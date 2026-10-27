/**
 * Snapshot selection: which snapshots reach the bar, and under which key.
 *
 * Pure module — no pi imports, no node imports (mirrors detect.ts).
 *
 * Official plans are one-per-plan: the `openai` and `openai-codex` providers
 * both describe the same ChatGPT subscription, so only one snapshot can own
 * the "Codex" segment.
 *
 * Relays are one-per-provider: every relay provider is a separate account
 * with its own key and its own balance, even when several of them share one
 * host (same station, different key). Folding them by plan would silently
 * drop all but one of them.
 */

import type { PlanKind, UsageSnapshot } from "./types.js";

/**
 * Slot key for a snapshot's state (selection, last-good, backoff).
 *
 * Official plans share one slot per plan; relays get one slot per provider so
 * a failing relay never serves another relay's balance.
 */
export function snapshotKey(plan: PlanKind, provider: string): string {
	return plan === "relay" ? `relay:${provider}` : plan;
}

/**
 * Pick the snapshots the bar shows, in order. One snapshot per official plan
 * (the active provider's wins, so the full first line always describes the
 * plan in use); every relay provider is kept.
 */
export function selectSnapshots(
	snapshots: readonly UsageSnapshot[],
	activeProviderId: string,
): UsageSnapshot[] {
	const byKey = new Map<string, UsageSnapshot>();
	for (const snap of snapshots) {
		const key = snapshotKey(snap.plan, snap.provider);
		if (snap.provider === activeProviderId) {
			byKey.set(key, snap);
			continue;
		}
		if (!byKey.has(key)) byKey.set(key, snap);
	}
	return [...byKey.values()];
}
