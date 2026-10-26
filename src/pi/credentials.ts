/**
 * Credential resolution via pi's ModelRegistry — the sanctioned path
 * (AGENTS.md security rules: never read auth.json directly).
 */
import type { ProviderCredential } from "../types.js";

/** Structural subset of pi's ModelRegistry used here (keeps tests easy). */
export interface RegistryLike {
	getProvider(provider: string): unknown;
	getProviderAuthStatus(provider: string): { configured: boolean } | undefined;
	getProviderAuth(provider: string): Promise<
		| {
				auth?: {
					apiKey?: string;
					headers?: Record<string, string>;
				};
		  }
		| undefined
	>;
}

/**
 * Resolve a bearer credential for a provider id, following the documented
 * hknet flow: registry presence → auth status → auth result. Returns null for
 * unconfigured providers. The Bearer token may come from auth.apiKey or an
 * Authorization header (some OAuth flows only expose the header).
 */
export async function resolveCredential(
	registry: RegistryLike,
	provider: string,
): Promise<ProviderCredential | null> {
	if (!registry.getProvider(provider)) return null;
	const status = registry.getProviderAuthStatus(provider);
	if (!status?.configured) return null;
	try {
		const resolved = await registry.getProviderAuth(provider);
		const auth = resolved?.auth;
		if (!auth) return null;

		let token: string | undefined = auth.apiKey;
		const headers: Record<string, string> = {};
		for (const [k, v] of Object.entries(auth.headers ?? {})) {
			if (typeof v !== "string") continue;
			const lower = k.toLowerCase();
			if (lower === "authorization") {
				if (!token) token = v.replace(/^Bearer\s+/i, "");
			} else {
				headers[k] = v;
			}
		}
		if (!token) return null;
		if (Object.keys(headers).length === 0) return { token };
		return { token, headers };
	} catch {
		// OAuth refresh failures surface here (issue 014): treat as unconfigured
		// for this round; the snapshot layer keeps last-good display.
		return null;
	}
}
