/**
 * Facade wiring for the official reset announcement (issue 012 + revision):
 * when the announcement is fetched, when it is attached, and when the
 * provider data itself fails.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FileCache } from "../../src/cache";
import { type FetchTarget, fetchAllUsages } from "../../src/providers/facade";
import type { FetchLike } from "../../src/types";

const T0 = Date.UTC(2026, 9, 26, 12, 0, 0);

let seq = 0;
const roots: string[] = [];
function newCache(): FileCache {
	const dir = `pi-usage-bar-facade-test-${process.pid}-${Date.now()}-${seq++}`;
	roots.push(path.join(os.tmpdir(), dir));
	return new FileCache(dir);
}
afterAll(() => {
	for (const root of roots) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

const codexTarget: FetchTarget = {
	provider: "openai-codex",
	plan: "codex",
	credential: { token: "test-token", headers: {} },
};

const claudeTarget: FetchTarget = {
	provider: "anthropic",
	plan: "claude",
	credential: { token: "test-token", headers: {} },
};

function jsonRes(body: unknown): Awaited<ReturnType<FetchLike>> {
	return {
		ok: true,
		status: 200,
		headers: {},
		text: async () => JSON.stringify(body),
	};
}

const SCHEDULED = {
	data: {
		scheduled_reset: {
			status: "scheduled",
			scheduled_for: new Date(T0 + 70 * 60_000).toISOString(),
		},
	},
};

describe("fetchAllUsages announcements", () => {
	it("keeps the announcement when the codex usage request fails", async () => {
		// Runs first: the facade keeps a last-good snapshot per plan, so a
		// later success would mask the error this case needs.
		const cache = newCache();
		const fetchImpl: FetchLike = async (url) => {
			if (String(url).includes("codex-resets.com")) {
				return jsonRes(SCHEDULED);
			}
			throw new Error("network down");
		};
		const snapshots = await fetchAllUsages([codexTarget], {
			endpoints: {},
			now: T0,
			fetchImpl,
			cache,
			showResets: true,
		});
		expect(snapshots[0]?.status).toBe("error");
		// The announcement is an independent data source: a failing usage
		// fetch must not swallow it.
		expect(snapshots[0]?.announcement?.text).toBe("Reset announced · in 1h10m");
	});

	it("attaches the announcement to the codex snapshot", async () => {
		const cache = newCache();
		const fetchImpl: FetchLike = async (url) => {
			if (String(url).includes("codex-resets.com")) {
				return jsonRes(SCHEDULED);
			}
			return jsonRes({
				rate_limit: {
					primary_window: {
						used_percent: 42,
						limit_window_seconds: 18000,
						reset_after_seconds: 3600,
					},
				},
			});
		};
		const snapshots = await fetchAllUsages([codexTarget], {
			endpoints: {},
			now: T0,
			fetchImpl,
			cache,
			showResets: true,
		});
		expect(snapshots[0]?.announcement?.text).toBe("Reset announced · in 1h10m");
	});

	it("never probes codex-resets.com without a codex target", async () => {
		const cache = newCache();
		let resetsCalls = 0;
		const fetchImpl: FetchLike = async (url) => {
			if (String(url).includes("codex-resets.com")) {
				resetsCalls++;
				return jsonRes(SCHEDULED);
			}
			return jsonRes({ rate_limits: [] });
		};
		await fetchAllUsages([claudeTarget], {
			endpoints: {},
			now: T0,
			fetchImpl,
			cache,
			showResets: true,
		});
		expect(resetsCalls).toBe(0);
	});
});

/** Relay targets: one account per provider, even on a shared host. */
function relayTarget(
	provider: string,
	baseUrl: string,
	token: string,
): FetchTarget {
	return {
		provider,
		plan: "relay",
		baseUrl,
		credential: { token },
	};
}

describe("fetchAllUsages relay isolation", () => {
	it("keeps one snapshot per relay provider on a shared host", async () => {
		const cache = newCache();
		const fetchImpl: FetchLike = async (_url, init) => {
			const auth = init?.headers?.Authorization ?? "";
			return jsonRes({ balance: auth.includes("self-key") ? 2028 : 4462 });
		};
		const snapshots = await fetchAllUsages(
			[
				relayTarget("h-self", "https://host.test/v1", "self-key"),
				relayTarget("h-company", "https://host.test/v1", "other-key"),
			],
			{
				endpoints: {},
				now: T0,
				fetchImpl,
				cache,
				showResets: false,
			},
		);
		expect(snapshots.map((s) => s.provider)).toEqual(["h-self", "h-company"]);
		expect(snapshots[0]?.balance?.amount).toBe(2028);
		expect(snapshots[1]?.balance?.amount).toBe(4462);
	});

	it("does not serve one relay's last-good balance to another", async () => {
		const cache = newCache();
		let healthy = true;
		const fetchImpl: FetchLike = async (url) => {
			if (url.includes("broken")) {
				return { ok: false, status: 500, headers: {}, text: async () => "" };
			}
			if (!healthy) {
				return { ok: false, status: 500, headers: {}, text: async () => "" };
			}
			return jsonRes({ balance: 100 });
		};
		const targets = [
			relayTarget("ok-relay", "https://ok.test/v1", "k1"),
			relayTarget("broken-relay", "https://broken.test/v1", "k2"),
		];
		const first = await fetchAllUsages(targets, {
			endpoints: {},
			now: T0,
			fetchImpl,
			cache,
			showResets: false,
		});
		expect(first[0]?.balance?.amount).toBe(100);
		expect(first[1]?.status).toBe("error");

		// The healthy relay now fails: it must keep its own last-good value
		// (100), never the failing relay's error snapshot.
		healthy = false;
		const second = await fetchAllUsages(targets, {
			endpoints: {},
			now: T0 + 10 * 60_000,
			fetchImpl,
			cache,
			showResets: false,
		});
		expect(second[0]?.status).toBe("ok");
		expect(second[0]?.balance?.amount).toBe(100);
		expect(second[1]?.status).toBe("error");
	});
});
