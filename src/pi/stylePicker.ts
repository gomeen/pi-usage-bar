/**
 * Live-preview style picker (cs `cs theme` experience): renders every look
 * with the user's real data, arrow keys move the highlight, Enter applies.
 * Runs as a fullscreen custom screen (not an overlay) so it never blends
 * into the editor behind it.
 */
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { renderStatus } from "../render/layout.js";
import { applyColorOverrides, GRAPHITE } from "../render/theme.js";
import type { Palette, UsageBarConfig, UsageSnapshot } from "../types.js";

export interface StyleVariant {
	id: string;
	label: string;
	style: UsageBarConfig["style"];
	glyph: UsageBarConfig["bar_glyph"];
}

/** The four looks: thin only applies to aurora; ring/classic ignore glyph. */
export const STYLE_VARIANTS: readonly StyleVariant[] = [
	{
		id: "aurora-block",
		label: "aurora block",
		style: "aurora",
		glyph: "block",
	},
	{ id: "aurora-thin", label: "aurora thin", style: "aurora", glyph: "thin" },
	{ id: "ring", label: "ring", style: "ring", glyph: "block" },
	{ id: "classic", label: "classic", style: "classic", glyph: "block" },
];

/** Fallback demo data so the picker always previews something. */
const DEMO: UsageSnapshot = {
	provider: "codex",
	plan: "codex",
	windows: [
		{
			label: "5h",
			percent: 42,
			resetsAt: 2 * 3_600_000 + 15 * 60_000,
			durationSeconds: 18000,
		},
		{
			label: "7d",
			percent: 83,
			resetsAt: 3 * 86_400_000 + 4 * 3_600_000,
			durationSeconds: 604800,
		},
	],
	status: "ok",
	fetchedAt: 0,
};

/** One preview line per variant, rendered with the given config overrides. */
export function buildVariantPreviews(
	snapshots: UsageSnapshot[],
	config: UsageBarConfig,
	palette: Palette,
	now: number,
): string[] {
	const sample =
		snapshots.find((s) => s.status === "ok" && s.windows.length > 0) ?? DEMO;
	// Demo resetsAt is relative to epoch 0; make it relative to `now`.
	const demoAdjusted: UsageSnapshot = {
		...sample,
		windows: sample.windows.map((w) => ({
			...w,
			resetsAt:
				w.resetsAt !== null && sample === DEMO ? now + w.resetsAt : w.resetsAt,
		})),
	};
	return STYLE_VARIANTS.map((v) => {
		const cfg: UsageBarConfig = {
			...config,
			style: v.style,
			bar_glyph: v.glyph,
			display: { ...config.display, compact_others: false },
		};
		const lines = renderStatus([demoAdjusted], cfg, 78, palette, now);
		return lines[0] ?? "";
	});
}

interface ThemeLike {
	fg(token: string, text: string): string;
}

export class StylePickerComponent implements Component {
	constructor(
		private keybindings: { matches(data: string, action: string): boolean },
		private requestRender: () => void,
		private previews: string[],
		private labels: string[],
		private selected: number,
		private done: (result: StyleVariant | null) => void,
		private theme: ThemeLike,
		private border: DynamicBorder,
	) {}

	render(width: number): string[] {
		const t = this.theme;
		const lines: string[] = [
			t.fg("accent", " usage-bar style"),
			"",
			t.fg("dim", " pick a look — previews use your live data"),
			...this.border.render(width),
			"",
		];
		for (let i = 0; i < this.labels.length; i++) {
			const marker = i === this.selected ? "❯ " : "  ";
			const head =
				i === this.selected
					? `${t.fg("accent", marker)}${t.fg("main", this.labels[i] ?? "")}`
					: `${marker}${t.fg("dim", this.labels[i] ?? "")}`;
			lines.push(`${head}   ${this.previews[i] ?? ""}`);
		}
		lines.push("");
		lines.push(...this.border.render(width));
		lines.push("");
		lines.push(t.fg("dim", " ↑↓ move · Enter apply · Esc cancel"));
		return lines;
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "tui.select.up")) {
			this.selected =
				(this.selected - 1 + this.labels.length) % this.labels.length;
			this.invalidate();
			this.requestRender();
		} else if (this.keybindings.matches(data, "tui.select.down")) {
			this.selected = (this.selected + 1) % this.labels.length;
			this.invalidate();
			this.requestRender();
		} else if (this.keybindings.matches(data, "tui.select.confirm")) {
			this.done(STYLE_VARIANTS[this.selected] ?? null);
		} else if (this.keybindings.matches(data, "tui.select.cancel")) {
			this.done(null);
		}
	}

	invalidate(): void {
		this.border.invalidate();
	}
	dispose(): void {
		// nothing to release
	}
}

export interface PickerUI {
	custom<T>(
		factory: (
			tui: unknown,
			theme: unknown,
			keybindings: { matches(data: string, action: string): boolean },
			done: (result: T) => void,
		) => unknown,
		options?: { overlay?: boolean },
	): Promise<T>;
}

/**
 * Show the picker; resolves with the chosen variant or null on cancel.
 * Applies nothing itself — the caller saves and re-renders.
 */
export async function pickStyleVariant(
	ui: PickerUI,
	snapshots: UsageSnapshot[],
	config: UsageBarConfig,
	now: number,
): Promise<StyleVariant | null> {
	const palette = applyColorOverrides(
		GRAPHITE,
		config.color_ok,
		config.color_warn,
		config.color_hot,
	);
	const previews = buildVariantPreviews(snapshots, config, palette, now);
	const labels = STYLE_VARIANTS.map((v) => v.label);
	const currentIndex = Math.max(
		0,
		STYLE_VARIANTS.findIndex(
			(v) => v.style === config.style && v.glyph === config.bar_glyph,
		),
	);
	return ui.custom<StyleVariant | null>((tui, theme, keybindings, done) => {
		const th = theme as ThemeLike;
		// DynamicBorder note: pass an explicit color fn (jiti theme caveat).
		const border = new DynamicBorder((s: string) => th.fg("accent", s));
		return new StylePickerComponent(
			keybindings,
			() => (tui as { requestRender(): void }).requestRender(),
			previews,
			labels,
			currentIndex,
			done,
			th,
			border,
		);
	});
}
