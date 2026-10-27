/**
 * Snapshot selection: one snapshot per official plan, one per relay provider.
 *
 * The bug this guards against: every relay shares `plan: "relay"`, so
 * folding by plan dropped all but one relay — a user with three relay
 * accounts saw only one of their balances.
 */

import { describe, expect, it } from "vitest";
import { selectSnapshots, snapshotKey } from "../src/select";
import type { UsageSnapshot } from "../src/types";

function snap(
	provider: string,
	plan: UsageSnapshot["plan"],
	extra: Partial<UsageSnapshot> = {},
): UsageSnapshot {
	return {
		provider,
		plan,
		windows: [],
		status: "ok",
		fetchedAt: 1_000,
		...extra,
	};
}

describe("snapshotKey", () => {
	it("shares one slot per official plan", () => {
		expect(snapshotKey("codex", "openai")).toBe("codex");
		expect(snapshotKey("codex", "openai-codex")).toBe("codex");
	});

	it("gives every relay provider its own slot", () => {
		expect(snapshotKey("relay", "h-self")).toBe("relay:h-self");
		expect(snapshotKey("relay", "h-company")).toBe("relay:h-company");
	});
});

describe("selectSnapshots", () => {
	it("keeps every relay provider", () => {
		const snapshots = [
			snap("4sapi", "relay"),
			snap("h-self", "relay"),
			snap("h-company", "relay"),
		];
		expect(selectSnapshots(snapshots, "").map((s) => s.provider)).toEqual([
			"4sapi",
			"h-self",
			"h-company",
		]);
	});

	it("keeps relays that share one host", () => {
		// Same station, different keys: two accounts, two balances.
		const snapshots = [
			snap("h-self", "relay", { balance: { kind: "relay", amount: 2028 } }),
			snap("h-company", "relay", {
				balance: { kind: "relay", amount: 4462 },
			}),
		];
		const selected = selectSnapshots(snapshots, "");
		expect(selected).toHaveLength(2);
		expect(selected[0]?.balance?.amount).toBe(2028);
		expect(selected[1]?.balance?.amount).toBe(4462);
	});

	it("folds overlapping official plans to one snapshot", () => {
		const snapshots = [snap("openai-codex", "codex"), snap("openai", "codex")];
		expect(selectSnapshots(snapshots, "").map((s) => s.provider)).toEqual([
			"openai-codex",
		]);
	});

	it("prefers the active provider for its plan", () => {
		const snapshots = [snap("openai-codex", "codex"), snap("openai", "codex")];
		expect(selectSnapshots(snapshots, "openai").map((s) => s.provider)).toEqual(
			["openai"],
		);
	});

	it("keeps the active relay without dropping the other relays", () => {
		const snapshots = [
			snap("4sapi", "relay"),
			snap("h-self", "relay"),
			snap("h-company", "relay"),
		];
		expect(selectSnapshots(snapshots, "h-self").map((s) => s.provider)).toEqual(
			["4sapi", "h-self", "h-company"],
		);
	});
});
