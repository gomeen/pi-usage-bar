/**
 * ZAI (Zhipu GLM Coding Plan) provider adapter — global z.ai and China
 * bigmodel.cn.
 *
 * Data contract: research/zai-usage-api.md. Display decision (issue 013):
 * only the 5-hour session window and the weekly window are shown; the
 * TIME_LIMIT monthly-tools lane is skipped. Parse is a pure function over the
 * payload so tests stay IO-free.
 */
import type {
	FetchOpts,
	ProviderAdapter,
	ProviderCredential,
	QuotaWindow,
	UsageSnapshot,
} from "../types";

/** Default quota endpoints; each is overridable via `opts.endpoints` by key. */
export const ZAI_ENDPOINTS = {
	zai: "https://api.z.ai/api/monitor/usage/quota/limit",
	"zai-cn": "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
} as const;

export type ZaiPlan = keyof typeof ZAI_ENDPOINTS;

/** Window lengths in seconds for the two displayed units. */
const SESSION_SECONDS = 18000;
const WEEK_SECONDS = 604800;

/** Unit codes inside `data.limits[]` (research §3). */
const UNIT_SESSION = 3;
const UNIT_WEEK = 6;
const UNIT_MONTHLY_TOOLS = 5;

/**
 * Window label from the window's real duration (issue 013 wordlist):
 * 18000 -> "5h", 604800 -> "7d", other whole hours under a week stay hours
 * ("2h", "72h"), whole days from a week up become days ("14d"). Fractions
 * keep one decimal ("1.5h"); unknown durations are the caller's business.
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

function num(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isObj(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

/**
 * Normalize a raw epoch value to epoch milliseconds: >1e12 is already
 * milliseconds, >1e8 is epoch seconds. Anything smaller is not a plausible
 * epoch — return null rather than invent a reset time.
 */
function epochMs(value: unknown): number | null {
	const n = num(value);
	if (n === null || n <= 0) return null;
	if (n > 1e12) return n;
	if (n > 1e8) return n * 1000;
	return null;
}

/** First plausible epoch-ms reset among `keys`, or null. */
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

function errorSnapshot(
	plan: ZaiPlan,
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

/**
 * Pure parse of a ZAI `GET /api/monitor/usage/quota/limit` payload.
 *
 * Envelope `{code, msg, success, data:{limits:[...]}}`: `success === false` or
 * a non-success code yields `status:"error"` with a short message
 * ("unavailable (100423)"). Windows: `unit 3` -> 5h session (first), `unit 6`
 * -> weekly (second); TIME_LIMIT / `unit 5` entries are skipped (issue 013).
 * `percentage` (0..100) is used verbatim; the reset comes from
 * `nextResetTime` (epoch ms), defensively also `resetTime` / `reset_time`
 * with unit sniffing (>1e12 ms, else epoch seconds x1000).
 */
export function parseZaiUsage(
	payload: unknown,
	provider: string,
	now: number,
): UsageSnapshot {
	const snapshot: UsageSnapshot = {
		provider,
		plan: provider === "zai-cn" ? "zai-cn" : "zai",
		windows: [],
		status: "ok",
		fetchedAt: now,
	};
	if (!isObj(payload)) {
		return { ...snapshot, status: "error", error: "unavailable (body)" };
	}
	const code = num(payload.code);
	if (
		payload.success === false ||
		(code !== null && code !== 0 && code !== 200)
	) {
		return {
			...snapshot,
			status: "error",
			error: `unavailable (${code ?? "unknown"})`,
		};
	}

	const data = isObj(payload.data) ? payload.data : {};
	const limits = Array.isArray(data.limits) ? data.limits : [];

	let session: QuotaWindow | null = null;
	let weekly: QuotaWindow | null = null;
	for (const entry of limits) {
		if (!isObj(entry)) continue;
		const type = typeof entry.type === "string" ? entry.type : "";
		const unit = num(entry.unit);
		// Monthly tools lane (search/web-reader/zread) — display decision: skip.
		if (type === "TIME_LIMIT" || unit === UNIT_MONTHLY_TOOLS) continue;
		const resetsAt = firstEpochMs(entry, [
			"nextResetTime",
			"resetTime",
			"reset_time",
		]);
		const percent = num(entry.percentage);
		if (unit === UNIT_SESSION && session === null) {
			session = {
				label: durationLabel(SESSION_SECONDS),
				percent,
				resetsAt,
				durationSeconds: SESSION_SECONDS,
			};
		} else if (unit === UNIT_WEEK && weekly === null) {
			weekly = {
				label: durationLabel(WEEK_SECONDS),
				percent,
				resetsAt,
				durationSeconds: WEEK_SECONDS,
			};
		}
	}

	const windows: QuotaWindow[] = [];
	if (session !== null) windows.push(session);
	if (weekly !== null) windows.push(weekly);
	return { ...snapshot, windows };
}

/** ProviderAdapter for `zai` (global) and `zai-cn` (bigmodel.cn). */
export class ZaiAdapter implements ProviderAdapter {
	readonly plan: ZaiPlan;

	constructor(plan: ZaiPlan) {
		this.plan = plan;
	}

	async fetchUsage(
		cred: ProviderCredential,
		opts: FetchOpts,
	): Promise<UsageSnapshot> {
		const url = opts.endpoints[this.plan] ?? ZAI_ENDPOINTS[this.plan];
		const headers: Record<string, string> = {
			...cred.headers,
			Accept: "application/json",
			Authorization: `Bearer ${cred.token}`,
		};
		const init: { headers: Record<string, string>; signal?: AbortSignal } = {
			headers,
		};
		if (opts.signal !== undefined) init.signal = opts.signal;

		let response: Awaited<ReturnType<FetchOpts["fetchImpl"]>>;
		try {
			response = await opts.fetchImpl(url, init);
		} catch {
			return errorSnapshot(this.plan, opts.now, "unavailable (network)");
		}
		if (response.status !== 200) {
			return errorSnapshot(
				this.plan,
				opts.now,
				`unavailable (${response.status})`,
			);
		}
		let payload: unknown;
		try {
			payload = JSON.parse(await response.text());
		} catch {
			return errorSnapshot(this.plan, opts.now, "unavailable (parse)");
		}
		return parseZaiUsage(payload, this.plan, opts.now);
	}
}
