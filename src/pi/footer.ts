/**
 * Display adapter (D3 takeover, prototype/footer-merged-line.html).
 *
 * When pi exposes setFooter, we take the footer over completely: our rows
 * (usage bars + right-aligned model on row one) replace pi's built-in footer
 * content (pwd / token stats / model — dropped by the prototype decision),
 * while other extensions' statuses keep their own line, mirroring pi's
 * built-in behavior. On older pi builds without setFooter we fall back to
 * the previous single-line/multi-line split below.
 */

import type {
	ReadonlyFooterDataProvider,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";

export const STATUS_KEY = "pi-usage-bar";

/** Exact pi setFooter factory signature (types.d.ts L122) so ExtensionUIContext
 * is structurally assignable to DisplayUIContext without casts. */
type FooterFactory = (
	tui: TUI,
	theme: Theme,
	data: ReadonlyFooterDataProvider,
) => Component & { dispose?(): void };

export interface DisplayUIContext {
	setStatus(key: string, text: string | undefined): void;
	setWidget(
		key: string,
		content:
			| string[]
			| undefined
			| ((tui: TUI, theme: Theme) => Component & { dispose?(): void }),
		options?: { placement?: "aboveEditor" | "belowEditor" },
	): void;
	/** Present on pi builds that allow full footer takeover (D3). */
	setFooter?(factory: FooterFactory | undefined): void;
}

/** Mirror of pi's footer sanitize: one line, collapsed spaces. */
function sanitizeStatusText(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function currentWidth(): number {
	return process.stdout.columns && process.stdout.columns > 0
		? process.stdout.columns
		: 120;
}

/**
 * The takeover footer: fresh rows every frame (the model label and the
 * editor chip read live session state, so caching by width would freeze
 * them), then other extensions' statuses on their own line.
 */
class TakeoverFooter implements Component {
	constructor(
		private build: (width: number) => string[],
		private data: ReadonlyFooterDataProvider,
	) {}
	render(width: number): string[] {
		const lines = this.build(width).filter((l) => l.trim().length > 0);
		const statuses = Array.from(this.data.getExtensionStatuses().entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([, text]) => sanitizeStatusText(text));
		if (statuses.length > 0) {
			lines.push(truncateToWidth(statuses.join(" "), width, "…"));
		}
		return lines;
	}
	invalidate(): void {}
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
let footerInstalled = false;

/**
 * Publish rendered lines. On pi builds with setFooter, take the footer over
 * (D3) — including while usage data is still loading, so the stock footer
 * (pwd/stats/model, dropped by D3) never flashes and then disappears. On
 * older pi builds without setFooter, fall back to the historical split: one
 * line shares the standard footer status; more than one becomes a
 * belowEditor widget so the built-in footer survives.
 */
export function publishDisplay(
	ctx: DisplayUIContext,
	build: (width: number) => string[],
): void {
	if (typeof ctx.setFooter === "function") {
		if (widgetInstalled) {
			ctx.setWidget(STATUS_KEY, undefined);
			widgetInstalled = false;
		}
		ctx.setStatus(STATUS_KEY, undefined);
		ctx.setFooter((_tui, _theme, data) => new TakeoverFooter(build, data));
		footerInstalled = true;
		return;
	}

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
	if (footerInstalled) {
		if (typeof ctx.setFooter === "function") ctx.setFooter(undefined);
		footerInstalled = false;
	}
}
