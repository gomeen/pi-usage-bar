import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FileCache } from "../src/cache";

let seq = 0;
const roots: string[] = [];
function newCache(): { cache: FileCache; root: string } {
	const dir = `pi-usage-bar-cache-test-${process.pid}-${Date.now()}-${seq++}`;
	const root = path.join(os.tmpdir(), dir);
	roots.push(root);
	return { cache: new FileCache(dir), root };
}
afterAll(() => {
	for (const root of roots) {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

describe("FileCache entries", () => {
	it("round-trips entries and isolates keys", () => {
		const { cache } = newCache();
		cache.set("relay:api.example.com", { amount: 58 }, 123);
		cache.set("codex-resets", { absent: true }, 456);
		expect(cache.get("relay:api.example.com")).toEqual({
			data: { amount: 58 },
			fetchedAt: 123,
		});
		expect(cache.get("codex-resets")).toEqual({
			data: { absent: true },
			fetchedAt: 456,
		});
		expect(cache.get("missing")).toBeUndefined();
	});

	it("creates the root lazily and writes a real JSON file", () => {
		const { cache, root } = newCache();
		expect(fs.existsSync(root)).toBe(false);
		cache.set("k", [1, 2], 7);
		expect(fs.existsSync(root)).toBe(true);
		const raw = JSON.parse(
			fs.readFileSync(path.join(root, "k.json"), "utf8"),
		) as unknown;
		expect(raw).toEqual({ data: [1, 2], fetchedAt: 7 });
	});

	it("yields undefined for corrupt or malformed entries", () => {
		const { cache, root } = newCache();
		cache.set("k", { a: 1 }, 1); // ensure root exists
		fs.writeFileSync(path.join(root, "corrupt.json"), "{not json", "utf8");
		fs.writeFileSync(
			path.join(root, "noStamp.json"),
			JSON.stringify({ data: 1 }),
			"utf8",
		);
		expect(cache.get("corrupt")).toBeUndefined();
		expect(cache.get("noStamp")).toBeUndefined();
		expect(cache.get("k")).toEqual({ data: { a: 1 }, fetchedAt: 1 });
	});
});

describe("FileCache inflight locks", () => {
	it("acquires, rejects a second holder, and re-acquires after release", () => {
		const { cache, root } = newCache();
		const release = cache.tryInflightLock("relay:h");
		expect(release).toBeTypeOf("function");
		expect(cache.tryInflightLock("relay:h")).toBeNull();
		release?.();
		expect(fs.existsSync(path.join(root, "relay_h.lock"))).toBe(false);
		const again = cache.tryInflightLock("relay:h");
		expect(again).toBeTypeOf("function");
		again?.();
	});

	it("steals a stale lock past its ttl", () => {
		const { cache, root } = newCache();
		const lock = path.join(root, "stale.lock");
		cache.tryInflightLock("stale"); // held by "another process"
		const old = new Date(Date.now() - 120_000);
		fs.utimesSync(lock, old, old); // backdate its mtime
		const stolen = cache.tryInflightLock("stale", 60_000);
		expect(stolen).toBeTypeOf("function");
		stolen?.();
	});

	it("does not steal a fresh lock", () => {
		const { cache } = newCache();
		cache.tryInflightLock("fresh");
		expect(cache.tryInflightLock("fresh", 60_000)).toBeNull();
	});
});

describe("FileCache fs seam", () => {
	it("runs on injected overrides", () => {
		const files = new Map<string, string>();
		const cache = new FileCache("seam-test", {
			readFile: (p) => {
				const v = files.get(p);
				if (v === undefined) {
					throw new Error("ENOENT");
				}
				return v;
			},
			writeFile: (p, data) => {
				files.set(p, data);
			},
			exists: (p) => files.has(p),
			mkdir: () => {},
		});
		cache.set("k", { a: 1 }, 5);
		expect(cache.get("k")).toEqual({ data: { a: 1 }, fetchedAt: 5 });
		const release = cache.tryInflightLock("k");
		expect(release).toBeTypeOf("function");
		expect(cache.tryInflightLock("k")).toBeNull();
		release?.();
		expect(cache.tryInflightLock("k")).toBeTypeOf("function");
	});
});
