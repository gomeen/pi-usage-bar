/**
 * Domain model for pi-usage-bar.
 *
 * One `UsageSnapshot` per provider query flows through the whole pipeline:
 * providers/ produce them, render/ consumes them, pi/ adapters display them.
 * Nothing in this file may import from pi packages — the core stays portable.
 */

/** The official subscription plans we support, plus the relay pseudo-plan. */
export type PlanKind =
	| "codex"
	| "claude"
	| "zai"
	| "zai-cn"
	| "minimax"
	| "minimax-cn"
	| "relay";

/** A single quota window (e.g. the 5h session window or the 7d weekly window). */
export interface QuotaWindow {
	/**
	 * Dynamic label generated from the window's real duration (decision: issue 013).
	 * 18000s -> "5h", 604800s -> "7d", other durations verbatim ("2h", "72h"),
	 * unknown duration -> "I". Providers compute this; render never rewrites it.
	 */
	label: string;
	/** Usage percentage 0..100. Above 100 allowed (Claude burnout). null = unknown. */
	percent: number | null;
	/** Reset time as epoch milliseconds. null = unknown -> render shows no ⏰, never invents one. */
	resetsAt: number | null;
	/** Window length in seconds when the API reports it; null otherwise. */
	durationSeconds: number | null;
}

/** A monetary amount attached to a snapshot. Raw number; render applies currency. */
export interface Balance {
	kind: "relay" | "credits";
	/** Raw amount in the account's quota currency (e.g. 200 or 12.5). */
	amount: number;
}

/** Official Codex reset announcement (codex-resets.com), already pre-formatted. */
export interface ResetAnnouncement {
	kind: "scheduled" | "watch";
	/** Pre-formatted relative time, e.g. "Reset announced · in 1h10m". */
	text: string;
	/**
	 * Compact wording for a secondary row, e.g. "in 1h10m". Only the
	 * scheduled kind has one: it carries a time value worth abbreviating.
	 * A forecast has no such value, so it keeps its full wording.
	 */
	shortText?: string;
	/** Reset chance percent for kind === "watch" (AI forecast). */
	chancePercent?: number;
}

export type SnapshotStatus = "ok" | "error";

export interface UsageSnapshot {
	/** The pi provider id the data was actually fetched for (display name lives in `plan`). */
	provider: string;
	plan: PlanKind;
	/** Quota windows, session-first order. 0..2 entries. */
	windows: QuotaWindow[];
	balance?: Balance;
	/** Codex-only official reset announcement. */
	announcement?: ResetAnnouncement;
	status: SnapshotStatus;
	/** Short error text for status === "error", e.g. "unavailable (429)". No secrets ever. */
	error?: string;
	/** Epoch ms when the underlying data was fetched. */
	fetchedAt: number;
}

/** A fetch implementation shaped like the global fetch (injectable for tests). */
export type FetchLike = (
	url: string,
	init?: {
		headers?: Record<string, string>;
		signal?: AbortSignal;
	},
) => Promise<{
	ok: boolean;
	status: number;
	headers: Record<string, string>;
	text: () => Promise<string>;
}>;

/** Credential resolved by the pi adapter (never read from auth.json directly). */
export interface ProviderCredential {
	/** Bearer token. */
	token: string;
	/** Extra headers some vendors require (e.g. ChatGPT-Account-Id, anthropic-beta). */
	headers?: Record<string, string>;
}

export interface FetchOpts {
	/** First-party endpoint overrides from PI_*_ENDPOINT env vars, keyed by name. */
	endpoints: Record<string, string>;
	/** Current time, epoch ms (injectable for tests). */
	now: number;
	/** Injected fetch (tests pass a fake; production passes globalThis.fetch). */
	fetchImpl: FetchLike;
	/** Aborted when the model switches or the session ends. */
	signal?: AbortSignal;
}

/** The seam every provider module implements. One adapter per plan. */
export interface ProviderAdapter {
	readonly plan: PlanKind;
	fetchUsage(cred: ProviderCredential, opts: FetchOpts): Promise<UsageSnapshot>;
}

/** Resolved RGB color palette handed to render. Graphite is the built-in default. */
export type RGB = readonly [number, number, number];

export interface Palette {
	ink: RGB;
	mute: RGB;
	edge: RGB;
	ok: RGB;
	warn: RGB;
	hot: RGB;
	wt: RGB;
}

/** Full v1 config (issue 009). Sparse-persisted: only non-default keys are written. */
export interface UsageBarConfig {
	style: "aurora" | "ring" | "classic";
	bar_glyph: "block" | "thin";
	theme: "graphite" | "pi";
	density: "compact" | "regular" | "cozy";
	bar_width: number;
	color_ok: string;
	color_warn: string;
	color_hot: string;
	warning_threshold: number;
	critical_threshold: number;
	display: {
		mode: "active" | "all";
		providers: PlanKind[];
		/** In all-mode, render non-active plans as one compact summary line. */
		compact_others: boolean;
	};
	/** Manual provider-id mapping: plan name, or relay object. Wins over auto-detection. */
	providerMap: Record<string, string | { type: "relay" }>;
	refresh_minutes: number;
	show_resets: boolean;
	/** Per-window reset countdowns (⏰ / "resets …") — off by default. */
	show_reset_countdown: boolean;
	show_balance: boolean;
	currency: string;
}

export const DEFAULT_CONFIG: UsageBarConfig = {
	style: "aurora",
	bar_glyph: "block",
	theme: "graphite",
	density: "regular",
	bar_width: 12,
	color_ok: "",
	color_warn: "",
	color_hot: "",
	warning_threshold: 30,
	critical_threshold: 70,
	display: { mode: "all", providers: [], compact_others: true },
	providerMap: {},
	refresh_minutes: 2,
	show_resets: true,
	show_reset_countdown: true,
	show_balance: true,
	currency: "$",
};
