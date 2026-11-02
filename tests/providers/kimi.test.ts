/**
 * Fixture-driven tests for the Kimi (Moonshot) provider adapter
 * (tests/fixtures/kimi/). Parse is tested as a pure function; fetchUsage is
 * exercised with a fake fetchImpl. Data contract: research/kimi-usage-api.md;
 * display decisions: issue 019.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	KIMI_CURRENCY,
	KIMI_ENDPOINTS,
	KimiAdapter,
	parseKimiBalance,
} from "../../src/providers/kimi";
import type { FetchLike, FetchOpts } from "../../src/types";

const fixtures = join(import.meta.dirname, "..", "fixtures", "kimi");

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

test("endpoints are the documented first-party balance routes per station", () => {
	expect(KIMI_ENDPOINTS.kimi).toBe(
		"https://api.moonshot.ai/v1/users/me/balance",
	);
	expect(KIMI_ENDPOINTS["kimi-cn"]).toBe(
		"https://api.moonshot.cn/v1/users/me/balance",
	);
	expect(KIMI_CURRENCY.kimi).toBe("USD");
	expect(KIMI_CURRENCY["kimi-cn"]).toBe("CNY");
});

test("parses the official-docs CNY example into a prepaid balance", () => {
	expect(parseKimiBalance(loadFixture("balance-ok-cny.json"), "CNY")).toEqual({
		kind: "prepaid",
		amount: 49.58894,
		currency: "CNY",
	});
});

test("parses the USD global-station example", () => {
	expect(parseKimiBalance(loadFixture("balance-ok-usd.json"), "USD")).toEqual({
		kind: "prepaid",
		amount: 12.5,
		currency: "USD",
	});
});

test("available_balance is shown even when cash is in deficit", () => {
	// Docs: with negative cash_balance, available_balance equals the voucher
	// balance — the spendable amount. The deficit breakdown stays out of the
	// bar (issue 013 "remaining only").
	expect(
		parseKimiBalance(loadFixture("balance-cash-deficit.json"), "CNY"),
	).toEqual({
		kind: "prepaid",
		amount: 46.58893,
		currency: "CNY",
	});
});

test("non-numeric amounts and missing data yield null, not an invented amount", () => {
	expect(parseKimiBalance(null, "CNY")).toBeNull();
	expect(parseKimiBalance("nope", "CNY")).toBeNull();
	expect(parseKimiBalance({}, "CNY")).toBeNull();
	expect(parseKimiBalance({ code: 0 }, "CNY")).toBeNull();
	expect(
		parseKimiBalance({ code: 0, data: { voucher_balance: 5 } }, "CNY"),
	).toBeNull();
	expect(
		parseKimiBalance({ code: 0, data: { available_balance: "" } }, "CNY"),
	).toBeNull();
});

test("a non-zero envelope code fails the body even over HTTP 200", () => {
	expect(
		parseKimiBalance(loadFixture("balance-error-code.json"), "CNY"),
	).toBeNull();
	// A missing code field stays lenient (shape drift defense).
	expect(parseKimiBalance({ data: { available_balance: 9 } }, "CNY")).toEqual({
		kind: "prepaid",
		amount: 9,
		currency: "CNY",
	});
});

test("fetchUsage sends the bearer token to the station's own endpoint", async () => {
	const { fetch, calls } = fakeFetch(
		200,
		JSON.stringify(loadFixture("balance-ok-cny.json")),
	);
	const snap = await new KimiAdapter("kimi-cn").fetchUsage(CRED, opts(fetch));
	expect(calls).toHaveLength(1);
	expect(calls[0]?.url).toBe("https://api.moonshot.cn/v1/users/me/balance");
	expect(calls[0]?.authorization).toBe(`Bearer ${CRED.token}`);
	expect(calls[0]?.accept).toBe("application/json");
	expect(snap).toEqual({
		provider: "kimi-cn",
		plan: "kimi-cn",
		windows: [],
		balance: { kind: "prepaid", amount: 49.58894, currency: "CNY" },
		status: "ok",
		fetchedAt: NOW,
	});
});

test("the global adapter hits api.moonshot.ai with USD", async () => {
	const { fetch } = fakeFetch(
		200,
		JSON.stringify(loadFixture("balance-ok-usd.json")),
	);
	const snap = await new KimiAdapter("kimi").fetchUsage(CRED, opts(fetch));
	expect(snap.balance).toEqual({
		kind: "prepaid",
		amount: 12.5,
		currency: "USD",
	});
});

test("PI_KIMI_USAGE_ENDPOINT / PI_KIMI_CN_USAGE_ENDPOINT overrides replace the URLs", async () => {
	const { fetch, calls } = fakeFetch(
		200,
		JSON.stringify(loadFixture("balance-ok-cny.json")),
	);
	await new KimiAdapter("kimi").fetchUsage(
		CRED,
		opts(fetch, { endpoints: { kimi: "https://mirror.example/balance" } }),
	);
	await new KimiAdapter("kimi-cn").fetchUsage(
		CRED,
		opts(fetch, {
			endpoints: { "kimi-cn": "https://mirror2.example/balance" },
		}),
	);
	expect(calls[0]?.url).toBe("https://mirror.example/balance");
	expect(calls[1]?.url).toBe("https://mirror2.example/balance");
});

test("abort signal is forwarded", async () => {
	const { fetch, calls } = fakeFetch(
		200,
		JSON.stringify(loadFixture("balance-ok-cny.json")),
	);
	const controller = new AbortController();
	await new KimiAdapter("kimi-cn").fetchUsage(
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
		const { fetch } = fakeFetch(status, '{"error":{"message":"x"}}');
		const snap = await new KimiAdapter("kimi-cn").fetchUsage(CRED, opts(fetch));
		expect(snap.status).toBe("error");
		expect(snap.error).toBe(expected);
		expect(snap.windows).toEqual([]);
	}
});

test("network failure, bad JSON, and bad bodies never throw", async () => {
	const net: FetchLike = async () => {
		throw new Error("dns");
	};
	expect(
		(await new KimiAdapter("kimi-cn").fetchUsage(CRED, opts(net))).error,
	).toBe("unavailable (network)");

	const parse = fakeFetch(200, "not json at all");
	expect(
		(await new KimiAdapter("kimi-cn").fetchUsage(CRED, opts(parse.fetch)))
			.error,
	).toBe("unavailable (parse)");

	const body = fakeFetch(
		200,
		JSON.stringify(loadFixture("balance-error-code.json")),
	);
	expect(
		(await new KimiAdapter("kimi-cn").fetchUsage(CRED, opts(body.fetch))).error,
	).toBe("unavailable (body)");
});
