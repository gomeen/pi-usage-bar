/**
 * Fixture-driven tests for the ZAI provider adapter (tests/fixtures/zai/).
 * Parse is tested as a pure function; fetchUsage is exercised with a fake
 * fetchImpl. Node imports are test-only — the provider itself stays portable.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
	durationLabel,
	parseZaiUsage,
	ZAI_ENDPOINTS,
	ZaiAdapter,
} from "../../src/providers/zai";
import type { FetchLike } from "../../src/types";

const fixtures = join(import.meta.dirname, "..", "fixtures", "zai");

function loadFixture(name: string): unknown {
	return JSON.parse(readFileSync(join(fixtures, name), "utf8"));
}

const NOW = 1776576000000;
const CRED = { token: "test-token" };

interface RecordedCall {
	url: string;
	authorization: string | undefined;
}

function fakeFetch(
	status: number,
	body: string,
): { fetch: FetchLike; calls: RecordedCall[] } {
	const calls: RecordedCall[] = [];
	const impl: FetchLike = async (url, init) => {
		calls.push({ url, authorization: init?.headers?.Authorization });
		return { ok: status === 200, status, headers: {}, text: async () => body };
	};
	return { fetch: impl, calls };
}

test("durationLabel uses the issue-013 wordlist", () => {
	expect(durationLabel(18000)).toBe("5h");
	expect(durationLabel(604800)).toBe("7d");
	expect(durationLabel(7200)).toBe("2h");
	expect(durationLabel(259200)).toBe("72h");
	expect(durationLabel(1209600)).toBe("14d");
	expect(durationLabel(5400)).toBe("1.5h");
});

test("parses the 5h and weekly units, skips TIME_LIMIT, reads epoch-ms resets", () => {
	const snapshot = parseZaiUsage(loadFixture("quota-ok.json"), "zai", NOW);
	expect(snapshot.status).toBe("ok");
	expect(snapshot.provider).toBe("zai");
	expect(snapshot.plan).toBe("zai");
	expect(snapshot.fetchedAt).toBe(NOW);
	expect(snapshot.windows).toEqual([
		{
			label: "5h",
			percent: 15,
			resetsAt: 1776586800000,
			durationSeconds: 18000,
		},
		{
			label: "7d",
			percent: 42,
			resetsAt: 1777000000000,
			durationSeconds: 604800,
		},
	]);
});

test("maps the zai-cn provider id to the China plan", () => {
	const snapshot = parseZaiUsage(loadFixture("quota-ok.json"), "zai-cn", NOW);
	expect(snapshot.plan).toBe("zai-cn");
	expect(snapshot.provider).toBe("zai-cn");
});

test("envelope failure (success=false / non-success code) is a short error", () => {
	const snapshot = parseZaiUsage(
		loadFixture("envelope-error.json"),
		"zai",
		NOW,
	);
	expect(snapshot.status).toBe("error");
	expect(snapshot.error).toBe("unavailable (100423)");
	expect(snapshot.windows).toEqual([]);
});

test("defends resetTime / reset_time epoch variants with unit sniffing", () => {
	const snapshot = parseZaiUsage(
		loadFixture("reset-variants.json"),
		"zai",
		NOW,
	);
	expect(snapshot.status).toBe("ok");
	expect(snapshot.windows[0]?.resetsAt).toBe(1770568000000);
	expect(snapshot.windows[1]?.resetsAt).toBe(1771000800000);
});

test("empty data (team scope) is ok with no windows, not an error", () => {
	const snapshot = parseZaiUsage(
		{ code: 200, msg: "success", success: true, data: {} },
		"zai",
		NOW,
	);
	expect(snapshot.status).toBe("ok");
	expect(snapshot.windows).toEqual([]);
});

test("non-object payload is an error", () => {
	const snapshot = parseZaiUsage("nope", "zai", NOW);
	expect(snapshot.status).toBe("error");
	expect(snapshot.error).toBe("unavailable (body)");
});

test("fetchUsage hits the default endpoint with Bearer auth and parses the body", async () => {
	const body = JSON.stringify(loadFixture("quota-ok.json"));
	const { fetch, calls } = fakeFetch(200, body);
	const snapshot = await new ZaiAdapter("zai").fetchUsage(CRED, {
		endpoints: {},
		now: NOW,
		fetchImpl: fetch,
	});
	expect(calls).toEqual([
		{ url: ZAI_ENDPOINTS.zai, authorization: "Bearer test-token" },
	]);
	expect(snapshot.status).toBe("ok");
	expect(snapshot.windows).toHaveLength(2);
	expect(snapshot.fetchedAt).toBe(NOW);
});

test("fetchUsage honors endpoint overrides and maps HTTP 401 to an error", async () => {
	const { fetch, calls } = fakeFetch(401, "{}");
	const snapshot = await new ZaiAdapter("zai-cn").fetchUsage(CRED, {
		endpoints: { "zai-cn": "https://example.test/quota" },
		now: NOW,
		fetchImpl: fetch,
	});
	expect(calls[0]?.url).toBe("https://example.test/quota");
	expect(snapshot.status).toBe("error");
	expect(snapshot.error).toBe("unavailable (401)");
});

test("fetchUsage maps a thrown fetch to a network error", async () => {
	const impl: FetchLike = async () => {
		throw new Error("boom");
	};
	const snapshot = await new ZaiAdapter("zai").fetchUsage(CRED, {
		endpoints: {},
		now: NOW,
		fetchImpl: impl,
	});
	expect(snapshot.status).toBe("error");
	expect(snapshot.error).toBe("unavailable (network)");
});
