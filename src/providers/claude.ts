/**
 * Claude (Anthropic subscription) usage provider.
 *
 * Fetches the fixed first-party `/api/oauth/usage` endpoint with the
 * provider's OAuth bearer token plus the mandatory `anthropic-beta` header.
 * Accounts are mid-migration between two payload shapes — flat buckets and a
 * `limits[]` array — so the parser accepts both, preferring `limits[]`.
 * Contract: research/claude-usage-api.md.
 */

import type {
	FetchOpts,
	ProviderAdapter,
	ProviderCredential,
	QuotaWindow,
	UsageSnapshot,
} from "../types";

/** Fixed to the first-party Anthropic API (research: no env override). */
export const CLAUDE_USAGE_ENDPOINT =
	"https://api.anthropic.com/api/oauth/usage";

/** Required on OAuth bearer requests (official anthropic-sdk-go constant). */
export const ANTHROPIC_OAUTH_BETA = "oauth-2025-04-20";

const FIVE_HOUR_SECONDS = 18000;
const SEVEN_DAY_SECONDS = 604800;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Normalized utilization percentage. Normally an integer 0-100. Defensive:
 * some accounts once reported 0-1 decimals (x100 when non-integer <= 1).
 * Values above 100 are valid burnout states — passed through, never clamped.
 */
function normalizePercent(value: unknown): number | null {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return null;
	}
	if (!Number.isInteger(value) && value <= 1) {
		return value * 100;
	}
	return value;
}

/** resets_at is an ISO 8601 string on this API (epoch seconds only on stdin). */
function parseIsoReset(value: unknown): number | null {
	if (typeof value !== "string") {
		return null;
	}
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : ms;
}

function errorSnapshot(
	provider: string,
	error: string,
	now: number,
): UsageSnapshot {
	return {
		provider,
		plan: "claude",
		windows: [],
		status: "error",
		error,
		fetchedAt: now,
	};
}

function bucketWindow(
	raw: unknown,
	label: string,
	durationSeconds: number,
): QuotaWindow | null {
	if (!isRecord(raw)) {
		return null;
	}
	return {
		label,
		percent: normalizePercent(raw.utilization),
		resetsAt: parseIsoReset(raw.resets_at),
		durationSeconds,
	};
}

function firstRecord(...values: unknown[]): Record<string, unknown> | null {
	for (const value of values) {
		if (isRecord(value)) {
			return value;
		}
	}
	return null;
}

/** Legacy flat shape: five_hour + weekly bucket (weekly may live in 3 keys). */
function flatWindows(payload: Record<string, unknown>): QuotaWindow[] {
	const windows: QuotaWindow[] = [];
	const fiveHour = bucketWindow(payload.five_hour, "5h", FIVE_HOUR_SECONDS);
	if (fiveHour) {
		windows.push(fiveHour);
	}
	// Weekly preference order (research: keep simple): seven_day, then
	// seven_day_opus, then seven_day_sonnet.
	const weeklyRaw = firstRecord(
		payload.seven_day,
		payload.seven_day_opus,
		payload.seven_day_sonnet,
	);
	const weekly = bucketWindow(weeklyRaw, "7d", SEVEN_DAY_SECONDS);
	if (weekly) {
		windows.push(weekly);
	}
	return windows;
}

function limitWindow(
	entry: Record<string, unknown>,
	label: string,
	durationSeconds: number,
): QuotaWindow | null {
	const percent = normalizePercent(entry.percent);
	const resetsAt = parseIsoReset(entry.resets_at);
	// Placeholder trap (research §2.2): percent 0 with no reset is not a real
	// window (Enterprise/no-quota) — must not render as a true 0% bar.
	if (percent === 0 && resetsAt === null) {
		return null;
	}
	return { label, percent, resetsAt, durationSeconds };
}

/** New shape: limits[] with kind session | weekly_all | weekly_scoped. */
function limitsWindows(raw: unknown): QuotaWindow[] {
	if (!Array.isArray(raw)) {
		return [];
	}
	let session: QuotaWindow | null = null;
	let weekly: QuotaWindow | null = null;
	for (const entry of raw) {
		if (!isRecord(entry)) {
			continue;
		}
		if (entry.kind === "session" && session === null) {
			session = limitWindow(entry, "5h", FIVE_HOUR_SECONDS);
		} else if (entry.kind === "weekly_all" && weekly === null) {
			weekly = limitWindow(entry, "7d", SEVEN_DAY_SECONDS);
		}
		// weekly_scoped (per-model weekly quotas) is out of scope for v1.
	}
	const windows: QuotaWindow[] = [];
	if (session) {
		windows.push(session);
	}
	if (weekly) {
		windows.push(weekly);
	}
	return windows;
}

/**
 * Pure Claude payload parser, accepting both migration shapes. `limits[]`
 * wins when it yields data; empty windows is conclusive missing (e.g.
 * Enterprise), not an error. Never throws.
 */
export function parseClaudeUsage(
	payload: unknown,
	provider: string,
	now: number,
): UsageSnapshot {
	if (!isRecord(payload)) {
		return errorSnapshot(provider, "unavailable (bad payload)", now);
	}
	const fromLimits = limitsWindows(payload.limits);
	const windows = fromLimits.length > 0 ? fromLimits : flatWindows(payload);
	return { provider, plan: "claude", windows, status: "ok", fetchedAt: now };
}

async function fetchClaudeUsage(
	cred: ProviderCredential,
	opts: FetchOpts,
	provider: string,
): Promise<UsageSnapshot> {
	try {
		const headers: Record<string, string> = {
			...cred.headers,
			Authorization: `Bearer ${cred.token}`,
			"anthropic-beta": ANTHROPIC_OAUTH_BETA,
		};
		const response = await opts.fetchImpl(CLAUDE_USAGE_ENDPOINT, {
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
			return parseClaudeUsage(JSON.parse(text), provider, opts.now);
		} catch {
			return errorSnapshot(provider, "unavailable (bad payload)", opts.now);
		}
	} catch {
		// Network-level failure. Never throw, never leak details or secrets.
		return errorSnapshot(provider, "unavailable (network)", opts.now);
	}
}

/** Adapter bound to one pi provider id (echoed into snapshot.provider). */
export function createClaudeAdapter(provider: string): ProviderAdapter {
	return {
		plan: "claude",
		fetchUsage: (cred, opts) => fetchClaudeUsage(cred, opts, provider),
	};
}

/** Default adapter for the Claude provider id (issue 008: `anthropic`). */
export const claudeAdapter: ProviderAdapter = createClaudeAdapter("anthropic");
