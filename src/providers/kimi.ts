/**
 * Kimi (Moonshot AI) provider adapter — prepaid API balance, no quota windows.
 *
 * Data contract: research/kimi-usage-api.md. The Kimi Open Platform (formerly
 * Moonshot) exposes exactly one account endpoint, `GET /v1/users/me/balance`,
 * so the snapshot carries a `prepaid` balance and zero windows. Parse is a
 * pure function over the payload so tests stay IO-free.
 *
 * Regional twins (issue 019), mirroring zai/minimax: `kimi` is the global
 * station (api.moonshot.ai, USD) and `kimi-cn` the China station
 * (api.moonshot.cn, CNY). Keys are station-bound — a key from one platform
 * gets 401 on the other — and the balance unit is the station's currency,
 * which the payload does NOT report: the ISO code is region-implied.
 *
 * Display decisions (issue 019): `data.available_balance` is the one number
 * shown (cash + voucher; when cash goes negative it equals the voucher
 * balance — the amount that can still be spent, issue 013 "remaining only").
 * `voucher_balance` / `cash_balance` breakdowns stay out of the bar.
 */
import type {
	Balance,
	FetchOpts,
	PlanKind,
	ProviderAdapter,
	ProviderCredential,
	UsageSnapshot,
} from "../types";

/** Default balance endpoints; overridable via `opts.endpoints[plan]`. */
export const KIMI_ENDPOINTS = {
	kimi: "https://api.moonshot.ai/v1/users/me/balance",
	"kimi-cn": "https://api.moonshot.cn/v1/users/me/balance",
} as const;

/**
 * Region-implied currency ISO code — the balance payload has no currency
 * field; the unit is the station's own currency (CN: CNY, global: USD).
 */
export const KIMI_CURRENCY: Record<keyof typeof KIMI_ENDPOINTS, string> = {
	kimi: "USD",
	"kimi-cn": "CNY",
};

function isObj(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Numeric strings ("49.58894") and numbers both parse; negatives fail. */
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
 * Pure parse of a Kimi `GET /v1/users/me/balance` payload into the balance
 * field of a snapshot. The envelope `{code, data, scode, status}` succeeds
 * with `code: 0`; a present non-zero code means the body is an error despite
 * HTTP 200. `null` means unusable — the caller turns that into a short error
 * rather than inventing an amount.
 */
export function parseKimiBalance(
	payload: unknown,
	currency: string,
): Balance | null {
	if (!isObj(payload)) return null;
	if (payload.code !== undefined && payload.code !== 0) return null;
	const data = payload.data;
	if (!isObj(data)) return null;
	const amount = parseAmount(data.available_balance);
	if (amount === null) return null;
	return { kind: "prepaid", amount, currency };
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

/** ProviderAdapter for the `kimi` / `kimi-cn` plans. */
export class KimiAdapter implements ProviderAdapter {
	readonly plan: "kimi" | "kimi-cn";

	constructor(plan: "kimi" | "kimi-cn") {
		this.plan = plan;
	}

	async fetchUsage(
		cred: ProviderCredential,
		opts: FetchOpts,
	): Promise<UsageSnapshot> {
		const url = opts.endpoints[this.plan] ?? KIMI_ENDPOINTS[this.plan];
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
		const balance = parseKimiBalance(payload, KIMI_CURRENCY[this.plan]);
		if (balance === null) {
			return errorSnapshot(this.plan, opts.now, "unavailable (body)");
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
