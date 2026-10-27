import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FileCache } from "../../src/cache";
import { fetchResetAnnouncement } from "../../src/providers/resets";
import type { FetchLike, FetchOpts } from "../../src/types";

const T0 = Date.UTC(2026, 9, 26, 12, 0, 0); // 2026-10-26T12:00:00Z
const MIN = 60_000;
const HOUR = 60 * MIN;

let seq = 0;
const roots: string[] = [];
function newCache(): FileCache {
	const dir = `pi-usage-bar-resets-test-${process.pid}-${Date.now()}-${seq++}`;
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

/** Payload shaped like the real API: {"data": {...}, ...} (issue 012). */
function statusBody(data: Record<string, unknown>): string {
	return JSON.stringify({ data, stats: { tracked_resets: 3 } });
}

function opts(
	cache: FileCache,
	fetchImpl: FetchLike,
	now = T0,
): FetchOpts & { cache: FileCache } {
	return { endpoints: {}, now, fetchImpl, cache };
}

const SCHEDULED_PAYLOAD = statusBody({
	scheduled_reset: {
		status: "scheduled",
		scheduled_for: new Date(T0 + 47 * HOUR).toISOString(), // +47h → 1d23h
	},
	active_watch: null,
	latest_reset: {
		reset_type: "regular",
		announced_at: new Date(T0 - 26 * HOUR).toISOString(),
	},
});

describe("fetchResetAnnouncement parsing", () => {
	it("prefers a future scheduled reset", async () => {
		const cache = newCache();
		const fetchImpl: FetchLike = async () => res(200, SCHEDULED_PAYLOAD);
		const out = await fetchResetAnnouncement(opts(cache, fetchImpl));
		expect(out).toEqual({
			kind: "scheduled",
			text: "Reset announced · in 1d23h",
			shortText: "in 1d23h",
		});
	});

	it("counts the upcoming reset down in composite units", async () => {
		const cases: Array<[number, string]> = [
			[70 * MIN, "Reset announced · in 1h10m"],
			[45 * MIN, "Reset announced · in 45m"],
			[3 * HOUR, "Reset announced · in 3h00m"],
			[50 * HOUR, "Reset announced · in 2d02h"],
		];
		for (const [offset, text] of cases) {
			const cache = newCache();
			const fetchImpl: FetchLike = async () =>
				res(
					200,
					statusBody({
						scheduled_reset: {
							status: "scheduled",
							scheduled_for: new Date(T0 + offset).toISOString(),
						},
					}),
				);
			const out = await fetchResetAnnouncement(opts(cache, fetchImpl));
			expect(out).toEqual({
				kind: "scheduled",
				text,
				shortText: text.replace("Reset announced · ", ""),
			});
		}
	});

	it("downgrades a past/invalid scheduled time to awaiting confirmation", async () => {
		for (const scheduledFor of [
			new Date(T0 - HOUR).toISOString(),
			"not-a-date",
		]) {
			const cache = newCache();
			const fetchImpl: FetchLike = async () =>
				res(
					200,
					statusBody({
						scheduled_reset: {
							status: "scheduled",
							scheduled_for: scheduledFor,
						},
					}),
				);
			const out = await fetchResetAnnouncement(opts(cache, fetchImpl));
			expect(out).toEqual({
				kind: "scheduled",
				text: "Reset announced · awaiting confirmation",
				shortText: "awaiting confirmation",
			});
		}
	});

	it("renders an active watch with its chance percent", async () => {
		const cache = newCache();
		const fetchImpl: FetchLike = async () =>
			res(
				200,
				statusBody({
					active_watch: {
						observed_at: new Date(T0 - 30 * MIN).toISOString(),
						expires_at: new Date(T0 + 6 * HOUR).toISOString(),
						reset_chance_percent: 42,
					},
				}),
			);
		const out = await fetchResetAnnouncement(opts(cache, fetchImpl));
		expect(out).toEqual({
			kind: "watch",
			text: "AI forecast · reset possible (42%)",
			chancePercent: 42,
		});
	});

	it("omits an invalid chance percent", async () => {
		const cache = newCache();
		const fetchImpl: FetchLike = async () =>
			res(
				200,
				statusBody({
					active_watch: {
						observed_at: new Date(T0 - 30 * MIN).toISOString(),
						expires_at: new Date(T0 + 6 * HOUR).toISOString(),
						reset_chance_percent: 150,
					},
				}),
			);
		const out = await fetchResetAnnouncement(opts(cache, fetchImpl));
		expect(out).toEqual({
			kind: "watch",
			text: "AI forecast · reset possible",
		});
		expect("chancePercent" in (out ?? {})).toBe(false);
	});

	it("never announces a reset that already happened", async () => {
		const cases = [
			new Date(T0 - 26 * HOUR).toISOString(),
			new Date(T0 - 3 * HOUR).toISOString(),
			new Date(T0 - 5 * MIN).toISOString(),
		];
		for (const announcedAt of cases) {
			const cache = newCache();
			const fetchImpl: FetchLike = async () =>
				res(
					200,
					statusBody({
						latest_reset: { reset_type: "regular", announced_at: announcedAt },
					}),
				);
			const out = await fetchResetAnnouncement(opts(cache, fetchImpl));
			expect(out).toBeNull();
		}
	});

	it("returns null when nothing qualifies", async () => {
		const cache = newCache();
		const fetchImpl: FetchLike = async () =>
			res(
				200,
				statusBody({
					latest_reset: { announced_at: new Date(T0 + HOUR).toISOString() },
				}),
			);
		expect(await fetchResetAnnouncement(opts(cache, fetchImpl))).toBeNull();
	});
});

describe("fetchResetAnnouncement caching", () => {
	it("serves a fresh cache without any network call", async () => {
		const cache = newCache();
		let calls = 0;
		const fetchImpl: FetchLike = async () => {
			calls++;
			return res(200, SCHEDULED_PAYLOAD, { etag: "v1" });
		};
		const first = await fetchResetAnnouncement(opts(cache, fetchImpl, T0));
		expect(first?.kind).toBe("scheduled");
		let called = false;
		const spy: FetchLike = async () => {
			called = true;
			return res(500, "");
		};
		const second = await fetchResetAnnouncement(opts(cache, spy, T0 + 4 * MIN));
		expect(called).toBe(false);
		expect(calls).toBe(1);
		// The cached announcement is re-read, so the countdown has moved on
		// (the announcement time is absolute; only the countdown is derived).
		expect(second?.kind).toBe("scheduled");
		expect(second?.text).not.toBe(first?.text);
		expect(second?.text).toBe("Reset announced · in 1d22h");
	});

	it("revalidates with If-None-Match and bumps fetchedAt on 304", async () => {
		const cache = newCache();
		let etagSeen: string | undefined;
		const prime: FetchLike = async () =>
			res(200, SCHEDULED_PAYLOAD, { etag: "v1" });
		await fetchResetAnnouncement(opts(cache, prime, T0));
		const revalidate: FetchLike = async (_url, init) => {
			etagSeen = init?.headers?.IfNoneMatch;
			return res(304, "", { etag: "v1" });
		};
		const second = await fetchResetAnnouncement(
			opts(cache, revalidate, T0 + 10 * MIN),
		);
		expect(etagSeen).toBe("v1");
		expect(second?.kind).toBe("scheduled");
		// fetchedAt bumped to the 304 time: 55min old still renders…
		let called = false;
		const spy: FetchLike = async () => {
			called = true;
			throw new Error("network down");
		};
		const third = await fetchResetAnnouncement(opts(cache, spy, T0 + 65 * MIN));
		expect(called).toBe(true);
		expect(third?.kind).toBe("scheduled");
		// …whereas the pre-304 fetchedAt would already be stale-hidden (>1h).
		const fourth = await fetchResetAnnouncement(
			opts(cache, spy, T0 + 71 * MIN),
		);
		expect(fourth).toBeNull();
	});

	it("backs off after 429 with Retry-After clamped into the window", async () => {
		const cache = newCache();
		const prime: FetchLike = async () =>
			res(200, SCHEDULED_PAYLOAD, { etag: "v1" });
		await fetchResetAnnouncement(opts(cache, prime, T0));
		const rateLimited: FetchLike = async () =>
			res(429, "", { "Retry-After": "3600" });
		const second = await fetchResetAnnouncement(
			opts(cache, rateLimited, T0 + 6 * MIN),
		);
		expect(second?.kind).toBe("scheduled"); // cached parse during backoff
		// checkedAt is 14min old (> TTL), but retryAt (T0+66min) blocks the probe.
		let called = false;
		const spy: FetchLike = async () => {
			called = true;
			return res(200, SCHEDULED_PAYLOAD);
		};
		const third = await fetchResetAnnouncement(opts(cache, spy, T0 + 20 * MIN));
		expect(called).toBe(false);
		expect(third?.kind).toBe("scheduled");
	});

	it("hides announcements staler than 1 hour", async () => {
		const cache = newCache();
		const prime: FetchLike = async () => res(200, SCHEDULED_PAYLOAD);
		await fetchResetAnnouncement(opts(cache, prime, T0));
		let called = false;
		const down: FetchLike = async () => {
			called = true;
			throw new Error("network down");
		};
		const out = await fetchResetAnnouncement(opts(cache, down, T0 + 2 * HOUR));
		expect(called).toBe(true); // it tried; nothing fresh came back
		expect(out).toBeNull(); // stale-hidden (issue 014)
	});

	it("discards oversized bodies and keeps the last good data", async () => {
		const cache = newCache();
		const prime: FetchLike = async () =>
			res(200, SCHEDULED_PAYLOAD, { etag: "v1" });
		await fetchResetAnnouncement(opts(cache, prime, T0));
		const huge: FetchLike = async () =>
			res(200, "x".repeat(1_048_577), { etag: "v2" });
		const out = await fetchResetAnnouncement(opts(cache, huge, T0 + 10 * MIN));
		expect(out?.kind).toBe("scheduled"); // last good data, not the junk
	});

	it("discards 200 payloads without any known reset field", async () => {
		const cache = newCache();
		const fetchImpl: FetchLike = async () =>
			res(200, statusBody({ stats: { tracked_resets: 3 } }));
		expect(await fetchResetAnnouncement(opts(cache, fetchImpl))).toBeNull();
	});

	it("returns null on a first-call network error without throwing", async () => {
		const cache = newCache();
		const down: FetchLike = async () => {
			throw new Error("network down");
		};
		expect(await fetchResetAnnouncement(opts(cache, down))).toBeNull();
	});
});
