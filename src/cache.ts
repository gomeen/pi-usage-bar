/**
 * Shared file cache for provider modules (relay balance, reset announcements).
 *
 * Multi-process coordination (issue 014): ordinary JSON entries plus
 * O_CREAT|O_EXCL lockfiles with mtime-based stale cleanup, mirroring
 * codex-statebar, so concurrent pi processes deduplicate probes. Negative
 * cache entries are ordinary entries whose `data` carries a marker field.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Injectable fs seam so tests can stub IO instead of touching disk. */
export interface FileCacheOverrides {
	readFile?: (filePath: string) => string;
	writeFile?: (filePath: string, data: string) => void;
	exists?: (filePath: string) => boolean;
	mkdir?: (dirPath: string) => void;
}

export interface CacheEntry {
	data: unknown;
	fetchedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Filesystem-safe key: `relay:api.example.com` -> `relay_api.example.com`. */
function slug(key: string): string {
	return key.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class FileCache {
	private readonly root: string;
	private readonly overrides: FileCacheOverrides | undefined;
	private rootReady = false;
	/** Lock creation times — staleness source when running on the seam. */
	private readonly lockTimes = new Map<string, number>();

	constructor(dirName: string, overrides?: FileCacheOverrides) {
		this.root = path.join(os.tmpdir(), dirName);
		this.overrides = overrides;
	}

	/** Read an entry; missing or corrupt files yield undefined. */
	get(key: string): CacheEntry | undefined {
		const text = this.readText(this.entryFile(key));
		if (text === null) {
			return undefined;
		}
		try {
			const parsed: unknown = JSON.parse(text);
			if (!isRecord(parsed)) {
				return undefined;
			}
			const fetchedAt = parsed.fetchedAt;
			if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt)) {
				return undefined;
			}
			if (!("data" in parsed)) {
				return undefined;
			}
			return { data: parsed.data, fetchedAt };
		} catch {
			return undefined;
		}
	}

	/** Atomically write an entry: temp file in the same dir, then rename. */
	set(key: string, data: unknown, fetchedAt: number): void {
		const file = this.entryFile(key);
		this.ensureRoot();
		const text = JSON.stringify({ data, fetchedAt });
		if (this.overrides) {
			this.writeText(file, text);
			return;
		}
		const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
		try {
			fs.writeFileSync(tmp, text, "utf8");
			fs.renameSync(tmp, file);
		} catch {
			try {
				fs.unlinkSync(tmp);
			} catch {
				// best effort: leave nothing half-written behind
			}
		}
	}

	/**
	 * Best-effort inflight lock. Returns a release function when acquired;
	 * null when a fresh lock is held by another process. A lock older than
	 * `ttlMs` is removed and acquisition retried once.
	 */
	tryInflightLock(key: string, ttlMs = 60_000): (() => void) | null {
		this.ensureRoot();
		const lock = this.lockFile(key);
		for (let attempt = 0; attempt < 2; attempt++) {
			if (this.tryCreate(lock)) {
				return () => this.removeQuiet(lock);
			}
			const held = this.mtimeOf(lock);
			if (held !== null && Date.now() - held > ttlMs) {
				this.removeQuiet(lock);
				continue; // stale holder: retry once
			}
			return null;
		}
		return null;
	}

	private entryFile(key: string): string {
		return path.join(this.root, `${slug(key)}.json`);
	}

	private lockFile(key: string): string {
		return path.join(this.root, `${slug(key)}.lock`);
	}

	private ensureRoot(): void {
		if (this.rootReady) {
			return;
		}
		this.rootReady = true;
		try {
			if (this.overrides?.mkdir) {
				this.overrides.mkdir(this.root);
			} else {
				fs.mkdirSync(this.root, { recursive: true });
			}
		} catch {
			// best effort: per-call writes already fail quietly
		}
	}

	private readText(file: string): string | null {
		try {
			return this.overrides?.readFile
				? this.overrides.readFile(file)
				: fs.readFileSync(file, "utf8");
		} catch {
			return null;
		}
	}

	private writeText(file: string, text: string): void {
		try {
			if (this.overrides?.writeFile) {
				this.overrides.writeFile(file, text);
			} else {
				fs.writeFileSync(file, text, "utf8");
			}
		} catch {
			// best effort: cache is an optimization, never a crash source
		}
	}

	private tryCreate(lock: string): boolean {
		try {
			if (this.overrides) {
				// No unlink in the seam: lock existence is tracked per instance.
				if (this.lockTimes.has(lock)) {
					return false;
				}
				this.lockTimes.set(lock, Date.now());
			} else {
				const fd = fs.openSync(lock, "wx"); // O_CREAT | O_EXCL
				fs.closeSync(fd);
				this.lockTimes.set(lock, Date.now());
			}
			return true;
		} catch {
			return false; // EEXIST or IO failure: caller proceeds unlocked
		}
	}

	private removeQuiet(file: string): void {
		this.lockTimes.delete(file);
		try {
			fs.unlinkSync(file);
		} catch {
			// already gone, or running on the override seam
		}
	}

	private mtimeOf(lock: string): number | null {
		if (this.overrides) {
			return this.lockTimes.get(lock) ?? null;
		}
		try {
			return fs.statSync(lock).mtimeMs;
		} catch {
			return null;
		}
	}
}
