/**
 * DeepSeek provider adapter — prepaid API balance, no quota windows.
 *
 * Data contract: research/deepseek-usage-api.md. DeepSeek's first-party API
 * has no usage/quota endpoint; `GET /user/balance` is the only account data
 * it exposes, so the snapshot carries a `prepaid` balance and zero windows.
 * Parse is a pure function over the payload so tests stay IO-free.
 *
 * Display decisions (issue 018): the first `balance_infos[]` entry is shown
 * (`total_balance` only — granted/topped-up stay out of the bar, issue 013
 * "bal shows remaining amount only"); `is_available` is a sufficiency flag,
 * not data, and is ignored.
 */
import type {
	Balance,
	FetchOpts,
	PlanKind,
	ProviderAdapter,
	ProviderCredential,
	UsageSnapshot,
} from "../types";

/** Default balance endpoint; overridable via `opts.endpoints["deepseek"]`. */
export const DEEPSEEK_ENDPOINTS = {
	deepseek: "https://api.deepseek.com/user/balance",
} as const;

function isObj(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Numeric strings ("110.00") and numbers both parse; anything else is null. */
function parseAmount(value: unknown): number | null {
	if (typeof value === "number") {
		return Number.isFinite(value) && value >= 0 ? value : null;
	}
	if (typeof value === "string") {
		const trimmed = value.trim();
		if (trimmed.length === 0) return null;
		const parsed = Number(trimmed);
		return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
	}
	return null;
}

/**
 * Pure parse of a DeepSeek `GET /user/balance` payload into the balance
 * field of a snapshot. `null` balance means the body was unusable — the
 * caller turns that into a short error rather than inventing an amount.
 */
export function parseDeepSeekBalance(payload: unknown): Balance | null {
	if (!isObj(payload)) return null;
	const infos = payload.balance_infos;
	if (!Array.isArray(infos)) return null;
	const first = infos.find((entry) => isObj(entry));
	if (!isObj(first)) return null;
	const amount = parseAmount(first.total_balance);
	if (amount === null) return null;
	const currency =
		typeof first.currency === "string" && first.currency.length > 0
			? first.currency
			: undefined;
	return { kind: "prepaid", amount, ...(currency ? { currency } : {}) };
}

function errorSnapshot(now: number, error: string): UsageSnapshot {
	return {
		provider: "deepseek",
		plan: "deepseek",
		windows: [],
		status: "error",
		error,
		fetchedAt: now,
	};
}

/** ProviderAdapter for the `deepseek` plan (pi builtin provider id). */
export class DeepSeekAdapter implements ProviderAdapter {
	readonly plan: PlanKind = "deepseek";

	async fetchUsage(
		cred: ProviderCredential,
		opts: FetchOpts,
	): Promise<UsageSnapshot> {
		const url = opts.endpoints[this.plan] ?? DEEPSEEK_ENDPOINTS.deepseek;
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
			return errorSnapshot(opts.now, "unavailable (network)");
		}
		if (response.status !== 200) {
			return errorSnapshot(opts.now, `unavailable (${response.status})`);
		}
		let payload: unknown;
		try {
			payload = JSON.parse(await response.text());
		} catch {
			return errorSnapshot(opts.now, "unavailable (parse)");
		}
		const balance = parseDeepSeekBalance(payload);
		if (balance === null) {
			return errorSnapshot(opts.now, "unavailable (body)");
		}
		return {
			provider: this.plan,
			plan: this.plan,
			windows: [],
			balance,
			status: "ok",
			fetchedAt: opts.now,
		};
	}
}
