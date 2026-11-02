/**
 * Fixture-driven tests for the DeepSeek provider adapter
 * (tests/fixtures/deepseek/). Parse is tested as a pure function; fetchUsage
 * is exercised with a fake fetchImpl. Data contract:
 * research/deepseek-usage-api.md; display decisions: issue 018.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	DEEPSEEK_ENDPOINTS,
	DeepSeekAdapter,
	parseDeepSeekBalance,
} from "../../src/providers/deepseek";
import type { FetchLike, FetchOpts } from "../../src/types";

const fixtures = join(import.meta.dirname, "..", "fixtures", "deepseek");

function loadFixture(name: string): unknown {
	return JSON.parse(readFileSync(join(fixtures, name), "utf8"));
}

const NOW = 1776576000000;
const CRED = { token: "sk-test" };

interface RecordedCall {
	url: string;
	authorization: string | undefined;
	accept: string | undefined;
	signal: AbortSignal | undefined;
}

function fakeFetch(
	status: number,
	body: string,
): { fetch: FetchLike; calls: RecordedCall[] } {
	const calls: RecordedCall[] = [];
	const impl: FetchLike = async (url, init) => {
		calls.push({
			url,
			authorization: init?.headers?.Authorization,
			accept: init?.headers?.Accept,
			signal: init?.signal,
		});
		return { ok: status === 200, status, headers: {}, text: async () => body };
	};
	return { fetch: impl, calls };
}

function opts(fetch: FetchLike, overrides: Partial<FetchOpts> = {}): FetchOpts {
	return {
		endpoints: {},
		now: NOW,
		fetchImpl: fetch,
		...overrides,
	};
}

test("endpoint is the documented first-party balance route", () => {
	expect(DEEPSEEK_ENDPOINTS.deepseek).toBe(
		"https://api.deepseek.com/user/balance",
	);
});

test("parses the official-docs CNY example into a prepaid balance", () => {
	expect(parseDeepSeekBalance(loadFixture("balance-ok-cny.json"))).toEqual({
		kind: "prepaid",
		amount: 110,
		currency: "CNY",
	});
});

test("parses USD amounts from numeric strings", () => {
	expect(parseDeepSeekBalance(loadFixture("balance-ok-usd.json"))).toEqual({
		kind: "prepaid",
		amount: 12.34,
		currency: "USD",
	});
});

test("takes the first balance_infos entry; is_available is ignored", () => {
	// is_available=false only means "insufficient for API calls" — the number
	// stays real and is displayed (research §2).
	expect(parseDeepSeekBalance(loadFixture("balance-two-entries.json"))).toEqual(
		{
			kind: "prepaid",
			amount: 0.5,
			currency: "CNY",
		},
	);
});

test("unusable bodies yield null, not an invented amount", () => {
	expect(parseDeepSeekBalance(null)).toBeNull();
	expect(parseDeepSeekBalance("nope")).toBeNull();
	expect(parseDeepSeekBalance({})).toBeNull();
	expect(parseDeepSeekBalance({ balance_infos: [] })).toBeNull();
	expect(
		parseDeepSeekBalance({ balance_infos: [{ currency: "CNY" }] }),
	).toBeNull();
	expect(
		parseDeepSeekBalance({
			balance_infos: [{ currency: "CNY", total_balance: "-5" }],
		}),
	).toBeNull();
	expect(
		parseDeepSeekBalance({
			balance_infos: [{ currency: "CNY", total_balance: "" }],
		}),
	).toBeNull();
});

test("fetchUsage sends the bearer token to the first-party endpoint", async () => {
	const { fetch, calls } = fakeFetch(
		200,
		JSON.stringify(loadFixture("balance-ok-cny.json")),
	);
	const snap = await new DeepSeekAdapter().fetchUsage(CRED, opts(fetch));
	expect(calls).toHaveLength(1);
	expect(calls[0]?.url).toBe("https://api.deepseek.com/user/balance");
	expect(calls[0]?.authorization).toBe(`Bearer ${CRED.token}`);
	expect(calls[0]?.accept).toBe("application/json");
	expect(snap).toEqual({
		provider: "deepseek",
		plan: "deepseek",
		windows: [],
		balance: { kind: "prepaid", amount: 110, currency: "CNY" },
		status: "ok",
		fetchedAt: NOW,
	});
});

test("PI_DEEPSEEK_USAGE_ENDPOINT override replaces the URL", async () => {
	const { fetch, calls } = fakeFetch(
		200,
		JSON.stringify(loadFixture("balance-ok-cny.json")),
	);
	await new DeepSeekAdapter().fetchUsage(
		CRED,
		opts(fetch, { endpoints: { deepseek: "https://mirror.example/balance" } }),
	);
	expect(calls[0]?.url).toBe("https://mirror.example/balance");
});

test("abort signal is forwarded", async () => {
	const { fetch, calls } = fakeFetch(
		200,
		JSON.stringify(loadFixture("balance-ok-cny.json")),
	);
	const controller = new AbortController();
	await new DeepSeekAdapter().fetchUsage(
		CRED,
		opts(fetch, { signal: controller.signal }),
	);
	expect(calls[0]?.signal).toBe(controller.signal);
});

test("non-200 statuses become short errors that feed the 429 backoff", async () => {
	const cases: ReadonlyArray<[number, string]> = [
		[401, "unavailable (401)"],
		[403, "unavailable (403)"],
		[429, "unavailable (429)"],
		[500, "unavailable (500)"],
	];
	for (const [status, expected] of cases) {
		const { fetch } = fakeFetch(status, '{"error":{"type":"x"}}');
		const snap = await new DeepSeekAdapter().fetchUsage(CRED, opts(fetch));
		expect(snap.status).toBe("error");
		expect(snap.error).toBe(expected);
		expect(snap.windows).toEqual([]);
	}
});

test("network failure, bad JSON, and bad bodies never throw", async () => {
	const net: FetchLike = async () => {
		throw new Error("dns");
	};
	expect((await new DeepSeekAdapter().fetchUsage(CRED, opts(net))).error).toBe(
		"unavailable (network)",
	);

	const parse = fakeFetch(200, "not json at all");
	expect(
		(await new DeepSeekAdapter().fetchUsage(CRED, opts(parse.fetch))).error,
	).toBe("unavailable (parse)");

	const body = fakeFetch(200, '{"balance_infos":[]}');
	expect(
		(await new DeepSeekAdapter().fetchUsage(CRED, opts(body.fetch))).error,
	).toBe("unavailable (body)");
});
