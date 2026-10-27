/**
 * Relay balance probe — issue 013, plan B.
 *
 * Two endpoint families are probed, in order:
 * 1. one-api / new-api de-facto standard: `/v1/dashboard/billing/subscription`
 *    + `/v1/dashboard/billing/usage`, `remaining = hard_limit_usd - total_usage/100`.
 * 2. Sub2API-style site endpoint: `{site}/v1/usage` → `{ balance, ... }`
 *    (the site's own key is enough; no access token needed).
 *
 * A miss on one family falls through to the next; only when both families are
 * absent is the host negative-cached (one probe per week). Transient failures
 * keep the last good amount with its original `fetchedAt` so render adds the
 * ⟳ mark. Never throws.
 */

import { createHash } from "node:crypto";
import type { FileCache } from "../cache";
import type {
	FetchLike,
	FetchOpts,
	ProviderCredential,
	UsageSnapshot,
} from "../types";

/** Successful probes are reused for 5 minutes without touching the network. */
const GOOD_TTL_MS = 300_000;
/** A negative ("no billing endpoint") verdict is retried weekly. */
const NEGATIVE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Cache-key version. Bump it whenever the endpoint families change: an old
 * "absent" verdict would otherwise suppress the new families for a week.
 */
const CACHE_VERSION = "v2";

/**
 * Cache key for one relay account: host + a truncated, non-reversible token
 * fingerprint. Two keys on the same host are different accounts with
 * different balances, so they must never share a cached value. The token
 * itself never leaves this function.
 */
export function relayCacheKey(host: string, token: string): string {
	const fingerprint = createHash("sha256")
		.update(token)
		.digest("hex")
		.slice(0, 8);
	return `relay:${CACHE_VERSION}:${host}:${fingerprint}`;
}

/** Negative-cache marker, optionally keeping the last good amount around. */
interface AbsentData {
	absent: true;
	amount?: number;
	amountFetchedAt?: number;
}

type Classified =
	| { kind: "good"; amount: number; fetchedAt: number }
	| {
			kind: "absent";
			probedAt: number;
			lastGood?: { amount: number; fetchedAt: number };
	  };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

/** Accepts numbers and numeric strings; null when absent or not finite. */
function toFiniteNumber(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) return null;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

/** UTC `YYYY-MM-DD` for the billing usage query window. */
function isoDate(msSinceEpoch: number): string {
	return new Date(msSinceEpoch).toISOString().slice(0, 10);
}

function okSnapshot(
	host: string,
	amount: number,
	fetchedAt: number,
): UsageSnapshot {
	return {
		provider: host,
		plan: "relay",
		windows: [],
		balance: { kind: "relay", amount },
		status: "ok",
		fetchedAt,
	};
}

function errorSnapshot(
	provider: string,
	error: string,
	fetchedAt: number,
): UsageSnapshot {
	return {
		provider,
		plan: "relay",
		windows: [],
		status: "error",
		error,
		fetchedAt,
	};
}

function classify(
	entry: { data: unknown; fetchedAt: number } | undefined,
): Classified | null {
	if (!entry || !isRecord(entry.data)) {
		return null;
	}
	const data = entry.data;
	if (data.absent === true) {
		const absent: Classified = { kind: "absent", probedAt: entry.fetchedAt };
		const amount = data.amount;
		const amountFetchedAt = data.amountFetchedAt;
		if (
			typeof amount === "number" &&
			Number.isFinite(amount) &&
			typeof amountFetchedAt === "number" &&
			Number.isFinite(amountFetchedAt)
		) {
			absent.lastGood = { amount, fetchedAt: amountFetchedAt };
		}
		return absent;
	}
	if (typeof data.amount === "number" && Number.isFinite(data.amount)) {
		return { kind: "good", amount: data.amount, fetchedAt: entry.fetchedAt };
	}
	return null;
}

/**
 * Probe a relay provider's billing endpoints. `provider` is the pi provider
 * id the request runs as (the snapshot's identity — several pi providers may
 * share one station but hold different keys, and each is its own account);
 * `balance.amount` is the remaining quota in the site's currency. Locking is
 * best-effort: a held fresh lock never blocks a probe.
 */
export async function probeRelayBalance(
	baseUrl: string,
	provider: string,
	cred: ProviderCredential,
	opts: FetchOpts & { cache: FileCache },
): Promise<UsageSnapshot> {
	const now = opts.now;
	let host: string;
	try {
		host = new URL(baseUrl).host;
	} catch {
		return errorSnapshot(provider, "unavailable", now);
	}
	// The cache slot follows the account (station + key), not the pi provider
	// id: two ids pointing at one key share one balance.
	const key = relayCacheKey(host, cred.token);
	const cached = classify(opts.cache.get(key));

	// Negative cache: endpoint known absent (probed recently) — no network.
	if (cached?.kind === "absent" && now - cached.probedAt < NEGATIVE_RETRY_MS) {
		if (cached.lastGood) {
			return okSnapshot(
				provider,
				cached.lastGood.amount,
				cached.lastGood.fetchedAt,
			);
		}
		return errorSnapshot(provider, "no billing endpoint", now);
	}
	// Fresh good value: reuse for 5 minutes (issue 013).
	if (cached?.kind === "good" && now - cached.fetchedAt < GOOD_TTL_MS) {
		return okSnapshot(provider, cached.amount, cached.fetchedAt);
	}

	const release = opts.cache.tryInflightLock(key) ?? (() => {});
	try {
		return await probe(provider, baseUrl, cred, opts, key, cached);
	} finally {
		release();
	}
}

/** Outcome of one endpoint family. */
type FamilyResult =
	| { kind: "ok"; amount: number }
	/** The family does not exist on this host (404/405 or an unusable shape). */
	| { kind: "absent" }
	/** Transient failure: keep the last good amount and report this error. */
	| { kind: "error"; error: string };

/** GET that never throws; null means the request itself failed. */
async function get(
	url: string,
	init: { headers: Record<string, string>; signal?: AbortSignal },
	fetchImpl: FetchLike,
): Promise<{ status: number; ok: boolean; body: string } | null> {
	try {
		const res = await fetchImpl(url, init);
		return { status: res.status, ok: res.ok, body: await res.text() };
	} catch {
		return null;
	}
}

/**
 * Family 1 — one-api / new-api de-facto standard dashboard billing.
 * `remaining = hard_limit_usd - total_usage/100`.
 */
async function probeDashboardFamily(
	site: string,
	init: { headers: Record<string, string>; signal?: AbortSignal },
	fetchImpl: FetchLike,
	now: number,
): Promise<FamilyResult> {
	const sub = await get(
		`${site}/v1/dashboard/billing/subscription`,
		init,
		fetchImpl,
	);
	if (sub === null) return { kind: "error", error: "unavailable" };
	if (sub.status === 404 || sub.status === 405) return { kind: "absent" };
	if (!sub.ok) {
		return {
			kind: "error",
			error: sub.status === 429 ? "unavailable (429)" : "unavailable",
		};
	}
	let subJson: unknown;
	try {
		subJson = JSON.parse(sub.body);
	} catch {
		return { kind: "absent" };
	}
	const hardLimit = isRecord(subJson)
		? toFiniteNumber(subJson.hard_limit_usd)
		: null;
	if (hardLimit === null || hardLimit <= 0) return { kind: "absent" };

	const start = isoDate(now - 100 * 24 * 60 * 60 * 1000);
	const end = isoDate(now);
	const usage = await get(
		`${site}/v1/dashboard/billing/usage?start_date=${start}&end_date=${end}`,
		init,
		fetchImpl,
	);
	if (usage === null) return { kind: "error", error: "unavailable" };
	if (usage.status === 404 || usage.status === 405) {
		return { kind: "absent" };
	}
	if (!usage.ok) {
		return {
			kind: "error",
			error: usage.status === 429 ? "unavailable (429)" : "unavailable",
		};
	}
	let usageJson: unknown;
	try {
		usageJson = JSON.parse(usage.body);
	} catch {
		return { kind: "absent" };
	}
	const totalUsage = isRecord(usageJson)
		? toFiniteNumber(usageJson.total_usage)
		: null;
	if (totalUsage === null) return { kind: "absent" };
	return { kind: "ok", amount: round2(hardLimit - totalUsage / 100) };
}

/**
 * Family 2 — Sub2API-style site usage endpoint: `{site}/v1/usage` answers
 * with the account balance. The base URL may or may not carry a `/v1`
 * suffix, so it is normalised before the path is appended.
 */
async function probeSiteUsageFamily(
	site: string,
	init: { headers: Record<string, string>; signal?: AbortSignal },
	fetchImpl: FetchLike,
): Promise<FamilyResult> {
	const res = await get(`${site}/v1/usage`, init, fetchImpl);
	if (res === null) return { kind: "error", error: "unavailable" };
	if (res.status === 404 || res.status === 405) return { kind: "absent" };
	if (!res.ok) {
		return {
			kind: "error",
			error: res.status === 429 ? "unavailable (429)" : "unavailable",
		};
	}
	let json: unknown;
	try {
		json = JSON.parse(res.body);
	} catch {
		return { kind: "absent" };
	}
	if (isRecord(json) && json.isValid === false) {
		return { kind: "error", error: "unavailable" };
	}
	const amount = extractBalance(json);
	if (amount === null) return { kind: "absent" };
	return { kind: "ok", amount };
}

/** Balance amount from a site usage payload: `balance`, `remaining`, or quota math. */
function extractBalance(payload: unknown): number | null {
	if (!isRecord(payload)) return null;
	const direct =
		toFiniteNumber(payload.balance) ?? toFiniteNumber(payload.remaining);
	if (direct !== null) return direct;
	const quota = payload.quota;
	if (!isRecord(quota)) return null;
	const remaining = toFiniteNumber(quota.remaining);
	if (remaining !== null) return remaining;
	const limit = toFiniteNumber(quota.limit);
	const used = toFiniteNumber(quota.used);
	if (limit !== null && used !== null) return limit - used;
	return null;
}

async function probe(
	provider: string,
	baseUrl: string,
	cred: ProviderCredential,
	opts: FetchOpts & { cache: FileCache },
	key: string,
	cached: Classified | null,
): Promise<UsageSnapshot> {
	const now = opts.now;
	const base = baseUrl.replace(/\/+$/, "");
	// The site root carries no `/v1` suffix: both families append their own
	// path, so a provider base URL of `https://host/v1` must not become
	// `https://host/v1/v1/...`.
	const site = base.replace(/\/v1$/, "");
	const headers: Record<string, string> = {
		Authorization: `Bearer ${cred.token}`,
	};
	if (cred.headers) {
		Object.assign(headers, cred.headers);
	}
	const init: { headers: Record<string, string>; signal?: AbortSignal } = {
		headers,
	};
	if (opts.signal) {
		init.signal = opts.signal;
	}

	const lastGood =
		cached?.kind === "good"
			? { amount: cached.amount, fetchedAt: cached.fetchedAt }
			: cached?.kind === "absent"
				? cached.lastGood
				: undefined;
	const keepLast = (error: string): UsageSnapshot =>
		lastGood
			? okSnapshot(provider, lastGood.amount, lastGood.fetchedAt)
			: errorSnapshot(provider, error, now);
	const negative = (): UsageSnapshot => {
		const absent: AbsentData = { absent: true };
		if (lastGood) {
			absent.amount = lastGood.amount;
			absent.amountFetchedAt = lastGood.fetchedAt;
		}
		opts.cache.set(key, absent, now);
		return lastGood
			? okSnapshot(provider, lastGood.amount, lastGood.fetchedAt)
			: errorSnapshot(provider, "no billing endpoint", now);
	};

	// Family 1 — one-api / new-api standard dashboard billing.
	const dashboard = await probeDashboardFamily(site, init, opts.fetchImpl, now);
	if (dashboard.kind === "ok") {
		opts.cache.set(key, { amount: dashboard.amount }, now);
		return okSnapshot(provider, dashboard.amount, now);
	}
	if (dashboard.kind === "error") {
		return keepLast(dashboard.error);
	}

	// Family 2 — Sub2API-style site usage endpoint.
	const siteUsage = await probeSiteUsageFamily(site, init, opts.fetchImpl);
	if (siteUsage.kind === "ok") {
		opts.cache.set(key, { amount: siteUsage.amount }, now);
		return okSnapshot(provider, siteUsage.amount, now);
	}
	if (siteUsage.kind === "error") {
		return keepLast(siteUsage.error);
	}

	// Neither family exists on this host: remember the verdict for a week.
	return negative();
}
