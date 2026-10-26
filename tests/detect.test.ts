import { describe, expect, it } from "vitest";
import { detectRoute, PLAN_HOSTS, planDisplayLabel } from "../src/detect.js";
import type { UsageBarConfig } from "../src/types.js";

const noMap: UsageBarConfig["providerMap"] = {};

describe("PLAN_HOSTS", () => {
	it("maps every builtin pi provider id to its plan and first-party hosts", () => {
		expect(PLAN_HOSTS.openai).toEqual({
			plan: "codex",
			hosts: ["chatgpt.com", "api.openai.com"],
		});
		expect(PLAN_HOSTS["openai-codex"]).toEqual({
			plan: "codex",
			hosts: ["chatgpt.com"],
		});
		expect(PLAN_HOSTS.anthropic).toEqual({
			plan: "claude",
			hosts: ["api.anthropic.com"],
		});
		expect(PLAN_HOSTS.zai).toEqual({ plan: "zai", hosts: ["api.z.ai"] });
		expect(PLAN_HOSTS["zai-coding-cn"]).toEqual({
			plan: "zai-cn",
			hosts: ["open.bigmodel.cn"],
		});
		expect(PLAN_HOSTS.minimax).toEqual({
			plan: "minimax",
			hosts: ["api.minimax.io"],
		});
		expect(PLAN_HOSTS["minimax-cn"]).toEqual({
			plan: "minimax-cn",
			hosts: ["api.minimaxi.com"],
		});
	});
});

describe("detectRoute: manual providerMap wins", () => {
	it("a string plan overrides builtin detection", () => {
		expect(
			detectRoute("anthropic", "https://api.anthropic.com", {
				anthropic: "codex",
			}),
		).toEqual({
			plan: "codex",
			source: "manual",
		});
	});

	it("a relay object maps to the relay plan", () => {
		expect(
			detectRoute("my-relay", "https://relay.example.com/v1", {
				"my-relay": { type: "relay" },
			}),
		).toEqual({ plan: "relay", source: "manual" });
	});

	it("a manual relay mapping wins even for a builtin id", () => {
		expect(
			detectRoute("openai", undefined, { openai: { type: "relay" } }),
		).toEqual({
			plan: "relay",
			source: "manual",
		});
	});

	it("an invalid manual value falls through to auto-detection", () => {
		expect(
			detectRoute("anthropic", undefined, { anthropic: "not-a-plan" }),
		).toEqual({
			plan: "claude",
			source: "builtin",
		});
	});
});

describe("detectRoute: builtin table", () => {
	it("matches when baseUrl is absent", () => {
		expect(detectRoute("openai", undefined, noMap)).toEqual({
			plan: "codex",
			source: "builtin",
		});
	});

	it("matches first-party hosts", () => {
		expect(
			detectRoute("openai", "https://chatgpt.com/backend-api/codex", noMap),
		).toEqual({
			plan: "codex",
			source: "builtin",
		});
		expect(detectRoute("openai", "https://api.openai.com/v1", noMap)).toEqual({
			plan: "codex",
			source: "builtin",
		});
	});

	it("matches hostname case-insensitively", () => {
		expect(
			detectRoute("anthropic", "HTTPS://API.ANTHROPIC.COM/v1/messages", noMap),
		).toEqual({
			plan: "claude",
			source: "builtin",
		});
	});

	it("treats an empty baseUrl as absent", () => {
		expect(detectRoute("zai", "", noMap)).toEqual({
			plan: "zai",
			source: "builtin",
		});
	});

	it("legacy openai-codex maps to codex on chatgpt.com only", () => {
		expect(
			detectRoute("openai-codex", "https://chatgpt.com/backend-api", noMap),
		).toEqual({
			plan: "codex",
			source: "builtin",
		});
		expect(
			detectRoute("openai-codex", "https://api.openai.com/v1", noMap),
		).toEqual({
			plan: "relay",
			source: "relay-probe",
		});
	});
});

describe("detectRoute: host mismatch and custom ids", () => {
	it("blocks the builtin plan when the host is not first-party", () => {
		expect(
			detectRoute("openai", "https://proxy.example.com/v1", noMap),
		).toEqual({
			plan: "relay",
			source: "relay-probe",
		});
	});

	it("treats an unparseable baseUrl as host mismatch", () => {
		expect(detectRoute("zai", "not a url at all", noMap)).toEqual({
			plan: "relay",
			source: "relay-probe",
		});
	});

	it("routes unknown custom ids to relay auto-probe even on vendor hosts", () => {
		expect(
			detectRoute(
				"cc-switch-zhipu-glm",
				"https://open.bigmodel.cn/api/coding/paas/v4",
				noMap,
			),
		).toEqual({ plan: "relay", source: "relay-probe" });
	});

	it("returns null only for an empty provider id", () => {
		expect(detectRoute("", undefined, noMap)).toBeNull();
	});
});

describe("planDisplayLabel", () => {
	it("labels every plan kind", () => {
		expect(planDisplayLabel("codex")).toBe("Codex");
		expect(planDisplayLabel("claude")).toBe("Claude");
		expect(planDisplayLabel("zai")).toBe("ZAI");
		expect(planDisplayLabel("zai-cn")).toBe("ZAI CN");
		expect(planDisplayLabel("minimax")).toBe("MiniMax");
		expect(planDisplayLabel("minimax-cn")).toBe("MiniMax CN");
		expect(planDisplayLabel("relay")).toBe("Relay");
	});
});
