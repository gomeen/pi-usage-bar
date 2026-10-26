/**
 * Isolation layer for pi surfaces that are NOT documented contracts
 * (map Notes: keep undocumented calls here so pi upgrades break one file).
 *
 * Documented surfaces (setStatus, registerCommand, modelRegistry credential
 * methods) are used directly in their owning modules — this file only holds
 * the heuristics research flagged as unstable:
 *   - AuthResult.source label matching (no documented credential-type
 *     discriminator exists; see research/pi-extension-api.md open question 1).
 */
import type { ProviderCredential } from "../types.js";

/** Heuristic: does this auth source label look like an OAuth subscription? */
export function isOAuthSourceLabel(source: string | undefined): boolean {
  return source === "OAuth" || source === "oauth";
}

/**
 * Merge vendor-mandatory headers with credential extras (credential wins on
 * collision — it may carry ChatGPT-Account-Id style per-account headers).
 */
export function mergeCredentialHeaders(
  mandatory: Record<string, string>,
  cred: ProviderCredential,
): Record<string, string> {
  return { ...mandatory, ...cred.headers };
}
