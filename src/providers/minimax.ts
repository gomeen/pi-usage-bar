/**
 * MiniMax Token Plan (formerly Coding Plan) provider adapter — international
 * api.minimax.io and China api.minimaxi.com.
 *
 * Data contract: research/minimax-usage-api.md. Display decision (issue 013):
 * percent-only — count fields are never parsed for percent math because the
 * `*_usage_count` semantics flipped between API generations and cannot be
 * disambiguated safely. Reset fallback ladder (issue 014): explicit epoch
 * timestamps first, then remains-time with unit sniffing, else null — never
 * invented.
 *
 * Endpoint strategy (research §1.3): the current `/v1/token_plan/remains`
 * route is tried first; on HTTP 404 or business code 1004 the legacy
 * `/v1/api/openplatform/coding_plan/remains` route is tried once.
 */
import type {
	FetchOpts,
	PlanKind,
	ProviderAdapter,
	ProviderCredential,
	QuotaWindow,
	UsageSnapshot,
} from "../types";

/**
 * Current and legacy endpoints; each is overridable via `opts.endpoints`
 * keyed exactly as written here.
 */
export const MINIMAX_ENDPOINTS = {
	minimax: "https://api.minimax.io/v1/token_plan/remains",
	"minimax-cn": "https://api.minimaxi.com/v1/token_plan/remains",
	"minimax-legacy":
		"https://api.minimax.io/v1/api/openplatform/coding_plan/remains",
	"minimax-cn-legacy":
		"https://api.minimaxi.com/v1/api/openplatform/coding_plan/remains",
} as const;

export type MinimaxPlan = Extract<
	keyof typeof MINIMAX_ENDPOINTS,
	"minimax" | "minimax-cn"
>;

const WEEK_SECONDS = 604800;

/** Business code: no active Token Plan subscription (research §6). */
const CODE_NO_TOKEN_PLAN = 2062;
/** Business code: "cookie is missing, log in again" — triggers the legacy fallback. */
const CODE_COOKIE_MISSING = 1004;

function num(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isObj(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/** Normalize a raw epoch value to epoch ms (>1e12 ms, >1e8 s x1000, else null). */
function epochMs(value: unknown): number | null {
	const n = num(value);
	if (n === null || n <= 0) return null;
	if (n > 1e12) return n;
	if (n > 1e8) return n * 1000;
	return null;
}

function firstEpochMs(
	source: Record<string, unknown>,
	keys: readonly string[],
): number | null {
	for (const key of keys) {
		const ms = epochMs(source[key]);
		if (ms !== null) return ms;
	}
	return null;
}

/**
 * Window label from the window's real duration (issue 013 wordlist):
 * 18000 -> "5h", 604800 -> "7d", other whole hours under a week stay hours,
 * whole days from a week up become days. Fractions keep one decimal.
 */
export function durationLabel(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return "I";
	if (seconds < WEEK_SECONDS && seconds % 3600 === 0)
		return `${seconds / 3600}h`;
	if (seconds >= WEEK_SECONDS && seconds % 86400 === 0)
		return `${seconds / 86400}d`;
	const hours = seconds / 3600;
	return `${Number.isInteger(hours) ? hours : Math.round(hours * 10) / 10}h`;
}

/**
 * Business code from the envelope: `base_resp.status_code` (root or under
 * `data`, tolerating camelCase) first, then a root-level `code`.
 */
function businessCode(payload: Record<string, unknown>): number | null {
	const container = isObj(payload.data) ? payload.data : payload;
	const baseResp = isObj(container.base_resp)
		? container.base_resp
		: isObj(payload.base_resp)
			? payload.base_resp
			: null;
	return (
		num(baseResp?.status_code) ??
		num(baseResp?.statusCode) ??
		num(container.code) ??
		num(payload.code)
	);
}

/**
 * Normalize a percent field: 0..100 expected; a non-integer decimal <= 1 is a
 * 0..1 fraction and is scaled x100 (both scales observed in the wild).
 */
function normPercent(value: unknown): number | null {
	const n = num(value);
	if (n === null || n < 0) return null;
	return !Number.isInteger(n) && n <= 1 ? n * 100 : n;
}

/** Used percent from a remaining percent — `remaining_percent` is authoritative (research §3.4). */
function usedFromRemaining(value: unknown): number | null {
	const remaining = normPercent(value);
	if (remaining === null) return null;
	return Math.max(0, 100 - remaining);
}

/** First present used-percent field among `keys`. */
function usedPercent(
	source: Record<string, unknown>,
	keys: readonly string[],
): number | null {
	for (const key of keys) {
		const percent = normPercent(source[key]);
		if (percent !== null) return percent;
	}
	return null;
}

function intervalPercent(entry: Record<string, unknown>): number | null {
	return (
		usedFromRemaining(entry.current_interval_remaining_percent) ??
		usedPercent(entry, [
			"current_interval_used_percentage",
			"used_percentage",
			"percentage",
			"percent",
		])
	);
}

function weeklyPercent(entry: Record<string, unknown>): number | null {
	return (
		usedFromRemaining(entry.current_weekly_remaining_percent) ??
		usedPercent(entry, [
			"weekly_used_percentage",
			"weekly_percentage",
			"used_percentage",
			"percentage",
			"percent",
		])
	);
}

/**
 * Normalize a remains-time value to milliseconds (issue 014 ladder). The
 * spec bands (>=1e9 ms; >=1e6 ambiguous -> >=1e10 ms else s; <1e6 s) collapse
 * to: >=1e9 is clearly ms, everything else is seconds — nothing in
 * [1e6, 1e9) escapes the >=1e9 rule, so the >=1e10 escape hatch is vacuous.
 */
function remainsMs(value: unknown): number | null {
	const n = num(value);
	if (n === null || n < 0) return null;
	return n >= 1e9 ? n : n * 1000;
}

/** Reset ladder for the interval window: explicit epochs, then remains-time, else null. */
function intervalResetsAt(
	entry: Record<string, unknown>,
	now: number,
): number | null {
	const explicit = firstEpochMs(entry, ["resets_at", "reset_time", "end_time"]);
	if (explicit !== null) return explicit;
	for (const key of ["remains_time", "remains", "resetRemain"]) {
		const ms = remainsMs(entry[key]);
		if (ms !== null) return now + ms;
	}
	return null;
}

/** Reset ladder for the weekly window: explicit epochs, then weekly remains, else null. */
function weeklyResetsAt(
	entry: Record<string, unknown>,
	now: number,
): number | null {
	const explicit = firstEpochMs(entry, [
		"resets_at",
		"reset_time",
		"weekly_end_time",
	]);
	if (explicit !== null) return explicit;
	for (const key of [
		"weekly_remains_time",
		"weekly_remains",
		"weekly_resetRemain",
	]) {
		const ms = remainsMs(entry[key]);
		if (ms !== null) return now + ms;
	}
	return null;
}

/** Interval length when the payload states it (end_time - start_time), else null. */
function intervalDurationSeconds(
	entry: Record<string, unknown>,
): number | null {
	const start = epochMs(entry.start_time);
	const end = epochMs(entry.end_time);
	if (start === null || end === null) return null;
	const seconds = (end - start) / 1000;
	return seconds > 0 ? seconds : null;
}

/** Interval-first (session-first order), weekly-second windows for one entry. */
function entryWindows(
	entry: Record<string, unknown>,
	now: number,
): QuotaWindow[] {
	const windows: QuotaWindow[] = [];
	{
		// A window applies when a percent or an explicit reset exists. Zero
		// counts and non-error status codes never disqualify it: real payloads
		// (verified 2026-10-26) report 0/0 counts alongside valid percentages —
		// unlimited-count plans still have live windows.
		const percent = intervalPercent(entry);
		const resetsAt = intervalResetsAt(entry, now);
		if (percent !== null || resetsAt !== null) {
			const durationSeconds = intervalDurationSeconds(entry);
			windows.push({
				label: durationSeconds === null ? "I" : durationLabel(durationSeconds),
				percent,
				resetsAt,
				durationSeconds,
			});
		}
	}
	{
		const percent = weeklyPercent(entry);
		const resetsAt = weeklyResetsAt(entry, now);
		if (percent !== null || resetsAt !== null) {
			windows.push({
				label: "7d",
				percent,
				resetsAt,
				durationSeconds: WEEK_SECONDS,
			});
		}
	}
	return windows;
}

/**
 * Pure parse of a MiniMax `token_plan/remains` (or legacy
 * `coding_plan/remains`) payload.
 *
 * Envelope `{base_resp?, code, data?|model_remains}` — `base_resp` may sit at
 * the root or under `data`. Windows come from `model_remains`; display is
 * percent-only. Entry selection targets the coding bucket: `general` first,
 * then `MiniMax-M*`, then the first entry with a usable percent, then the
 * first entry. Business code 2062 -> "No active Token Plan"; other non-zero
 * codes -> "unavailable (code)". Interval label falls back to "I" when the
 * interval length is unknown; the weekly window is always "7d"/604800.
 */
export function parseMiniMaxUsage(
	payload: unknown,
	provider: string,
	now: number,
): UsageSnapshot {
	const snapshot: UsageSnapshot = {
		provider,
		plan: provider === "minimax-cn" ? "minimax-cn" : "minimax",
		windows: [],
		status: "ok",
		fetchedAt: now,
	};
	if (!isObj(payload)) {
		return { ...snapshot, status: "error", error: "unavailable (body)" };
	}
	const code = businessCode(payload);
	if (code === CODE_NO_TOKEN_PLAN) {
		return { ...snapshot, status: "error", error: "No active Token Plan" };
	}
	if (code !== null && code !== 0) {
		return { ...snapshot, status: "error", error: `unavailable (${code})` };
	}

	const container = isObj(payload.data) ? payload.data : payload;
	const rawEntries = Array.isArray(container.model_remains)
		? container.model_remains
		: [];
	const candidates = rawEntries.filter(isObj).map((entry) => ({
		name:
			typeof entry.model_name === "string"
				? entry.model_name.toLowerCase()
				: "",
		windows: entryWindows(entry, now),
	}));
	const chosen =
		candidates.find((c) => c.name === "general") ??
		candidates.find((c) => c.name.startsWith("minimax-m")) ??
		candidates.find((c) => c.windows.some((w) => w.percent !== null)) ??
		candidates[0];

	return { ...snapshot, windows: chosen === undefined ? [] : chosen.windows };
}

function errorSnapshot(
	plan: PlanKind,
	now: number,
	error: string,
): UsageSnapshot {
	return {
		provider: plan,
		plan,
		windows: [],
		status: "error",
		error,
		fetchedAt: now,
	};
}

function buildInit(cred: ProviderCredential, signal: AbortSignal | undefined) {
	const headers: Record<string, string> = {
		...cred.headers,
		Accept: "application/json",
		Authorization: `Bearer ${cred.token}`,
	};
	const init: { headers: Record<string, string>; signal?: AbortSignal } = {
		headers,
	};
	if (signal !== undefined) init.signal = signal;
	return init;
}

interface FetchOnceResult {
	snapshot: UsageSnapshot;
	/** Whether the legacy endpoint should be tried next. */
	fallback: boolean;
}

/** ProviderAdapter for `minimax` (global) and `minimax-cn` (China). */
export class MinimaxAdapter implements ProviderAdapter {
	readonly plan: MinimaxPlan;

	constructor(plan: MinimaxPlan) {
		this.plan = plan;
	}

	async fetchUsage(
		cred: ProviderCredential,
		opts: FetchOpts,
	): Promise<UsageSnapshot> {
		const legacyKey =
			this.plan === "minimax" ? "minimax-legacy" : "minimax-cn-legacy";
		const currentUrl =
			opts.endpoints[this.plan] ?? MINIMAX_ENDPOINTS[this.plan];
		const legacyUrl = opts.endpoints[legacyKey] ?? MINIMAX_ENDPOINTS[legacyKey];

		const first = await this.fetchOnce(currentUrl, cred, opts);
		if (!first.fallback) return first.snapshot;
		const second = await this.fetchOnce(legacyUrl, cred, opts);
		return second.snapshot;
	}

	private async fetchOnce(
		url: string,
		cred: ProviderCredential,
		opts: FetchOpts,
	): Promise<FetchOnceResult> {
		let response: Awaited<ReturnType<FetchOpts["fetchImpl"]>>;
		try {
			response = await opts.fetchImpl(url, buildInit(cred, opts.signal));
		} catch {
			return {
				snapshot: errorSnapshot(this.plan, opts.now, "unavailable (network)"),
				fallback: false,
			};
		}
		if (response.status === 404) {
			return {
				snapshot: errorSnapshot(this.plan, opts.now, "unavailable (404)"),
				fallback: true,
			};
		}
		if (response.status !== 200) {
			return {
				snapshot: errorSnapshot(
					this.plan,
					opts.now,
					`unavailable (${response.status})`,
				),
				fallback: false,
			};
		}
		let payload: unknown;
		try {
			payload = JSON.parse(await response.text());
		} catch {
			return {
				snapshot: errorSnapshot(this.plan, opts.now, "unavailable (parse)"),
				fallback: false,
			};
		}
		if (businessCode(isObj(payload) ? payload : {}) === CODE_COOKIE_MISSING) {
			return {
				snapshot: errorSnapshot(
					this.plan,
					opts.now,
					`unavailable (${CODE_COOKIE_MISSING})`,
				),
				fallback: true,
			};
		}
		return {
			snapshot: parseMiniMaxUsage(payload, this.plan, opts.now),
			fallback: false,
		};
	}
}
