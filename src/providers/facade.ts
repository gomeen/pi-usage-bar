/**
 * Data-seam facade (issue 011): the single interface callers (pi adapter,
 * --usage flag) use to fetch usage for a set of targets. One failing target
 * damages only its own snapshot — never its neighbours.
 */

import type { FileCache } from "../cache.js";
import type {
	FetchOpts,
	PlanKind,
	ProviderAdapter,
	ProviderCredential,
	UsageSnapshot,
} from "../types.js";
import { createClaudeAdapter } from "./claude.js";
import { createCodexAdapter } from "./codex.js";
import { MinimaxAdapter } from "./minimax.js";
import { probeRelayBalance } from "./relay.js";
import { fetchResetAnnouncement } from "./resets.js";
import { ZaiAdapter } from "./zai.js";

export interface FetchTarget {
	/** pi provider id the request runs as (also stamped on the snapshot). */
	provider: string;
	plan: PlanKind;
	/** Base URL — required for relay probes, optional for first-party plans. */
	baseUrl?: string;
	/**
	 * Provider id to resolve the credential from, when it differs from
	 * `provider`. Codex usage lives on chatgpt.com/backend-api, which only
	 * accepts the openai-codex (backend-api audience) OAuth token — the
	 * `openai` provider's ChatGPT direct-use token (aud api.openai.com/v1)
	 * is rejected with 401 no_matching_rule (verified live 2026-10-26).
	 */
	credentialSource?: string;
	credential: ProviderCredential | null;
}

export interface FacadeOpts extends FetchOpts {
	cache: FileCache;
	/** Attach codex-resets.com announcements to the codex snapshot (issue 012). */
	showResets: boolean;
}

const adapterCache = new Map<string, ProviderAdapter>();

/** Issue 014: keep the last good snapshot per plan across failed polls. */
const lastGood = new Map<PlanKind, UsageSnapshot>();

/**
 * Issue 014: escalating backoff per plan on 429s — 1 → 5 → 15 min.
 * Pure decision helper so the policy stays testable.
 */
export function nextBackoffMs(consecutive429s: number): number {
	const minutes: readonly number[] = [1, 5, 15];
	const idx = Math.min(Math.max(consecutive429s - 1, 0), minutes.length - 1);
	return (minutes[idx] ?? 1) * 60_000;
}

const backoff = new Map<PlanKind, { until: number; hits: number }>();

function adapterFor(plan: PlanKind, provider: string): ProviderAdapter | null {
	switch (plan) {
		case "codex": {
			const key = `codex:${provider}`;
			let a = adapterCache.get(key);
			if (!a) {
				a = createCodexAdapter(provider);
				adapterCache.set(key, a);
			}
			return a;
		}
		case "claude": {
			const key = `claude:${provider}`;
			let a = adapterCache.get(key);
			if (!a) {
				a = createClaudeAdapter(provider);
				adapterCache.set(key, a);
			}
			return a;
		}
		case "zai":
		case "zai-cn":
			return new ZaiAdapter(plan);
		case "minimax":
		case "minimax-cn":
			return new MinimaxAdapter(plan);
		case "relay":
			return null;
	}
}

function errorSnapshot(
	target: FetchTarget,
	now: number,
	message: string,
): UsageSnapshot {
	return {
		provider: target.provider,
		plan: target.plan,
		windows: [],
		status: "error",
		error: message,
		fetchedAt: now,
	};
}

/**
 * Fetch usage for every target concurrently. Targets without a credential
 * yield an "unconfigured" error snapshot; relay targets run the billing
 * probe. The codex target additionally receives the official reset
 * announcement when opts.showResets.
 */
export async function fetchAllUsages(
	targets: readonly FetchTarget[],
	opts: FacadeOpts,
): Promise<UsageSnapshot[]> {
	const jobs = targets.map(async (target): Promise<UsageSnapshot> => {
		if (!target.credential?.token) {
			if (target.plan === "codex") {
				return errorSnapshot(
					target,
					opts.now,
					"unconfigured (run /login → OpenAI Codex)",
				);
			}
			return errorSnapshot(target, opts.now, "unconfigured");
		}
		// Backoff window active: serve last-good instead of hammering.
		const bo = backoff.get(target.plan);
		if (bo && opts.now < bo.until) {
			return (
				lastGood.get(target.plan) ??
				errorSnapshot(target, opts.now, "cooling down")
			);
		}
		try {
			if (target.plan === "relay") {
				if (!target.baseUrl) {
					return errorSnapshot(target, opts.now, "no billing endpoint");
				}
				return await probeRelayBalance(target.baseUrl, target.credential, opts);
			}
			const adapter = adapterFor(target.plan, target.provider);
			if (!adapter) {
				return errorSnapshot(target, opts.now, "unsupported plan");
			}
			return await adapter.fetchUsage(target.credential, opts);
		} catch {
			// Robustness rule (issue 014): never throw, never leak internals.
			return errorSnapshot(target, opts.now, "unavailable");
		}
	});

	const snapshots = await Promise.all(jobs);

	// Record outcomes: success clears backoff and refreshes last-good; a 429
	// escalates it. Last-good snapshots are served in place of hard errors so
	// a transient failure never makes a plan vanish from the bar.
	for (const snap of snapshots) {
		if (snap.status === "ok") {
			lastGood.set(snap.plan, snap);
			backoff.delete(snap.plan);
		} else if (snap.error?.includes("429")) {
			const prev = backoff.get(snap.plan);
			const hits = (prev?.hits ?? 0) + 1;
			backoff.set(snap.plan, {
				until: opts.now + nextBackoffMs(hits),
				hits,
			});
		}
	}
	const presented = snapshots.map((snap) => {
		if (
			snap.status === "error" &&
			!(snap.error ?? "").startsWith("no billing")
		) {
			return lastGood.get(snap.plan) ?? snap;
		}
		return snap;
	});

	if (opts.showResets) {
		try {
			const announcement = await fetchResetAnnouncement(opts);
			if (announcement) {
				for (const s of presented) {
					if (s.plan === "codex" && s.status === "ok") {
						s.announcement = announcement;
						break;
					}
				}
			}
		} catch {
			// Announcements are best-effort; ignore failures.
		}
	}
	return presented;
}

/** Adapt the native fetch to the FetchLike seam (headers → plain record). */
export function toFetchLike(
	fetchFn: typeof globalThis.fetch,
): import("../types.js").FetchLike {
	return async (url, init) => {
		const res = await fetchFn(url, init);
		const headers: Record<string, string> = {};
		res.headers.forEach((value, key) => {
			headers[key] = value;
		});
		return { ok: res.ok, status: res.status, headers, text: () => res.text() };
	};
}
