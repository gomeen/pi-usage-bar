import { describe, expect, it } from "vitest";
import {
	configFilePath,
	loadConfig,
	resolveEndpointOverrides,
	sparseSave,
	validateConfig,
} from "../src/config.js";
import type { UsageBarConfig } from "../src/types.js";
import { DEFAULT_CONFIG } from "../src/types.js";

/** loadConfig against an inline file body; no filesystem involved. */
const loadJson = (body: string | undefined): UsageBarConfig =>
	loadConfig(() => body);

/** sparseSave into a captured string, also capturing the target path. */
function saveToString(cfg: UsageBarConfig): { path: string; body: string } {
	let path = "";
	let body = "";
	sparseSave(
		cfg,
		(p, s) => {
			path = p;
			body = s;
		},
		"/cfg/usage-bar.json",
	);
	return { path, body };
}

describe("configFilePath", () => {
	it("returns the explicit path when given", () => {
		expect(configFilePath("/custom/path.json")).toBe("/custom/path.json");
	});

	it("defaults to ~/.pi/agent/usage-bar.json", () => {
		expect(configFilePath()).toMatch(/\/\.pi\/agent\/usage-bar\.json$/);
	});
});

describe("loadConfig", () => {
	it("returns defaults for a missing file", () => {
		expect(loadJson(undefined)).toEqual(DEFAULT_CONFIG);
	});

	it("returns defaults for corrupt JSON", () => {
		expect(loadJson("{ not json")).toEqual(DEFAULT_CONFIG);
	});

	it("returns defaults for non-object JSON", () => {
		expect(loadJson("[1, 2, 3]")).toEqual(DEFAULT_CONFIG);
	});

	it("returns a defensive copy, not the shared default object", () => {
		const cfg = loadJson(undefined);
		cfg.display.providers.push("codex");
		expect(DEFAULT_CONFIG.display.providers).toEqual([]);
	});

	it("deep-merges display fields onto defaults", () => {
		const cfg = loadJson('{"display": {"providers": ["codex"]}}');
		expect(cfg.display).toEqual({ mode: "all", providers: ["codex"] });
	});

	it("keeps file values for known keys and drops unknown keys", () => {
		const cfg = loadJson('{"style": "classic", "bogus_key": 1}');
		expect(cfg.style).toBe("classic");
		expect("bogus_key" in cfg).toBe(false);
	});
});

describe("validateConfig", () => {
	it("is the identity on an already-valid config", () => {
		expect(validateConfig(DEFAULT_CONFIG)).toEqual(DEFAULT_CONFIG);
	});

	it("clamps refresh_minutes to >= 1", () => {
		expect(loadJson('{"refresh_minutes": 0}').refresh_minutes).toBe(1);
		expect(loadJson('{"refresh_minutes": -5}').refresh_minutes).toBe(1);
		expect(loadJson('{"refresh_minutes": 10}').refresh_minutes).toBe(10);
	});

	it("clamps bar_width into 4..24", () => {
		expect(loadJson('{"bar_width": 100}').bar_width).toBe(24);
		expect(loadJson('{"bar_width": 2}').bar_width).toBe(4);
		expect(loadJson('{"bar_width": 16}').bar_width).toBe(16);
	});

	it("clamps thresholds into 0..100", () => {
		const cfg = loadJson(
			'{"warning_threshold": -10, "critical_threshold": 200}',
		);
		expect(cfg.warning_threshold).toBe(0);
		expect(cfg.critical_threshold).toBe(100);
	});

	it("swaps reversed thresholds", () => {
		const cfg = loadJson('{"warning_threshold": 80, "critical_threshold": 20}');
		expect(cfg.warning_threshold).toBe(20);
		expect(cfg.critical_threshold).toBe(80);
	});

	it("snaps equal thresholds apart", () => {
		const cfg = loadJson('{"warning_threshold": 50, "critical_threshold": 50}');
		expect(cfg.warning_threshold).toBe(50);
		expect(cfg.critical_threshold).toBe(51);
		const top = loadJson(
			'{"warning_threshold": 100, "critical_threshold": 100}',
		);
		expect(top.warning_threshold).toBe(99);
		expect(top.critical_threshold).toBe(100);
	});

	it("validates color overrides as '' or #rrggbb", () => {
		const cfg = loadJson(
			'{"color_ok": "#00ff88", "color_warn": "red", "color_hot": "#12345"}',
		);
		expect(cfg.color_ok).toBe("#00ff88");
		expect(cfg.color_warn).toBe("");
		expect(cfg.color_hot).toBe("");
	});

	it("falls back to defaults for invalid enum values", () => {
		const cfg = loadJson(
			'{"style": "nope", "bar_glyph": "thin", "density": "cozy", "theme": "dark"}',
		);
		expect(cfg.style).toBe("aurora");
		expect(cfg.bar_glyph).toBe("thin");
		expect(cfg.density).toBe("cozy");
		expect(cfg.theme).toBe("graphite");
	});

	it("drops invalid display.providers entries", () => {
		const cfg = loadJson(
			'{"display": {"providers": ["codex", "bogus", "relay", 42]}}',
		);
		expect(cfg.display.providers).toEqual(["codex", "relay"]);
	});

	it("drops invalid providerMap entries", () => {
		const cfg = loadJson(
			'{"providerMap": {"a": "zai-cn", "b": {"type": "relay"}, "c": "bogus", "d": {"type": "other"}, "e": 5}}',
		);
		expect(cfg.providerMap).toEqual({ a: "zai-cn", b: { type: "relay" } });
	});

	it("never throws on garbage-typed fields", () => {
		const cfg = loadJson(
			'{"bar_width": "wide", "display": {"mode": 3}, "providerMap": [], "currency": 7, "show_resets": "yes"}',
		);
		expect(cfg.bar_width).toBe(12);
		expect(cfg.display.mode).toBe("all");
		expect(cfg.providerMap).toEqual({});
		expect(cfg.currency).toBe("$");
		expect(cfg.show_resets).toBe(true);
	});
});

describe("sparseSave", () => {
	it("writes only non-default keys, pretty 2-space, trailing newline", () => {
		const cfg = { ...DEFAULT_CONFIG, bar_width: 20, currency: "¥" };
		expect(saveToString(cfg).body).toBe(
			'{\n  "bar_width": 20,\n  "currency": "¥"\n}\n',
		);
	});

	it("writes the whole nested display object when it differs", () => {
		const cfg: UsageBarConfig = {
			...DEFAULT_CONFIG,
			display: { mode: "active", providers: [] },
		};
		expect(saveToString(cfg).body).toBe(
			'{\n  "display": {\n    "mode": "active",\n    "providers": []\n  }\n}\n',
		);
	});

	it("writes an empty object when everything is default", () => {
		expect(saveToString(DEFAULT_CONFIG).body).toBe("{}\n");
	});

	it("passes configFilePath(pathOverride) to the writer", () => {
		expect(saveToString(DEFAULT_CONFIG).path).toBe("/cfg/usage-bar.json");
	});

	it("roundtrips through loadConfig", () => {
		const cfg: UsageBarConfig = {
			...DEFAULT_CONFIG,
			style: "classic",
			refresh_minutes: 10,
			color_hot: "#ff0000",
			display: { mode: "all", providers: ["relay"] },
			providerMap: { "my-relay": { type: "relay" } },
		};
		const { body } = saveToString(cfg);
		expect(loadJson(body)).toEqual(cfg);
	});
});

describe("resolveEndpointOverrides", () => {
	it("maps every PI_*_ENDPOINT var to its endpoint key", () => {
		const env = {
			PI_ZAI_USAGE_ENDPOINT: "https://a.example/usage",
			PI_ZAI_CODING_CN_USAGE_ENDPOINT: "https://b.example/usage",
			PI_MINIMAX_USAGE_ENDPOINT: "https://c.example/usage",
			PI_MINIMAX_CN_USAGE_ENDPOINT: "https://d.example/usage",
			PI_MINIMAX_LEGACY_USAGE_ENDPOINT: "https://e.example/usage",
			PI_MINIMAX_CN_LEGACY_USAGE_ENDPOINT: "https://f.example/usage",
		};
		expect(resolveEndpointOverrides(env)).toEqual({
			zai: "https://a.example/usage",
			"zai-cn": "https://b.example/usage",
			minimax: "https://c.example/usage",
			"minimax-cn": "https://d.example/usage",
			"minimax-legacy": "https://e.example/usage",
			"minimax-cn-legacy": "https://f.example/usage",
		});
	});

	it("omits absent vars", () => {
		expect(
			resolveEndpointOverrides({ PI_ZAI_USAGE_ENDPOINT: "https://x" }),
		).toEqual({
			zai: "https://x",
		});
	});

	it("returns an empty map for an empty env", () => {
		expect(resolveEndpointOverrides({})).toEqual({});
	});

	it("omits empty-string vars", () => {
		expect(resolveEndpointOverrides({ PI_ZAI_USAGE_ENDPOINT: "" })).toEqual({});
	});
});
