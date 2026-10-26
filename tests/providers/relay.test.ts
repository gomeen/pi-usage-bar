import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FileCache } from "../../src/cache";
import { probeRelayBalance } from "../../src/providers/relay";
import type { FetchLike, FetchOpts } from "../../src/types";

const NOW = Date.UTC(2026, 9, 26, 12, 0, 0); // 2026-10-26T12:00:00Z
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const cred = { token: "sk-relay-test" };

let seq = 0;
const roots: string[] = [];
function newCache(): FileCache {
	const dir = `pi-usage-bar-relay-test-${process.pid}-${Date.now()}-${seq++}`;
	roots.push(path.join(os.tmpdir(), dir));
	return new FileCache(dir);
}
afterAll(() => {
	for (const root of roots) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

function res(
	status: number,
	body: string,
	headers: Record<string, string> = {},
): Awaited<ReturnType<FetchLike>> {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers,
		text: async () => body,
	};
}

interface Call {
	url: string;
	auth: string | undefined;
}

/** Routes by URL suffix; records every call with its Authorization header. */
function router(
	routes: Record<string, (url: string) => Awaited<ReturnType<FetchLike>>>,
	log: Call[] = [],
): FetchLike {
	return async (url, init) => {
		log.push({ url, auth: init?.headers?.Authorization });
		for (const [suffix, handler] of Object.entries(routes)) {
			if (suffix === "*" || url.includes(suffix)) {
				return handler(url);
			}
		}
		throw new Error(`unexpected url ${url}`);
	};
}

function opts(
	cache: FileCache,
	fetchImpl: FetchLike,
	now = NOW,
): FetchOpts & { cache: FileCache } {
	return { endpoints: {}, now, fetchImpl, cache };
}

const SUB = "/v1/dashboard/billing/subscription";
const USAGE = "/v1/dashboard/billing/usage";

describe("probeRelayBalance", () => {
	it("computes remaining from subscription and usage endpoints", async () => {
		const cache = newCache();
		const log: Call[] = [];
		const fetchImpl = router(
			{
				[SUB]: () => res(200, '{"hard_limit_usd": 200}'),
				[USAGE]: () => res(200, '{"total_usage": 14200}'),
			},
			log,
		);
		const snap = await probeRelayBalance(
			"https://api.4sapi.com",
			cred,
			opts(cache, fetchImpl),
		);
		expect(snap).toEqual({
			provider: "api.4sapi.com",
			plan: "relay",
			windows: [],
			balance: { kind: "relay", amount: 58 },
			status: "ok",
			fetchedAt: NOW,
		});
		expect(log.map((c) => c.url)).toEqual([
			"https://api.4sapi.com/v1/dashboard/billing/subscription",
			"https://api.4sapi.com/v1/dashboard/billing/usage?start_date=2026-07-18&end_date=2026-10-26",
		]);
		expect(log.every((c) => c.auth === "Bearer sk-relay-test")).toBe(true);
		expect(cache.get("relay:api.4sapi.com")).toEqual({
			data: { amount: 58 },
			fetchedAt: NOW,
		});
	});

	it("returns a 'no billing endpoint' error snapshot on first 404", async () => {
		const cache = newCache();
		const log: Call[] = [];
		const fetchImpl = router({ "*": () => res(404, "not found") }, log);
		const snap = await probeRelayBalance(
			"https://relay.example.com/",
			cred,
			opts(cache, fetchImpl),
		);
		expect(snap.status).toBe("error");
		expect(snap.error).toBe("no billing endpoint");
		expect(snap.plan).toBe("relay");
		expect(snap.provider).toBe("relay.example.com");
		expect(snap.balance).toBeUndefined();
		expect(log).toHaveLength(1); // usage endpoint never probed
	});

	it("keeps the last good amount when the endpoint later 404s", async () => {
		const cache = newCache();
		let subStatus = 200;
		const fetchImpl = router({
			[SUB]: () =>
				subStatus === 200
					? res(200, '{"hard_limit_usd": 100}')
					: res(404, "gone"),
			[USAGE]: () => res(200, '{"total_usage": 2500}'),
		});
		const first = await probeRelayBalance(
			"https://relay.example.com",
			cred,
			opts(cache, fetchImpl),
		);
		expect(first.balance?.amount).toBe(75);
		subStatus = 404;
		const second = await probeRelayBalance(
			"https://relay.example.com",
			cred,
			opts(cache, fetchImpl, NOW + 10 * MIN),
		);
		expect(second.status).toBe("ok");
		expect(second.balance?.amount).toBe(75);
		expect(second.fetchedAt).toBe(NOW); // cached timestamp → render adds ⟳
	});

	it("short-circuits on the negative cache without any network call", async () => {
		const cache = newCache();
		const miss = router({ "*": () => res(404, "") });
		await probeRelayBalance(
			"https://relay.example.com",
			cred,
			opts(cache, miss),
		);
		let called = false;
		const spy: FetchLike = async () => {
			called = true;
			return res(200, "{}");
		};
		const snap = await probeRelayBalance(
			"https://relay.example.com",
			cred,
			opts(cache, spy, NOW + MIN),
		);
		expect(called).toBe(false);
		expect(snap.status).toBe("error");
		expect(snap.error).toBe("no billing endpoint");
	});

	it("re-probes a negative entry older than 7 days", async () => {
		const cache = newCache();
		const miss = router({ "*": () => res(404, "") });
		await probeRelayBalance(
			"https://relay.example.com",
			cred,
			opts(cache, miss),
		);
		const fetchImpl = router({
			[SUB]: () => res(200, '{"hard_limit_usd": 200}'),
			[USAGE]: () => res(200, '{"total_usage": 0}'),
		});
		const snap = await probeRelayBalance(
			"https://relay.example.com",
			cred,
			opts(cache, fetchImpl, NOW + 8 * DAY),
		);
		expect(snap.status).toBe("ok");
		expect(snap.balance?.amount).toBe(200);
	});

	it("treats 429 as keep-last without writing a negative cache entry", async () => {
		const cache = newCache();
		let subStatus = 200;
		const fetchImpl = router({
			[SUB]: () =>
				subStatus === 200
					? res(200, '{"hard_limit_usd": 100}')
					: res(429, "rate limited"),
			[USAGE]: () => res(200, '{"total_usage": 5000}'),
		});
		await probeRelayBalance(
			"https://relay.example.com",
			cred,
			opts(cache, fetchImpl),
		);
		subStatus = 429;
		const snap = await probeRelayBalance(
			"https://relay.example.com",
			cred,
			opts(cache, fetchImpl, NOW + 10 * MIN),
		);
		expect(snap.status).toBe("ok");
		expect(snap.balance?.amount).toBe(50);
		expect(snap.fetchedAt).toBe(NOW);
		expect(cache.get("relay:relay.example.com")?.data).toEqual({ amount: 50 });
	});

	it("keeps the last amount on network errors", async () => {
		const cache = newCache();
		let down = false;
		const fetchImpl = router({
			[SUB]: () => {
				if (down) {
					throw new Error("ECONNREFUSED");
				}
				return res(200, '{"hard_limit_usd": 100}');
			},
			[USAGE]: () => res(200, '{"total_usage": 1000}'),
		});
		await probeRelayBalance(
			"https://relay.example.com",
			cred,
			opts(cache, fetchImpl),
		);
		down = true;
		const snap = await probeRelayBalance(
			"https://relay.example.com",
			cred,
			opts(cache, fetchImpl, NOW + 10 * MIN),
		);
		expect(snap.status).toBe("ok");
		expect(snap.balance?.amount).toBe(90);
		expect(snap.fetchedAt).toBe(NOW);
	});

	it("reuses a fresh good entry for 5 minutes without probing", async () => {
		const cache = newCache();
		const log: Call[] = [];
		const fetchImpl = router(
			{
				[SUB]: () => res(200, '{"hard_limit_usd": 100}'),
				[USAGE]: () => res(200, '{"total_usage": 4000}'),
			},
			log,
		);
		await probeRelayBalance(
			"https://relay.example.com",
			cred,
			opts(cache, fetchImpl),
		);
		expect(log).toHaveLength(2);
		let called = false;
		const spy: FetchLike = async () => {
			called = true;
			return res(200, "{}");
		};
		const snap = await probeRelayBalance(
			"https://relay.example.com",
			cred,
			opts(cache, spy, NOW + 4 * MIN),
		);
		expect(called).toBe(false);
		expect(snap.status).toBe("ok");
		expect(snap.balance?.amount).toBe(60);
		// Past the 5-minute TTL the probe runs again.
		await probeRelayBalance(
			"https://relay.example.com",
			cred,
			opts(cache, fetchImpl, NOW + 6 * MIN),
		);
		expect(log).toHaveLength(4);
	});

	it("negative-caches hard_limit_usd 0 and JSON parse failures", async () => {
		for (const body of ["{}", "not json"]) {
			const cache = newCache();
			const fetchImpl = router({
				[SUB]: () => res(200, body),
				[USAGE]: () => res(200, '{"total_usage": 0}'),
			});
			const snap = await probeRelayBalance(
				"https://relay.example.com",
				cred,
				opts(cache, fetchImpl),
			);
			expect(snap.status).toBe("error");
			expect(snap.error).toBe("no billing endpoint");
		}
	});

	it("never throws on an unparseable baseUrl", async () => {
		const cache = newCache();
		const snap = await probeRelayBalance(
			"not a url",
			cred,
			opts(cache, router({ "*": () => res(200, "{}") })),
		);
		expect(snap.status).toBe("error");
		expect(snap.error).toBe("unavailable");
	});
});
