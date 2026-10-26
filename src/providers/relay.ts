/**
 * Relay (one-api/new-api) balance probe — issue 013, plan B.
 *
 * Auto-probes the de-facto standard billing endpoints of custom providers:
 * `/v1/dashboard/billing/subscription` + `/v1/dashboard/billing/usage`,
 * `remaining = hard_limit_usd - total_usage/100`. A 404-style miss is
 * negative-cached (one probe per week); transient failures keep the last
 * good amount with its original `fetchedAt` so render adds the ⟳ mark.
 * Never throws.
 */

import type { FileCache } from "../cache";
import type { FetchOpts, ProviderCredential, UsageSnapshot } from "../types";

/** Successful probes are reused for 5 minutes without touching the network. */
const GOOD_TTL_MS = 300_000;
/** A negative ("no billing endpoint") verdict is retried weekly. */
const NEGATIVE_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

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
 * Probe a relay provider's billing endpoints. The snapshot's `provider` is
 * the baseUrl host; `balance.amount` is the remaining quota in the site's
 * currency. Locking is best-effort: a held fresh lock never blocks a probe.
 */
export async function probeRelayBalance(
	baseUrl: string,
	cred: ProviderCredential,
	opts: FetchOpts & { cache: FileCache },
): Promise<UsageSnapshot> {
	const now = opts.now;
	let host: string;
	try {
		host = new URL(baseUrl).host;
	} catch {
		return errorSnapshot(baseUrl, "unavailable", now);
	}
	const key = `relay:${host}`;
	const cached = classify(opts.cache.get(key));

	// Negative cache: endpoint known absent (probed recently) — no network.
	if (cached?.kind === "absent" && now - cached.probedAt < NEGATIVE_RETRY_MS) {
		if (cached.lastGood) {
			return okSnapshot(
				host,
				cached.lastGood.amount,
				cached.lastGood.fetchedAt,
			);
		}
		return errorSnapshot(host, "no billing endpoint", now);
	}
	// Fresh good value: reuse for 5 minutes (issue 013).
	if (cached?.kind === "good" && now - cached.fetchedAt < GOOD_TTL_MS) {
		return okSnapshot(host, cached.amount, cached.fetchedAt);
	}

	const release = opts.cache.tryInflightLock(key) ?? (() => {});
	try {
		return await probe(host, baseUrl, cred, opts, key, cached);
	} finally {
		release();
	}
}

async function probe(
	host: string,
	baseUrl: string,
	cred: ProviderCredential,
	opts: FetchOpts & { cache: FileCache },
	key: string,
	cached: Classified | null,
): Promise<UsageSnapshot> {
	const now = opts.now;
	const base = baseUrl.replace(/\/+$/, "");
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
			? okSnapshot(host, lastGood.amount, lastGood.fetchedAt)
			: errorSnapshot(host, error, now);
	const negative = (): UsageSnapshot => {
		const absent: AbsentData = { absent: true };
		if (lastGood) {
			absent.amount = lastGood.amount;
			absent.amountFetchedAt = lastGood.fetchedAt;
		}
		opts.cache.set(key, absent, now);
		return lastGood
			? okSnapshot(host, lastGood.amount, lastGood.fetchedAt)
			: errorSnapshot(host, "no billing endpoint", now);
	};

	// 1) subscription: hard_limit_usd.
	let sub: { status: number; ok: boolean; body: string } | null;
	try {
		const res = await opts.fetchImpl(
			`${base}/v1/dashboard/billing/subscription`,
			init,
		);
		sub = { status: res.status, ok: res.ok, body: await res.text() };
	} catch {
		sub = null;
	}
	if (sub === null) {
		return keepLast("unavailable");
	}
	if (sub.status === 404 || sub.status === 405) {
		return negative();
	}
	if (!sub.ok) {
		return keepLast(sub.status === 429 ? "unavailable (429)" : "unavailable");
	}
	let subJson: unknown;
	try {
		subJson = JSON.parse(sub.body);
	} catch {
		return negative();
	}
	const hardLimit = isRecord(subJson) ? subJson.hard_limit_usd : undefined;
	if (
		typeof hardLimit !== "number" ||
		!Number.isFinite(hardLimit) ||
		hardLimit <= 0
	) {
		return negative();
	}

	// 2) usage: total_usage (cents) over the last 100 days (UTC).
	let usage: { status: number; ok: boolean; body: string } | null;
	try {
		const start = isoDate(now - 100 * 24 * 60 * 60 * 1000);
		const end = isoDate(now);
		const res = await opts.fetchImpl(
			`${base}/v1/dashboard/billing/usage?start_date=${start}&end_date=${end}`,
			init,
		);
		usage = { status: res.status, ok: res.ok, body: await res.text() };
	} catch {
		usage = null;
	}
	if (usage === null) {
		return keepLast("unavailable");
	}
	if (!usage.ok) {
		return keepLast(usage.status === 429 ? "unavailable (429)" : "unavailable");
	}
	let usageJson: unknown;
	try {
		usageJson = JSON.parse(usage.body);
	} catch {
		return keepLast("unavailable");
	}
	const totalUsage = isRecord(usageJson) ? usageJson.total_usage : undefined;
	if (typeof totalUsage !== "number" || !Number.isFinite(totalUsage)) {
		return keepLast("unavailable");
	}

	const amount = round2(hardLimit - totalUsage / 100);
	opts.cache.set(key, { amount }, now);
	return okSnapshot(host, amount, now);
}
