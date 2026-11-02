/**
 * Regression tests for the all-mode candidate expansion (issue 019
 * amendment). The wiring lives in the pi entry (src/index.ts) because it
 * adapts pi's ModelRegistry; the pure half (host matching) is covered in
 * detect.test.ts. These tests pin the ENUMERATION SOURCE: models.json
 * custom ids surface through getAll() (every known model), NOT through
 * getRegisteredProviderIds() (extension-registered providers only).
 */
import { expect, test } from "vitest";
import { firstPartyCandidateIds } from "../src/index.js";
import type { RegistryLike } from "../src/pi/credentials.js";

function registryWith(
	models: readonly { provider: string }[],
	providers: Record<string, { baseUrl?: string }>,
): RegistryLike {
	return {
		getProvider: (id: string) => providers[id],
		getProviderAuthStatus: () => ({ configured: false }),
		getProviderAuth: async () => undefined,
		getAll: () => models,
	};
}

test("discovers a models.json custom id on a first-party Kimi host", () => {
	// The real case behind the bug report: a custom "kimi" provider on the
	// Moonshot CN anthropic surface, inactive while another model is used.
	const registry = registryWith([{ provider: "kimi" }], {
		kimi: { baseUrl: "https://api.moonshot.cn/anthropic" },
	});
	expect(firstPartyCandidateIds(registry)).toEqual(["kimi"]);
});

test("expands every known provider kind, deduplicated by id", () => {
	const registry = registryWith(
		[
			{ provider: "kimi" },
			{ provider: "deepseek" },
			{ provider: "h-self" }, // relay host: never expands
			{ provider: "kimi" }, // duplicate model entries collapse
		],
		{
			kimi: { baseUrl: "https://api.moonshot.cn/anthropic" },
			deepseek: { baseUrl: "https://api.deepseek.com" },
			"h-self": { baseUrl: "https://ai.yuchuantest.com/v1" },
		},
	);
	// deepseek's host is not in FIRST_PARTY_HOSTS (builtin id already a
	// candidate), h-self is a relay — only kimi expands.
	expect(firstPartyCandidateIds(registry)).toEqual(["kimi"]);
});

test("returns nothing without getAll (older pi) or without baseUrls", () => {
	expect(
		firstPartyCandidateIds({
			getProvider: () => undefined,
			getProviderAuthStatus: () => undefined,
			getProviderAuth: async () => undefined,
		}),
	).toEqual([]);
	expect(
		firstPartyCandidateIds(registryWith([{ provider: "kimi" }], { kimi: {} })),
	).toEqual([]);
});
