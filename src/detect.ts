/**
 * Provider detection: pi provider id + baseUrl -> plan (issue 008).
 *
 * Priority: manual providerMap > builtin id/host table > relay auto-probe.
 * Pure module: no pi imports, no node imports — safe in any runtime.
 */
import type { PlanKind, UsageBarConfig } from "./types.js";

/** Every valid plan name (subset check for providerMap and display.providers). */
export const PLAN_KINDS: readonly PlanKind[] = [
	"codex",
	"claude",
	"zai",
	"zai-cn",
	"minimax",
	"minimax-cn",
	"relay",
];

const PLAN_KIND_SET: ReadonlySet<string> = new Set(PLAN_KINDS);

/** Runtime guard for plan names coming from untrusted config JSON. */
export function isPlanKind(value: unknown): value is PlanKind {
	return typeof value === "string" && PLAN_KIND_SET.has(value);
}

/**
 * Builtin pi provider ids (pi 1.4.0, research/pi-extension-api.md §10) mapped to
 * their plan and first-party inference hosts. A builtin id whose baseUrl points
 * elsewhere is billed by a proxy, not the plan (issue 008 §4).
 */
export const PLAN_HOSTS: Record<string, { plan: PlanKind; hosts: string[] }> = {
	openai: { plan: "codex", hosts: ["chatgpt.com", "api.openai.com"] },
	"openai-codex": { plan: "codex", hosts: ["chatgpt.com"] }, // legacy compat
	anthropic: { plan: "claude", hosts: ["api.anthropic.com"] },
	zai: { plan: "zai", hosts: ["api.z.ai"] },
	"zai-coding-cn": { plan: "zai-cn", hosts: ["open.bigmodel.cn"] },
	minimax: { plan: "minimax", hosts: ["api.minimax.io"] },
	"minimax-cn": { plan: "minimax-cn", hosts: ["api.minimaxi.com"] },
};

export type DetectedRoute = {
	plan: PlanKind;
	/** How the route was decided: manual providerMap, builtin id/host table, relay fallback. */
	source: "manual" | "builtin" | "relay-probe";
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Hostname of a baseUrl, lowercased.
 * - undefined: baseUrl absent (undefined or blank) -> caller skips the host check
 * - null: unparseable URL -> guaranteed host mismatch (spec: wrap failures as mismatch)
 */
function baseUrlHost(baseUrl: string | undefined): string | null | undefined {
	if (baseUrl === undefined || baseUrl.trim() === "") return undefined;
	try {
		return new URL(baseUrl).hostname.toLowerCase();
	} catch {
		return null;
	}
}

/**
 * Detect which plan a pi provider id routes to (issue 008 decision log):
 * 1. providerMap manual entry wins — string plan name or `{type: "relay"}`.
 * 2. Builtin table: known id AND (baseUrl absent OR its hostname is first-party).
 * 3. Everything else (custom ids, vendor plans behind a proxy) -> relay auto-probe.
 *
 * Returns null only for an empty providerId; any non-empty id gets a route.
 */
export function detectRoute(
	providerId: string,
	baseUrl: string | undefined,
	providerMap: UsageBarConfig["providerMap"],
): DetectedRoute | null {
	if (providerId === "") return null;

	// 1. Manual mapping wins over everything (manual > auto > probe).
	const manual = providerMap[providerId];
	if (manual !== undefined) {
		if (typeof manual === "string" && isPlanKind(manual)) {
			return { plan: manual, source: "manual" };
		}
		if (isPlainObject(manual) && manual.type === "relay") {
			return { plan: "relay", source: "manual" };
		}
		// Invalid manual value (validateConfig drops these too): fall through.
	}

	// 2. Builtin id with a first-party host (case-insensitive hostname compare).
	const builtin = PLAN_HOSTS[providerId];
	if (builtin !== undefined) {
		const host = baseUrlHost(baseUrl);
		if (
			host === undefined ||
			builtin.hosts.some((h) => h.toLowerCase() === host)
		) {
			return { plan: builtin.plan, source: "builtin" };
		}
		// Known id on a foreign host: the plan's account is not the one being
		// billed — the proxy is. Do NOT claim the builtin plan (issue 008 §4).
	}

	// 3. Relay auto-probe catches all: custom ids and proxied builtins.
	return { plan: "relay", source: "relay-probe" };
}

const PLAN_LABELS: Record<PlanKind, string> = {
	codex: "Codex",
	claude: "Claude",
	zai: "ZAI",
	"zai-cn": "ZAI CN",
	minimax: "MiniMax",
	"minimax-cn": "MiniMax CN",
	relay: "Relay",
};

/** Short human label for a plan, used by the footer and `/usage` view. */
export function planDisplayLabel(plan: PlanKind): string {
	return PLAN_LABELS[plan];
}
