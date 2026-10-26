import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	ANTHROPIC_OAUTH_BETA,
	CLAUDE_USAGE_ENDPOINT,
	claudeAdapter,
	createClaudeAdapter,
	parseClaudeUsage,
} from "../../src/providers/claude";
import type { FetchLike, FetchOpts, ProviderCredential } from "../../src/types";

const NOW = 1_760_000_000_000;
const PROVIDER = "anthropic";

function fixtureText(name: string): string {
	return readFileSync(
		new URL(`../fixtures/claude/${name}`, import.meta.url),
		"utf8",
	);
}

function fixtureJson(name: string): unknown {
	return JSON.parse(fixtureText(name)) as unknown;
}

interface CapturedCall {
	url: string;
	headers: Record<string, string> | undefined;
	signal: AbortSignal | undefined;
}

function makeFetch(
	status: number,
	body: string,
): { impl: FetchLike; calls: CapturedCall[] } {
	const calls: CapturedCall[] = [];
	const impl: FetchLike = async (url, init) => {
		calls.push({ url, headers: init?.headers, signal: init?.signal });
		return {
			ok: status >= 200 && status < 300,
			status,
			headers: {},
			text: async () => body,
		};
	};
	return { impl, calls };
}

function makeOpts(impl: FetchLike, signal?: AbortSignal): FetchOpts {
	return {
		endpoints: {},
		now: NOW,
		fetchImpl: impl,
		...(signal ? { signal } : {}),
	};
}

const CRED: ProviderCredential = { token: "tok-claude" };

describe("parseClaudeUsage", () => {
	it("parses the flat five_hour/seven_day shape", () => {
		const snap = parseClaudeUsage(
			fixtureJson("claude-flat.json"),
			PROVIDER,
			NOW,
		);
		expect(snap.status).toBe("ok");
		expect(snap.provider).toBe(PROVIDER);
		expect(snap.plan).toBe("claude");
		expect(snap.fetchedAt).toBe(NOW);
		expect(snap.windows).toEqual([
			{
				label: "5h",
				percent: 25,
				resetsAt: Date.parse("2026-01-28T15:00:00Z"),
				durationSeconds: 18000,
			},
			{
				label: "7d",
				percent: 40,
				resetsAt: Date.parse("2026-02-01T00:00:00Z"),
				durationSeconds: 604800,
			},
		]);
	});

	it("falls back seven_day -> seven_day_opus -> seven_day_sonnet", () => {
		const opusWins = parseClaudeUsage(
			fixtureJson("claude-flat-model-fallback.json"),
			PROVIDER,
			NOW,
		);
		expect(opusWins.windows).toHaveLength(2);
		expect(opusWins.windows[1]).toEqual({
			label: "7d",
			percent: 0,
			resetsAt: Date.parse("2026-02-02T09:00:00Z"),
			durationSeconds: 604800,
		});

		const withoutOpus = structuredClone(
			fixtureJson("claude-flat-model-fallback.json"),
		) as Record<string, unknown>;
		delete withoutOpus.seven_day_opus;
		const sonnetWins = parseClaudeUsage(withoutOpus, PROVIDER, NOW);
		expect(sonnetWins.windows[1]?.percent).toBe(60);

		const withoutBoth = structuredClone(
			fixtureJson("claude-flat-model-fallback.json"),
		) as Record<string, unknown>;
		delete withoutBoth.seven_day_opus;
		delete withoutBoth.seven_day_sonnet;
		const fiveHourOnly = parseClaudeUsage(withoutBoth, PROVIDER, NOW);
		expect(fiveHourOnly.windows).toHaveLength(1);
		expect(fiveHourOnly.windows[0]?.label).toBe("5h");
	});

	it("parses the limits[] shape session-first, skipping weekly_scoped", () => {
		const snap = parseClaudeUsage(
			fixtureJson("claude-limits-array.json"),
			PROVIDER,
			NOW,
		);
		expect(snap.status).toBe("ok");
		expect(snap.windows).toEqual([
			{
				label: "5h",
				percent: 25,
				resetsAt: Date.parse("2026-01-28T15:00:00Z"),
				durationSeconds: 18000,
			},
			{
				label: "7d",
				percent: 40,
				resetsAt: Date.parse("2026-02-01T00:00:00Z"),
				durationSeconds: 604800,
			},
		]);
	});

	it("prefers limits[] when both shapes are present", () => {
		const snap = parseClaudeUsage(
			fixtureJson("claude-both-shapes.json"),
			PROVIDER,
			NOW,
		);
		expect(snap.windows[0]?.percent).toBe(30);
		expect(snap.windows[1]?.percent).toBe(45);
	});

	it("keeps burnout values above 100 as-is", () => {
		const snap = parseClaudeUsage(
			fixtureJson("claude-burnout.json"),
			PROVIDER,
			NOW,
		);
		expect(snap.windows[0]?.percent).toBe(120);
		expect(snap.windows[1]?.percent).toBe(105);
	});

	it("defends against 0-1 decimal utilization", () => {
		const snap = parseClaudeUsage(
			fixtureJson("claude-decimal.json"),
			PROVIDER,
			NOW,
		);
		expect(snap.windows[0]?.percent).toBe(50);
		expect(snap.windows[1]?.percent).toBe(25);

		const integerOne = structuredClone(fixtureJson("claude-decimal.json")) as {
			five_hour?: { utilization?: number };
		};
		if (integerOne.five_hour) {
			integerOne.five_hour.utilization = 1;
		}
		const snapOne = parseClaudeUsage(integerOne, PROVIDER, NOW);
		expect(snapOne.windows[0]?.percent).toBe(1);
	});

	it("skips placeholder limits entries (percent 0, no reset)", () => {
		const snap = parseClaudeUsage(
			fixtureJson("claude-limits-placeholder.json"),
			PROVIDER,
			NOW,
		);
		expect(snap.status).toBe("ok");
		expect(snap.windows).toEqual([]);
	});

	it("treats null buckets as conclusively missing (enterprise), not an error", () => {
		const snap = parseClaudeUsage(
			fixtureJson("claude-enterprise-null.json"),
			PROVIDER,
			NOW,
		);
		expect(snap.status).toBe("ok");
		expect(snap.windows).toEqual([]);
	});

	it("rejects non-object payloads without throwing", () => {
		for (const bad of [null, 42, "nope", [], true]) {
			const snap = parseClaudeUsage(bad, PROVIDER, NOW);
			expect(snap.status).toBe("error");
			expect(snap.error).toBe("unavailable (bad payload)");
			expect(snap.windows).toEqual([]);
		}
	});
});

describe("claudeAdapter.fetchUsage", () => {
	it("sends bearer token, mandatory beta header, merged headers, and signal", async () => {
		expect(claudeAdapter.plan).toBe("claude");
		const { impl, calls } = makeFetch(200, fixtureText("claude-flat.json"));
		const controller = new AbortController();
		const snap = await createClaudeAdapter(PROVIDER).fetchUsage(
			{ token: "tok-claude", headers: { "x-custom": "1" } },
			makeOpts(impl, controller.signal),
		);
		expect(snap.status).toBe("ok");
		expect(snap.provider).toBe(PROVIDER);
		expect(snap.fetchedAt).toBe(NOW);
		expect(snap.windows).toEqual(
			parseClaudeUsage(fixtureJson("claude-flat.json"), PROVIDER, NOW).windows,
		);
		const call = calls[0];
		expect(call?.url).toBe(CLAUDE_USAGE_ENDPOINT);
		expect(call?.headers).toEqual({
			"x-custom": "1",
			Authorization: "Bearer tok-claude",
			"anthropic-beta": ANTHROPIC_OAUTH_BETA,
		});
		expect(call?.signal).toBe(controller.signal);
	});

	it("maps 429 to unavailable (429)", async () => {
		const { impl } = makeFetch(429, fixtureText("claude-429.json"));
		const snap = await claudeAdapter.fetchUsage(CRED, makeOpts(impl));
		expect(snap).toEqual({
			provider: "anthropic",
			plan: "claude",
			windows: [],
			status: "error",
			error: "unavailable (429)",
			fetchedAt: NOW,
		});
	});

	it("maps 401 to unauthorized", async () => {
		const snap = await claudeAdapter.fetchUsage(
			CRED,
			makeOpts(makeFetch(401, "").impl),
		);
		expect(snap.status).toBe("error");
		expect(snap.error).toBe("unauthorized");
	});

	it("maps other HTTP failures to unavailable (status)", async () => {
		const snap = await claudeAdapter.fetchUsage(
			CRED,
			makeOpts(makeFetch(500, "").impl),
		);
		expect(snap.error).toBe("unavailable (500)");
	});

	it("maps malformed JSON to unavailable (bad payload)", async () => {
		const snap = await claudeAdapter.fetchUsage(
			CRED,
			makeOpts(makeFetch(200, "not json").impl),
		);
		expect(snap.status).toBe("error");
		expect(snap.error).toBe("unavailable (bad payload)");
	});

	it("never throws when fetch itself fails", async () => {
		const impl: FetchLike = async () => {
			throw new Error("boom");
		};
		const snap = await claudeAdapter.fetchUsage(CRED, makeOpts(impl));
		expect(snap.status).toBe("error");
		expect(snap.error).toBe("unavailable (network)");
	});
});
