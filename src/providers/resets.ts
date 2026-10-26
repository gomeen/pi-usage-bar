/**
 * Official reset announcements from codex-resets.com (issue 012).
 *
 * ETag revalidation, 5-minute TTL, 1-hour max staleness, Retry-After backoff
 * (clamped 5min..24h), a 1MB body cap, and a shared file cache plus inflight
 * lock for multi-process dedup (issue 014). Semantics ported from
 * codex-statebar's resets.py; the announcement text is pre-formatted here,
 * in English, from our own short templates — never remote text.
 */

import type { FileCache } from "../cache";
import type { FetchOpts, ResetAnnouncement } from "../types";

const STATUS_URL = "https://codex-resets.com/api/v1/status";
const CACHE_KEY = "codex-resets";
const TTL_MS = 300_000;
const MAX_STALE_MS = 3_600_000;
const MAX_BODY_CHARS = 1_048_576;
const MIN_BACKOFF_MS = 300_000;
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000;

interface ResetsEntry {
	data: Record<string, unknown> | null;
	etag: string | null;
	/** Epoch ms of the last successful/304 fetch; 0 = never fetched. */
	fetchedAt: number;
	/** Epoch ms of the last fetch attempt of any kind. */
	checkedAt: number;
	/** Epoch ms before which no new attempt is made (429 backoff); 0 = none. */
	retryAt: number;
}

interface FetchResult {
	status: number;
	ok: boolean;
	headers: Record<string, string>;
	body: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Case-insensitive header lookup (fake and real fetches differ in casing). */
function headerGet(
	headers: Record<string, string>,
	name: string,
): string | null {
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === name) {
			return value;
		}
	}
	return null;
}

function finiteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** ISO string -> epoch ms; null for non-strings and unparseable values. */
function isoTime(value: unknown): number | null {
	if (typeof value !== "string") {
		return null;
	}
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : ms;
}

/** Relative duration: floor for past, ceil for future; units m/h/d. */
function dur(seconds: number, future: boolean): string {
	const s = Math.max(0, seconds);
	let divisor = 60;
	let unit = "m";
	if (s >= 86_400) {
		divisor = 86_400;
		unit = "d";
	} else if (s >= 3_600) {
		divisor = 3_600;
		unit = "h";
	}
	const value = future ? Math.ceil(s / divisor) : Math.floor(s / divisor);
	return `${Math.max(1, value)}${unit}`;
}

/**
 * Pure parse (priority scheduled > watch > latest, per issue 012/ticket).
 * Data older than MAX_STALE is stale-hidden: null.
 */
function parseAnnouncement(
	data: Record<string, unknown> | null,
	fetchedAt: number,
	now: number,
): ResetAnnouncement | null {
	if (!Number.isFinite(fetchedAt) || fetchedAt <= 0) {
		return null;
	}
	const age = now - fetchedAt;
	if (!(age >= 0 && age <= MAX_STALE_MS)) {
		return null;
	}
	if (!isRecord(data)) {
		return null;
	}

	const scheduled = data.scheduled_reset;
	if (isRecord(scheduled) && scheduled.status === "scheduled") {
		const target = isoTime(scheduled.scheduled_for);
		const text =
			target !== null && target > now
				? `Reset announced · in ${dur((target - now) / 1000, true)}`
				: "Reset announced · awaiting confirmation";
		return { kind: "scheduled", text };
	}

	const watch = data.active_watch;
	if (isRecord(watch)) {
		const observed = isoTime(watch.observed_at);
		const expires = isoTime(watch.expires_at);
		if (
			observed !== null &&
			expires !== null &&
			observed <= now &&
			now < expires
		) {
			const chance = watch.reset_chance_percent;
			const valid =
				typeof chance === "number" &&
				Number.isInteger(chance) &&
				chance >= 0 &&
				chance <= 100;
			const text = `AI forecast · reset possible${valid ? ` (${chance}%)` : ""}`;
			return valid
				? { kind: "watch", text, chancePercent: chance }
				: { kind: "watch", text };
		}
	}

	const latest = data.latest_reset;
	if (isRecord(latest)) {
		const stamp = isoTime(latest.announced_at);
		if (stamp !== null && stamp <= now) {
			const prefix =
				latest.reset_type === "banked"
					? "Banked reset · "
					: "Official reset · ";
			return {
				kind: "latest",
				text: `${prefix}${dur((now - stamp) / 1000, false)} ago`,
			};
		}
	}
	return null;
}

function readEntry(cache: FileCache): ResetsEntry | null {
	const cached = cache.get(CACHE_KEY);
	if (!cached || !isRecord(cached.data)) {
		return null;
	}
	const raw = cached.data;
	return {
		data: isRecord(raw.data) ? raw.data : null,
		etag: typeof raw.etag === "string" ? raw.etag : null,
		fetchedAt: finiteNumber(raw.fetchedAt) ?? 0,
		checkedAt: finiteNumber(raw.checkedAt) ?? 0,
		retryAt: finiteNumber(raw.retryAt) ?? 0,
	};
}

function writeEntry(cache: FileCache, entry: ResetsEntry): void {
	cache.set(
		CACHE_KEY,
		entry,
		entry.fetchedAt > 0 ? entry.fetchedAt : entry.checkedAt,
	);
}

/**
 * Fetch (or reuse) the current reset announcement. Returns null whenever
 * nothing should be rendered: no data, stale beyond 1 hour, or backoff.
 * Never throws.
 */
export async function fetchResetAnnouncement(
	opts: FetchOpts & { cache: FileCache },
): Promise<ResetAnnouncement | null> {
	const now = opts.now;
	const entry = readEntry(opts.cache);
	if (entry) {
		if (entry.retryAt > now) {
			return parseAnnouncement(entry.data, entry.fetchedAt, now);
		}
		if (now - entry.checkedAt >= 0 && now - entry.checkedAt < TTL_MS) {
			return parseAnnouncement(entry.data, entry.fetchedAt, now);
		}
	}

	const release = opts.cache.tryInflightLock(CACHE_KEY) ?? (() => {});
	try {
		const headers: Record<string, string> = { Accept: "application/json" };
		if (entry?.etag) {
			headers.IfNoneMatch = entry.etag;
		}
		const init: { headers: Record<string, string>; signal?: AbortSignal } = {
			headers,
		};
		if (opts.signal) {
			init.signal = opts.signal;
		}

		let res: FetchResult | null = null;
		try {
			const r = await opts.fetchImpl(STATUS_URL, init);
			res = {
				status: r.status,
				ok: r.ok,
				headers: r.headers,
				body: await r.text(),
			};
		} catch {
			res = null;
		}

		// Every failure shape keeps the last good data and bumps checkedAt.
		const keepLast = (): ResetAnnouncement | null => {
			const kept: ResetsEntry = {
				data: entry?.data ?? null,
				etag: entry?.etag ?? null,
				fetchedAt: entry?.fetchedAt ?? 0,
				checkedAt: now,
				retryAt: entry?.retryAt ?? 0,
			};
			writeEntry(opts.cache, kept);
			return parseAnnouncement(kept.data, kept.fetchedAt, now);
		};

		if (res === null) {
			return keepLast(); // network error
		}
		if (res.body.length > MAX_BODY_CHARS) {
			return keepLast(); // response size guard (1MB)
		}
		if (res.status === 304) {
			if (entry?.data) {
				const bumped: ResetsEntry = {
					data: entry.data,
					etag: entry.etag,
					fetchedAt: now,
					checkedAt: now,
					retryAt: 0,
				};
				writeEntry(opts.cache, bumped);
				return parseAnnouncement(bumped.data, bumped.fetchedAt, now);
			}
			return keepLast(); // 304 with nothing cached
		}
		if (res.status === 429) {
			const retryAfter = Number(headerGet(res.headers, "retry-after"));
			const delay =
				Number.isFinite(retryAfter) && retryAfter >= 0
					? Math.min(
							MAX_BACKOFF_MS,
							Math.max(MIN_BACKOFF_MS, retryAfter * 1000),
						)
					: MIN_BACKOFF_MS;
			const backed: ResetsEntry = {
				data: entry?.data ?? null,
				etag: entry?.etag ?? null,
				fetchedAt: entry?.fetchedAt ?? 0,
				checkedAt: now,
				retryAt: now + delay,
			};
			writeEntry(opts.cache, backed);
			return parseAnnouncement(backed.data, backed.fetchedAt, now);
		}
		if (res.ok) {
			try {
				const payload: unknown = JSON.parse(res.body);
				const data =
					isRecord(payload) && isRecord(payload.data) ? payload.data : null;
				if (
					data &&
					("scheduled_reset" in data ||
						"active_watch" in data ||
						"latest_reset" in data)
				) {
					const fresh: ResetsEntry = {
						data,
						etag: headerGet(res.headers, "etag"),
						fetchedAt: now,
						checkedAt: now,
						retryAt: 0,
					};
					writeEntry(opts.cache, fresh);
					return parseAnnouncement(fresh.data, fresh.fetchedAt, now);
				}
			} catch {
				// fall through to keep-last
			}
			return keepLast(); // payload discarded by validation
		}
		return keepLast(); // other HTTP errors
	} finally {
		release();
	}
}
