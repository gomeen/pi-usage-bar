/**
 * Footer adapter: single-line status via setStatus; multi-line (wrapped)
 * rendering via setFooter, preserving other extensions' status lines.
 * Decision (issue 010): wrap, never truncate silently.
 */
import type { Component } from "@earendil-works/pi-tui";

export const STATUS_KEY = "pi-usage-bar";

/** Structural subset of the pi UI context the footer needs. */
export interface FooterUIContext {
	setStatus(key: string, text: string | undefined): void;
	setFooter(
		factory:
			| ((
					tui: unknown,
					theme: unknown,
					footerData: {
						getExtensionStatuses(): ReadonlyMap<string, string>;
					},
			  ) => Component & { dispose?(): void })
			| undefined,
	): void;
	hasCustomFooter?: boolean;
}

class BuilderComponent implements Component {
	private cache = new Map<number, string[]>();
	constructor(
		private build: (width: number) => string[],
		private tail: string[],
	) {}
	render(width: number): string[] {
		let lines = this.cache.get(width);
		if (!lines) {
			lines = this.build(width).filter((l) => l.length > 0);
			this.cache.set(width, lines);
		}
		return [...lines, ...this.tail];
	}
	invalidate(): void {
		this.cache.clear();
	}
}

let footerInstalled = false;

/**
 * Publish rendered lines. One line → plain setStatus (no layout takeover).
 * Multiple lines → install a custom footer that stacks our lines first and
 * keeps every other extension's status lines below ours.
 */
export function publishFooter(
	ctx: FooterUIContext,
	build: (width: number) => string[],
): void {
	const initial = build(currentWidth());
	const list = initial.filter((l) => l.length > 0);
	if (list.length <= 1) {
		if (footerInstalled) {
			ctx.setFooter(undefined);
			footerInstalled = false;
		}
		ctx.setStatus(STATUS_KEY, list[0]);
		return;
	}

	ctx.setStatus(STATUS_KEY, undefined);
	ctx.setFooter((tui, theme, footerData) => {
		const others: string[] = [];
		const statuses = footerData.getExtensionStatuses();
		for (const [key, text] of statuses) {
			if (key !== STATUS_KEY && text) others.push(text);
		}
		return new BuilderComponent(build, others);
	});
	footerInstalled = true;
}

function currentWidth(): number {
	return process.stdout.columns && process.stdout.columns > 0
		? process.stdout.columns
		: 120;
}

/** Clear everything we own (idempotent — also used from session_shutdown). */
export function clearFooter(ctx: FooterUIContext): void {
	ctx.setStatus(STATUS_KEY, undefined);
	if (footerInstalled) {
		ctx.setFooter(undefined);
		footerInstalled = false;
	}
}
