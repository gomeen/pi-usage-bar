/**
 * Codex (ChatGPT subscription) usage provider.
 *
 * Fetches the fixed first-party `/wham/usage` endpoint with the provider's
 * OAuth bearer token (plus header passthrough such as `ChatGPT-Account-Id`)
 * and turns the payload into a `UsageSnapshot`. Parsing is a pure function;
 * IO is confined to `fetchUsage`. Contract: research/codex-usage-api.md.
 */

import type {
	Balance,
	FetchOpts,
	ProviderAdapter,
	ProviderCredential,
	QuotaWindow,
	UsageSnapshot,
} from "../types";

/** Fixed to the first-party ChatGPT backend (research: no env override). */
export const CODEX_USAGE_ENDPOINT =
	"https://chatgpt.com/backend-api/wham/usage";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Accepts numbers and numeric strings; null when absent or not finite. */
function toFiniteNumber(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) {
			return null;
		}
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

/**
 * Window label from the window's real duration (issue 013):
 * 18000s -> "5h", 604800s -> "7d", other durations verbatim ("45m", "2h",
 * "3d"). Unknown duration falls back to "I" — never invent a label.
 */
export function durationLabel(durationSeconds: number | null): string {
	if (durationSeconds === null || durationSeconds <= 0) {
		return "I";
	}
	if (durationSeconds < 3600) {
		return `${Math.round(durationSeconds / 60)}m`;
	}
	if (durationSeconds < 86400) {
		return `${Math.round(durationSeconds / 3600)}h`;
	}
	return `${Math.round(durationSeconds / 86400)}d`;
}

function errorSnapshot(
	provider: string,
	error: string,
	now: number,
): UsageSnapshot {
	return {
		provider,
		plan: "codex",
		windows: [],
		status: "error",
		error,
		fetchedAt: now,
	};
}

function parseCodexWindow(raw: unknown, now: number): QuotaWindow | null {
	if (!isRecord(raw)) {
		return null;
	}
	const percent = toFiniteNumber(raw.used_percent);
	const duration = toFiniteNumber(raw.limit_window_seconds);
	const durationSeconds = duration !== null && duration > 0 ? duration : null;
	const resetAt = toFiniteNumber(raw.reset_at);
	const resetAfter = toFiniteNumber(raw.reset_after_seconds);
	let resetsAt: number | null = null;
	if (resetAt !== null && resetAt > 0) {
		// reset_at is Unix epoch seconds (research §4), not ISO 8601.
		resetsAt = resetAt * 1000;
	} else if (resetAfter !== null) {
		resetsAt = now + resetAfter * 1000;
	}
	return {
		label: durationLabel(durationSeconds),
		percent,
		resetsAt,
		durationSeconds,
	};
}

/**
 * Pure Codex payload parser. `plan_type` is ignored for display; `rate_limit`
 * may be null entirely (absent windows are common — hide, never show 0%);
 * windows are emitted primary-first. Never throws: non-object payloads
 * become error snapshots.
 */
export function parseCodexUsage(
	payload: unknown,
	provider: string,
	now: number,
): UsageSnapshot {
	if (!isRecord(payload)) {
		return errorSnapshot(provider, "unavailable (bad payload)", now);
	}
	const windows: QuotaWindow[] = [];
	const rateLimit = isRecord(payload.rate_limit) ? payload.rate_limit : null;
	if (rateLimit) {
		const primary = parseCodexWindow(rateLimit.primary_window, now);
		if (primary) {
			windows.push(primary);
		}
		const secondary = parseCodexWindow(rateLimit.secondary_window, now);
		if (secondary) {
			windows.push(secondary);
		}
	}
	let balance: Balance | undefined;
	if (isRecord(payload.credits) && payload.credits.has_credits) {
		// balance is a string or number on the wire
		const amount = toFiniteNumber(payload.credits.balance);
		if (amount !== null) {
			balance = { kind: "credits", amount };
		}
	}
	return {
		provider,
		plan: "codex",
		windows,
		...(balance !== undefined ? { balance } : {}),
		status: "ok",
		fetchedAt: now,
	};
}

async function fetchCodexUsage(
	cred: ProviderCredential,
	opts: FetchOpts,
	provider: string,
): Promise<UsageSnapshot> {
	try {
		const headers: Record<string, string> = {
			...cred.headers,
			Authorization: `Bearer ${cred.token}`,
		};
		const response = await opts.fetchImpl(CODEX_USAGE_ENDPOINT, {
			headers,
			...(opts.signal ? { signal: opts.signal } : {}),
		});
		if (!response.ok || response.status === 429) {
			if (response.status === 429) {
				return errorSnapshot(provider, "unavailable (429)", opts.now);
			}
			if (response.status === 401 || response.status === 403) {
				return errorSnapshot(provider, "unauthorized", opts.now);
			}
			return errorSnapshot(
				provider,
				`unavailable (${response.status})`,
				opts.now,
			);
		}
		const text = await response.text();
		try {
			return parseCodexUsage(JSON.parse(text), provider, opts.now);
		} catch {
			return errorSnapshot(provider, "unavailable (bad payload)", opts.now);
		}
	} catch {
		// Network-level failure. Never throw, never leak details or secrets.
		return errorSnapshot(provider, "unavailable (network)", opts.now);
	}
}

/** Adapter bound to one pi provider id (echoed into snapshot.provider). */
export function createCodexAdapter(provider: string): ProviderAdapter {
	return {
		plan: "codex",
		fetchUsage: (cred, opts) => fetchCodexUsage(cred, opts, provider),
	};
}

/** Default adapter for the primary Codex provider id (issue 008: `openai`). */
export const codexAdapter: ProviderAdapter = createCodexAdapter("openai");
