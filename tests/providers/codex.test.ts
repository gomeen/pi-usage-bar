import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	CODEX_USAGE_ENDPOINT,
	codexAdapter,
	createCodexAdapter,
	durationLabel,
	parseCodexUsage,
} from "../../src/providers/codex";
import type { FetchLike, FetchOpts, ProviderCredential } from "../../src/types";

const NOW = 1_760_000_000_000;
const PROVIDER = "openai";

function fixtureText(name: string): string {
	return readFileSync(
		new URL(`../fixtures/codex/${name}`, import.meta.url),
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

const CRED: ProviderCredential = { token: "tok-codex" };

describe("parseCodexUsage", () => {
	it("parses a plus payload with 5h primary and 7d secondary windows", () => {
		const snap = parseCodexUsage(fixtureJson("plus-5h-7d.json"), PROVIDER, NOW);
		expect(snap.status).toBe("ok");
		expect(snap.provider).toBe(PROVIDER);
		expect(snap.plan).toBe("codex");
		expect(snap.fetchedAt).toBe(NOW);
		expect(snap.balance).toBeUndefined();
		expect(snap.windows).toEqual([
			{
				label: "5h",
				percent: 42,
				resetsAt: 1_750_000_000_000,
				durationSeconds: 18000,
			},
			{
				label: "7d",
				percent: 67,
				resetsAt: 1_750_300_000_000,
				durationSeconds: 604800,
			},
		]);
	});

	it("parses a weekly-only account with the weekly window in the primary slot", () => {
		const snap = parseCodexUsage(
			fixtureJson("pro-weekly-only.json"),
			PROVIDER,
			NOW,
		);
		expect(snap.status).toBe("ok");
		expect(snap.windows).toEqual([
			{
				label: "7d",
				percent: 23,
				resetsAt: 1_750_500_000_000,
				durationSeconds: 604800,
			},
		]);
	});

	it("falls back to reset_after_seconds when reset_at is missing or zero", () => {
		const snap = parseCodexUsage(
			fixtureJson("reset-after-fallback.json"),
			PROVIDER,
			NOW,
		);
		const [primary, secondary] = snap.windows;
		expect(primary?.resetsAt).toBe(NOW + 900_000);
		expect(secondary?.resetsAt).toBeNull();
	});

	it("labels odd durations from the real window length", () => {
		const snap = parseCodexUsage(
			fixtureJson("odd-duration.json"),
			PROVIDER,
			NOW,
		);
		expect(snap.windows[0]).toEqual({
			label: "2h",
			percent: 8,
			resetsAt: 1_750_003_000_000,
			durationSeconds: 7200,
		});
		expect(snap.windows[1]).toEqual({
			label: "3d",
			percent: 90,
			resetsAt: 1_750_200_000_000,
			durationSeconds: 259200,
		});
	});

	it("parses a workspace credits balance from string and number forms", () => {
		const snap = parseCodexUsage(
			fixtureJson("workspace-credits.json"),
			PROVIDER,
			NOW,
		);
		expect(snap.balance).toEqual({ kind: "credits", amount: 12.5 });

		const numeric = structuredClone(fixtureJson("workspace-credits.json")) as {
			credits?: { balance?: string | number };
		};
		if (numeric.credits) {
			numeric.credits.balance = 7.25;
		}
		const numericSnap = parseCodexUsage(numeric, PROVIDER, NOW);
		expect(numericSnap.balance).toEqual({ kind: "credits", amount: 7.25 });

		const noCredits = parseCodexUsage(
			fixtureJson("plus-5h-7d.json"),
			PROVIDER,
			NOW,
		);
		expect(noCredits.balance).toBeUndefined();
	});

	it("treats a null rate_limit as ok with zero windows", () => {
		const snap = parseCodexUsage(
			fixtureJson("null-rate-limit.json"),
			PROVIDER,
			NOW,
		);
		expect(snap.status).toBe("ok");
		expect(snap.windows).toEqual([]);
	});

	it("rejects non-object payloads without throwing", () => {
		for (const bad of [null, 42, "nope", [], true]) {
			const snap = parseCodexUsage(bad, PROVIDER, NOW);
			expect(snap.status).toBe("error");
			expect(snap.error).toBe("unavailable (bad payload)");
			expect(snap.windows).toEqual([]);
		}
	});
});

describe("durationLabel", () => {
	it("maps real durations to labels", () => {
		expect(durationLabel(18000)).toBe("5h");
		expect(durationLabel(604800)).toBe("7d");
		expect(durationLabel(7200)).toBe("2h");
		expect(durationLabel(2700)).toBe("45m");
		expect(durationLabel(259200)).toBe("3d");
		expect(durationLabel(null)).toBe("I");
	});
});

describe("codexAdapter.fetchUsage", () => {
	it("sends bearer token, header passthrough, and signal; parses the body", async () => {
		expect(codexAdapter.plan).toBe("codex");
		const { impl, calls } = makeFetch(200, fixtureText("plus-5h-7d.json"));
		const controller = new AbortController();
		const snap = await createCodexAdapter(PROVIDER).fetchUsage(
			{ token: "tok-codex", headers: { "ChatGPT-Account-Id": "acct-123" } },
			makeOpts(impl, controller.signal),
		);
		expect(snap.status).toBe("ok");
		expect(snap.provider).toBe(PROVIDER);
		expect(snap.fetchedAt).toBe(NOW);
		expect(snap.windows).toHaveLength(2);
		const call = calls[0];
		expect(call?.url).toBe(CODEX_USAGE_ENDPOINT);
		expect(call?.headers).toEqual({
			Authorization: "Bearer tok-codex",
			"ChatGPT-Account-Id": "acct-123",
		});
		expect(call?.signal).toBe(controller.signal);
	});

	it("maps 429 to unavailable (429)", async () => {
		const { impl } = makeFetch(429, fixtureText("429.json"));
		const snap = await codexAdapter.fetchUsage(CRED, makeOpts(impl));
		expect(snap).toEqual({
			provider: "openai",
			plan: "codex",
			windows: [],
			status: "error",
			error: "unavailable (429)",
			fetchedAt: NOW,
		});
	});

	it("maps 401 and 403 to unauthorized", async () => {
		const unauthorized = await codexAdapter.fetchUsage(
			CRED,
			makeOpts(makeFetch(401, "").impl),
		);
		expect(unauthorized.status).toBe("error");
		expect(unauthorized.error).toBe("unauthorized");
		const forbidden = await codexAdapter.fetchUsage(
			CRED,
			makeOpts(makeFetch(403, "").impl),
		);
		expect(forbidden.error).toBe("unauthorized");
	});

	it("maps other HTTP failures to unavailable (status)", async () => {
		const snap = await codexAdapter.fetchUsage(
			CRED,
			makeOpts(makeFetch(503, "").impl),
		);
		expect(snap.status).toBe("error");
		expect(snap.error).toBe("unavailable (503)");
	});

	it("maps malformed JSON to unavailable (bad payload)", async () => {
		const snap = await codexAdapter.fetchUsage(
			CRED,
			makeOpts(makeFetch(200, "{oops").impl),
		);
		expect(snap.status).toBe("error");
		expect(snap.error).toBe("unavailable (bad payload)");
	});

	it("never throws when fetch itself fails", async () => {
		const impl: FetchLike = async () => {
			throw new Error("boom");
		};
		const snap = await codexAdapter.fetchUsage(CRED, makeOpts(impl));
		expect(snap.status).toBe("error");
		expect(snap.error).toBe("unavailable (network)");
	});
});
