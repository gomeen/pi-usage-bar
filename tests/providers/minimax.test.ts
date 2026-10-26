/**
 * Fixture-driven tests for the MiniMax provider adapter
 * (tests/fixtures/minimax/). Parse is tested as a pure function; fetchUsage
 * (current endpoint -> legacy fallback) is exercised with a fake fetchImpl.
 * Node imports are test-only — the provider itself stays portable.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	MINIMAX_ENDPOINTS,
	MinimaxAdapter,
	parseMiniMaxUsage,
} from "../../src/providers/minimax";
import type { FetchLike } from "../../src/types";

const fixtures = join(import.meta.dirname, "..", "fixtures", "minimax");

function loadFixture(name: string): unknown {
	return JSON.parse(readFileSync(join(fixtures, name), "utf8"));
}

const NOW = 1776360000000;
const CRED = { token: "test-token" };

function fakeFetch(
	status: number,
	body: string,
): { fetch: FetchLike; urls: string[] } {
	const urls: string[] = [];
	const impl: FetchLike = async (url) => {
		urls.push(url);
		return { ok: status === 200, status, headers: {}, text: async () => body };
	};
	return { fetch: impl, urls };
}

test("active token plan: interval-first windows from the coding bucket, percent-only", () => {
	const snapshot = parseMiniMaxUsage(
		loadFixture("token-plan-active.json"),
		"minimax",
		NOW,
	);
	expect(snapshot.status).toBe("ok");
	expect(snapshot.provider).toBe("minimax");
	expect(snapshot.plan).toBe("minimax");
	expect(snapshot.fetchedAt).toBe(NOW);
	// MiniMax-M* wins over the earlier "video" entry (coding-bucket preference)
	// and explicit end_time beats the remains_time fallback.
	expect(snapshot.windows).toEqual([
		{
			label: "5h",
			percent: 12.5,
			resetsAt: 1776373200000,
			durationSeconds: 18000,
		},
		{
			label: "7d",
			percent: 37.5,
			resetsAt: 1776614400000,
			durationSeconds: 604800,
		},
	]);
});

test("maps the minimax-cn provider id to the China plan", () => {
	const snapshot = parseMiniMaxUsage(
		loadFixture("token-plan-active.json"),
		"minimax-cn",
		NOW,
	);
	expect(snapshot.plan).toBe("minimax-cn");
	expect(snapshot.provider).toBe("minimax-cn");
});

test("business code 2062 is the No-active-Token-Plan error", () => {
	const snapshot = parseMiniMaxUsage(
		loadFixture("no-plan-2062.json"),
		"minimax",
		NOW,
	);
	expect(snapshot.status).toBe("error");
	expect(snapshot.error).toBe("No active Token Plan");
	expect(snapshot.windows).toEqual([]);
});

test("other business codes surface as unavailable (code)", () => {
	const snapshot = parseMiniMaxUsage(
		{ base_resp: { status_code: 1005, status_msg: "internal error" } },
		"minimax",
		NOW,
	);
	expect(snapshot.status).toBe("error");
	expect(snapshot.error).toBe("unavailable (1005)");
});

test("accepts the data-nested envelope shape", () => {
	const snapshot = parseMiniMaxUsage(
		{
			data: {
				base_resp: { status_code: 0, status_msg: "success" },
				model_remains: [
					{
						model_name: "general",
						current_interval_total_count: 100,
						current_interval_remaining_percent: 25,
						end_time: 1776373200000,
					},
				],
			},
		},
		"minimax",
		NOW,
	);
	expect(snapshot.status).toBe("ok");
	// No start_time -> unknown interval length -> label "I", duration null.
	expect(snapshot.windows).toEqual([
		{ label: "I", percent: 75, resetsAt: 1776373200000, durationSeconds: null },
	]);
});

test("legacy shape: generic percent names and remains_time in seconds", () => {
	const snapshot = parseMiniMaxUsage(
		loadFixture("legacy-remains.json"),
		"minimax",
		NOW,
	);
	expect(snapshot.status).toBe("ok");
	expect(snapshot.windows).toEqual([
		{
			label: "I",
			percent: 33,
			resetsAt: NOW + 3500 * 1000,
			durationSeconds: null,
		},
		{ label: "7d", percent: 55, resetsAt: null, durationSeconds: 604800 },
	]);
});

test("remains_time in the >=1e9 band is treated as milliseconds", () => {
	const snapshot = parseMiniMaxUsage(
		loadFixture("remains-ms.json"),
		"minimax",
		NOW,
	);
	expect(snapshot.windows).toEqual([
		{
			label: "I",
			percent: 60,
			resetsAt: NOW + 1500000000,
			durationSeconds: null,
		},
		{
			label: "7d",
			percent: 35,
			resetsAt: NOW + 2600000000,
			durationSeconds: 604800,
		},
	]);
});

test("ambiguous remains_time (1e6..1e9) resolves to seconds", () => {
	const snapshot = parseMiniMaxUsage(
		{
			base_resp: { status_code: 0 },
			model_remains: [
				{
					model_name: "general",
					current_interval_total_count: 100,
					current_interval_remaining_percent: 20,
					remains_time: 7151954,
				},
			],
		},
		"minimax",
		NOW,
	);
	expect(snapshot.windows[0]?.resetsAt).toBe(NOW + 7151954 * 1000);
});

test("percent 0..1 decimals are scaled x100; integers are literal", () => {
	const snapshot = parseMiniMaxUsage(
		loadFixture("percent-decimal.json"),
		"minimax",
		NOW,
	);
	expect(snapshot.windows).toEqual([
		{ label: "I", percent: 50, resetsAt: null, durationSeconds: null },
		{ label: "7d", percent: 99, resetsAt: null, durationSeconds: 604800 },
	]);
});

test("status 3 / total 0 windows are kept when a percent or reset exists (live CN payloads do this)", () => {
	const snapshot = parseMiniMaxUsage(
		{
			base_resp: { status_code: 0 },
			model_remains: [
				{
					model_name: "general",
					current_interval_total_count: 500,
					current_interval_status: 3,
					current_interval_remaining_percent: 50,
					current_weekly_total_count: 0,
					current_weekly_remaining_percent: 90,
				},
			],
		},
		"minimax",
		NOW,
	);
	expect(snapshot.status).toBe("ok");
	// interval: 50 remaining → 50 used; weekly: 90 remaining → 10 used
	expect(snapshot.windows.map((w) => w.percent)).toEqual([50, 10]);
});

test("empty model_remains is ok with no windows; non-object payload is an error", () => {
	const empty = parseMiniMaxUsage(
		{ base_resp: { status_code: 0 }, model_remains: [] },
		"minimax",
		NOW,
	);
	expect(empty.status).toBe("ok");
	expect(empty.windows).toEqual([]);

	const invalid = parseMiniMaxUsage(42, "minimax", NOW);
	expect(invalid.status).toBe("error");
	expect(invalid.error).toBe("unavailable (body)");
});

test("fetchUsage falls back to the legacy endpoint after HTTP 404", async () => {
	const body = JSON.stringify(loadFixture("legacy-remains.json"));
	const urls: string[] = [];
	const impl: FetchLike = async (url) => {
		urls.push(url);
		if (urls.length === 1) {
			return {
				ok: false,
				status: 404,
				headers: {},
				text: async () => "not found",
			};
		}
		return { ok: true, status: 200, headers: {}, text: async () => body };
	};
	const snapshot = await new MinimaxAdapter("minimax").fetchUsage(CRED, {
		endpoints: {},
		now: NOW,
		fetchImpl: impl,
	});
	expect(urls).toEqual([
		MINIMAX_ENDPOINTS.minimax,
		MINIMAX_ENDPOINTS["minimax-legacy"],
	]);
	expect(snapshot.status).toBe("ok");
	expect(snapshot.windows).toHaveLength(2);
	expect(snapshot.fetchedAt).toBe(NOW);
});

test("fetchUsage falls back to the legacy endpoint after business code 1004", async () => {
	const cookieMissing = JSON.stringify({
		base_resp: {
			status_code: 1004,
			status_msg: "cookie is missing, log in again",
		},
	});
	const ok = JSON.stringify(loadFixture("token-plan-active.json"));
	const urls: string[] = [];
	const impl: FetchLike = async (url) => {
		urls.push(url);
		return {
			ok: true,
			status: 200,
			headers: {},
			text: async () => (urls.length === 1 ? cookieMissing : ok),
		};
	};
	const snapshot = await new MinimaxAdapter("minimax").fetchUsage(CRED, {
		endpoints: {},
		now: NOW,
		fetchImpl: impl,
	});
	expect(urls).toEqual([
		MINIMAX_ENDPOINTS.minimax,
		MINIMAX_ENDPOINTS["minimax-legacy"],
	]);
	expect(snapshot.status).toBe("ok");
	expect(snapshot.windows).toHaveLength(2);
});

test("fetchUsage honors CN overrides for current and legacy endpoints", async () => {
	const body = JSON.stringify(loadFixture("legacy-remains.json"));
	const urls: string[] = [];
	const impl: FetchLike = async (url) => {
		urls.push(url);
		if (urls.length === 1) {
			return { ok: false, status: 404, headers: {}, text: async () => "" };
		}
		return { ok: true, status: 200, headers: {}, text: async () => body };
	};
	const snapshot = await new MinimaxAdapter("minimax-cn").fetchUsage(CRED, {
		endpoints: {
			"minimax-cn": "https://a.test/quota",
			"minimax-cn-legacy": "https://b.test/legacy",
		},
		now: NOW,
		fetchImpl: impl,
	});
	expect(urls).toEqual(["https://a.test/quota", "https://b.test/legacy"]);
	expect(snapshot.status).toBe("ok");
});

test("fetchUsage maps 429 to an error without trying the legacy endpoint", async () => {
	const { fetch, urls } = fakeFetch(429, "{}");
	const snapshot = await new MinimaxAdapter("minimax").fetchUsage(CRED, {
		endpoints: {},
		now: NOW,
		fetchImpl: fetch,
	});
	expect(snapshot.status).toBe("error");
	expect(snapshot.error).toBe("unavailable (429)");
	expect(urls).toEqual([MINIMAX_ENDPOINTS.minimax]);
});

test("fetchUsage maps a thrown fetch to a network error", async () => {
	const impl: FetchLike = async () => {
		throw new Error("boom");
	};
	const snapshot = await new MinimaxAdapter("minimax").fetchUsage(CRED, {
		endpoints: {},
		now: NOW,
		fetchImpl: impl,
	});
	expect(snapshot.status).toBe("error");
	expect(snapshot.error).toBe("unavailable (network)");
});

test("live CN payload keeps general lane windows despite zero counts and status 3", () => {
	const payload = JSON.parse(
		readFileSync(
			join(__dirname, "../fixtures/minimax/live-cn-general-video.json"),
			"utf8",
		),
	);
	const now = 1792986923533;

	const snap = parseMiniMaxUsage(payload, "minimax-cn", now);
	expect(snap.status).toBe("ok");
	expect(snap.windows).toHaveLength(2);
	const [interval, weekly] = snap.windows;
	// interval: 98% remaining → 2% used, 5h duration, resets at end_time
	expect(interval?.percent).toBe(2);
	expect(interval?.label).toBe("5h");
	expect(interval?.resetsAt).toBe(1792998000000);
	// weekly: 100% remaining → 0% used, resets at weekly_end_time
	expect(weekly?.percent).toBe(0);
	expect(weekly?.label).toBe("7d");
	expect(weekly?.resetsAt).toBe(1793548800000);
});
