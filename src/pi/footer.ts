/**
 * Display adapter (issue: never hijack pi's footer).
 * - Single line → setStatus: shares the standard footer next to pi's own info.
 * - Multiple lines → setWidget belowEditor: a persistent block under the
 *   editor, width-aware, leaving the built-in footer (model info, other
 *   extensions) fully intact. setFooter is deliberately never used.
 */
import type { Component } from "@earendil-works/pi-tui";

export const STATUS_KEY = "pi-usage-bar";

export interface DisplayUIContext {
	setStatus(key: string, text: string | undefined): void;
	setWidget(
		key: string,
		content:
			| string[]
			| undefined
			| ((tui: unknown, theme: unknown) => Component & { dispose?(): void }),
		options?: { placement?: "aboveEditor" | "belowEditor" },
	): void;
}

class BuilderComponent implements Component {
	private cache = new Map<number, string[]>();
	constructor(private build: (width: number) => string[]) {}
	render(width: number): string[] {
		let lines = this.cache.get(width);
		if (!lines) {
			lines = this.build(width).filter((l) => l.trim().length > 0);
			this.cache.set(width, lines);
		}
		return lines;
	}
	invalidate(): void {
		this.cache.clear();
	}
}

let widgetInstalled = false;

function currentWidth(): number {
	return process.stdout.columns && process.stdout.columns > 0
		? process.stdout.columns
		: 120;
}

/**
 * Publish rendered lines. One line goes to the shared footer status; more
 * than one becomes a belowEditor widget so pi's default footer survives.
 */
export function publishDisplay(
	ctx: DisplayUIContext,
	build: (width: number) => string[],
): void {
	const initial = build(currentWidth()).filter((l) => l.trim().length > 0);
	if (initial.length <= 1) {
		if (widgetInstalled) {
			ctx.setWidget(STATUS_KEY, undefined);
			widgetInstalled = false;
		}
		ctx.setStatus(STATUS_KEY, initial[0]);
		return;
	}

	ctx.setStatus(STATUS_KEY, undefined);
	ctx.setWidget(STATUS_KEY, (_tui, _theme) => new BuilderComponent(build), {
		placement: "belowEditor",
	});
	widgetInstalled = true;
}

/** Clear everything we own (idempotent — also used from session_shutdown). */
export function clearDisplay(ctx: DisplayUIContext): void {
	ctx.setStatus(STATUS_KEY, undefined);
	if (widgetInstalled) {
		ctx.setWidget(STATUS_KEY, undefined);
		widgetInstalled = false;
	}
}
