/**
 * Git branch for the editor chrome chip. The chip renders per frame, so the
 * spawn is debounced through a short TTL cache; semantics mirror pi's
 * FooterDataProvider (detached HEAD → "detached", failure → null).
 */
import { execFile } from "node:child_process";

interface BranchCache {
	branch: string | null;
	/** Milliseconds of the last attempt (not success) — debounces slow gits. */
	at: number;
}

const TTL_MS = 3_000;
let cache: BranchCache | null = null;

/** Last resolved branch, or null before the first spawn resolves. */
export function cachedBranch(): string | null {
	return cache === null ? null : cache.branch;
}

/** Pure mapping of `git rev-parse --abbrev-ref HEAD` output → display value. */
export function normalizeBranch(stdout: string): string | null {
	const trimmed = stdout.trim();
	if (trimmed === "" || trimmed === "HEAD") return "detached";
	return trimmed;
}

/**
 * Kick off (at most one per TTL) an async branch refresh for `cwd`. The chip
 * keeps rendering the cached value; the next frame after resolution shows it.
 */
export function refreshBranch(cwd: string): void {
	if (cache !== null && Date.now() - cache.at < TTL_MS) return;
	cache = { branch: cachedBranch(), at: Date.now() };
	execFile(
		"git",
		["rev-parse", "--abbrev-ref", "HEAD"],
		{ cwd, timeout: 1_500 },
		(err, stdout) => {
			cache = {
				branch: err ? (cache?.branch ?? null) : normalizeBranch(stdout),
				at: Date.now(),
			};
		},
	);
}
