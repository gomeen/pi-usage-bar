/**
 * Slash commands: /usage (detail view) and /usage-bar (dialog-based config
 * editor). Interaction decisions: issue 009 (dialog-driven, no subcommand
 * syntax), v1 scopes providerMap editing to the config file.
 */

import {
	DynamicBorder,
	type getSettingsListTheme,
} from "@earendil-works/pi-coding-agent";
import {
	type SettingItem,
	SettingsList,
	type SettingsListTheme,
} from "@earendil-works/pi-tui";
import { configFilePath, loadConfig, sparseSave } from "../config.js";
import { planDisplayLabel } from "../detect.js";
import { applyColorOverrides, GRAPHITE } from "../render/theme.js";
import type { UsageBarConfig, UsageSnapshot } from "../types.js";
import {
	buildVariantPreviews,
	STYLE_VARIANTS,
	StylePickerComponent,
} from "./stylePicker.js";

export interface CommandUIContext {
	select(
		title: string,
		options: string[],
		opts?: unknown,
	): Promise<string | undefined>;
	notify(message: string, type?: "info" | "warning" | "error"): void;
	custom<T>(
		factory: (
			tui: unknown,
			theme: unknown,
			keybindings: {
				matches(data: string, action: string): boolean;
			},
			done: (result: T) => void,
		) => unknown,
		options?: { overlay?: boolean },
	): Promise<T>;
}

function describeSnapshot(s: UsageSnapshot): string[] {
	const lines: string[] = [];
	lines.push(`Provider: ${s.provider}  (${planDisplayLabel(s.plan)})`);
	if (s.status === "error" && s.error) {
		lines.push(
			`State: ${s.error.startsWith("no billing endpoint") ? "no billing endpoint (hidden)" : s.error}`,
		);
		return lines;
	}
	for (const w of s.windows) {
		const pct = w.percent === null ? "--%" : `${Math.round(w.percent)}%`;
		const reset = w.resetsAt
			? new Date(w.resetsAt).toISOString().replace("T", " ").slice(0, 16) +
				" UTC"
			: "unknown";
		lines.push(`${w.label}: ${pct}   resets ${reset}`);
	}
	if (s.balance) {
		lines.push(`Balance: ${s.balance.amount.toFixed(2)} (${s.balance.kind})`);
	}
	if (s.announcement) {
		lines.push(`${s.announcement.text}`);
	}
	lines.push(
		`Fetched: ${new Date(s.fetchedAt).toISOString().replace("T", " ").slice(0, 19)} UTC`,
	);
	return lines;
}

/** /usage — pick a provider, show its detail lines. */
export async function runUsageCommand(
	ui: CommandUIContext,
	snapshots: UsageSnapshot[],
): Promise<void> {
	if (snapshots.length === 0) {
		ui.notify("No usage data yet — wait for the first refresh.", "info");
		return;
	}
	const labels = snapshots.map(
		(s) => `${planDisplayLabel(s.plan)} · ${s.provider}`,
	);
	const choice = await ui.select("Usage details", labels);
	if (choice === undefined) return;
	const idx = labels.indexOf(choice);
	const snap = snapshots[idx];
	if (!snap) return;
	const back = await ui.select(
		`${planDisplayLabel(snap.plan)} · ${snap.provider}`,
		[...describeSnapshot(snap), "Back"],
	);
	void back;
}

interface Category {
	label: string;
	values(): string[];
	read(cfg: UsageBarConfig): string;
	write(cfg: UsageBarConfig, value: string): void;
}

const num = (v: string): number => Math.trunc(Number.parseInt(v, 10));

const CATEGORIES: Category[] = [
	{
		label: "style",
		values: () => ["aurora", "ring", "classic"],
		read: (c) => c.style,
		write: (c, v) => {
			c.style = v as UsageBarConfig["style"];
		},
	},
	{
		label: "bar_glyph",
		values: () => ["block", "thin"],
		read: (c) => c.bar_glyph,
		write: (c, v) => {
			c.bar_glyph = v as UsageBarConfig["bar_glyph"];
		},
	},
	{
		label: "theme (palette)",
		values: () => ["graphite", "pi"],
		read: (c) => c.theme,
		write: (c, v) => {
			c.theme = v as UsageBarConfig["theme"];
		},
	},
	{
		label: "density",
		values: () => ["compact", "regular", "cozy"],
		read: (c) => c.density,
		write: (c, v) => {
			c.density = v as UsageBarConfig["density"];
		},
	},
	{
		label: "display.mode",
		values: () => ["active", "all"],
		read: (c) => c.display.mode,
		write: (c, v) => {
			c.display.mode = v as UsageBarConfig["display"]["mode"];
		},
	},
	{
		label: "refresh_minutes",
		values: () => ["1", "2", "5", "10"],
		read: (c) => String(c.refresh_minutes),
		write: (c, v) => {
			if (num(v) >= 1) c.refresh_minutes = num(v);
		},
	},
	{
		label: "show_reset_countdown (⏰)",
		values: () => ["true", "false"],
		read: (c) => String(c.show_reset_countdown),
		write: (c, v) => {
			c.show_reset_countdown = v === "true";
		},
	},
	{
		label: "show_resets",
		values: () => ["true", "false"],
		read: (c) => String(c.show_resets),
		write: (c, v) => {
			c.show_resets = v === "true";
		},
	},
	{
		label: "show_balance",
		values: () => ["true", "false"],
		read: (c) => String(c.show_balance),
		write: (c, v) => {
			c.show_balance = v === "true";
		},
	},
	{
		label: "currency",
		values: () => ["$", "¥", "€"],
		read: (c) => c.currency,
		write: (c, v) => {
			c.currency = v;
		},
	},
];

/** /usage-bar — dialog-based settings editor (issue 009: no subcommand syntax). */
interface Setting {
	id: string;
	label: string;
	description?: string;
	read(cfg: UsageBarConfig): string;
	write(cfg: UsageBarConfig, value: string): void;
	values(): string[];
}

const SETTINGS: readonly Setting[] = [
	{
		id: "style",
		label: "style",
		description: "Bar look family",
		read: (c) => c.style,
		write: (c, v) => {
			c.style = v as UsageBarConfig["style"];
		},
		values: () => ["aurora", "ring", "classic"],
	},
	{
		id: "bar_glyph",
		label: "bar_glyph",
		description: "aurora cell glyph",
		read: (c) => c.bar_glyph,
		write: (c, v) => {
			c.bar_glyph = v as UsageBarConfig["bar_glyph"];
		},
		values: () => ["block", "thin"],
	},
	{
		id: "theme",
		label: "theme",
		description: "graphite palette, or follow your pi theme",
		read: (c) => c.theme,
		write: (c, v) => {
			c.theme = v as UsageBarConfig["theme"];
		},
		values: () => ["graphite", "pi"],
	},
	{
		id: "density",
		label: "density",
		description: "Spacing between segments",
		read: (c) => c.density,
		write: (c, v) => {
			c.density = v as UsageBarConfig["density"];
		},
		values: () => ["compact", "regular", "cozy"],
	},
	{
		id: "bar_width",
		label: "bar_width",
		description: "Cells per bar",
		read: (c) => String(c.bar_width),
		write: (c, v) => {
			const n = Number.parseInt(v, 10);
			if (Number.isFinite(n)) c.bar_width = n;
		},
		values: () => ["8", "10", "12", "16"],
	},
	{
		id: "display.mode",
		label: "display.mode",
		description: "active = only the current plan; all = every configured plan",
		read: (c) => c.display.mode,
		write: (c, v) => {
			c.display.mode = v as UsageBarConfig["display"]["mode"];
		},
		values: () => ["active", "all"],
	},
	{
		id: "display.compact_others",
		label: "display.compact_others",
		description: "Collapse non-active plans into one summary line",
		read: (c) => String(c.display.compact_others),
		write: (c, v) => {
			c.display.compact_others = v === "true";
		},
		values: () => ["true", "false"],
	},
	{
		id: "show_reset_countdown",
		label: "show_reset_countdown",
		description: "Per-window ⏰ reset countdowns",
		read: (c) => String(c.show_reset_countdown),
		write: (c, v) => {
			c.show_reset_countdown = v === "true";
		},
		values: () => ["true", "false"],
	},
	{
		id: "show_resets",
		label: "show_resets",
		description: "Official Codex reset announcements (codex-resets.com)",
		read: (c) => String(c.show_resets),
		write: (c, v) => {
			c.show_resets = v === "true";
		},
		values: () => ["true", "false"],
	},
	{
		id: "show_balance",
		label: "show_balance",
		description: "Relay balance probing",
		read: (c) => String(c.show_balance),
		write: (c, v) => {
			c.show_balance = v === "true";
		},
		values: () => ["true", "false"],
	},
	{
		id: "currency",
		label: "currency",
		description: "Balance unit",
		read: (c) => c.currency,
		write: (c, v) => {
			c.currency = v;
		},
		values: () => ["$", "¥", "€"],
	},
	{
		id: "refresh_minutes",
		label: "refresh_minutes",
		description: "Poll interval",
		read: (c) => String(c.refresh_minutes),
		write: (c, v) => {
			const n = Number.parseInt(v, 10);
			if (Number.isFinite(n) && n >= 1) c.refresh_minutes = n;
		},
		values: () => ["1", "2", "5", "10"],
	},
];

const SECTIONS: readonly { header: string; ids: readonly string[] }[] = [
	{
		header: "Look",
		ids: ["style", "bar_glyph", "theme", "density", "bar_width"],
	},
	{
		header: "Display",
		ids: [
			"display.mode",
			"display.compact_others",
			"show_reset_countdown",
			"show_resets",
			"show_balance",
			"currency",
		],
	},
	{ header: "Data", ids: ["refresh_minutes"] },
];

/**
 * /usage-bar settings — a pi-style SettingsList (searchable, Enter cycles
 * values, live apply) with section headers, plus a live-preview style picker
 * submenu. providerMap stays file-edited (structured data; noted in-list).
 */
export async function runConfigCommand(
	ui: CommandUIContext,
	onChanged: (cfg: UsageBarConfig) => void,
	snapshots: UsageSnapshot[] = [],
): Promise<void> {
	const cfg = loadConfig();

	await ui.custom<null>((tui, theme, keybindings, done) => {
		// Build the list theme from the factory-passed theme object — the
		// global theme inside getSettingsListTheme() may be undefined when
		// this extension loads via jiti (DynamicBorder carries the same note).
		const th = theme as { fg(token: string, text: string): string };
		const listTheme: SettingsListTheme = {
			label: (text, selected) => (selected ? th.fg("accent", text) : text),
			value: (text, selected) =>
				selected ? th.fg("accent", text) : th.fg("muted", text),
			description: (text) => th.fg("dim", text),
			cursor: th.fg("accent", "→ "),
			hint: (text) => th.fg("dim", text),
		};
		const requestRender = () =>
			(tui as { requestRender(): void }).requestRender();

		const apply = (id: string, value: string): void => {
			const setting = SETTINGS.find((s) => s.id === id);
			if (!setting) return;
			setting.write(cfg, value);
			sparseSave(cfg);
			onChanged(cfg);
		};

		const items: SettingItem[] = [];
		const pickerSetting = makeStylePickerItem(
			cfg,
			snapshots,
			keybindings,
			requestRender,
			apply,
			listTheme,
		);
		items.push(pickerSetting);
		for (const section of SECTIONS) {
			items.push({
				id: `header:${section.header}`,
				label: `— ${section.header} —`,
				currentValue: "",
			});
			for (const id of section.ids) {
				const setting = SETTINGS.find((s) => s.id === id);
				if (!setting) continue;
				items.push({
					id: setting.id,
					label: setting.label,
					...(setting.description ? { description: setting.description } : {}),
					currentValue: setting.read(cfg),
					values: setting.values(),
				});
			}
		}
		items.push({
			id: "providerMap",
			label: "providerMap",
			description: `Custom provider mapping — edit ${configFilePath()}`,
			currentValue: `${Object.keys(cfg.providerMap).length} entries`,
		});

		const list = new SettingsList(
			items,
			14,
			listTheme,
			(id, newValue) => {
				apply(id, newValue);
				const setting = SETTINGS.find((s) => s.id === id);
				if (setting) list.updateValue(id, setting.read(cfg));
				requestRender();
			},
			() => done(null),
			{ enableSearch: true },
		);
		return list;
	});
}

/** Style-picker entry: opens the live-preview submenu component. */
function makeStylePickerItem(
	cfg: UsageBarConfig,
	snapshots: UsageSnapshot[],
	keybindings: { matches(data: string, action: string): boolean },
	requestRender: () => void,
	apply: (id: string, value: string) => void,
	listTheme: SettingsListTheme,
): SettingItem {
	const palette = applyColorOverrides(
		GRAPHITE,
		cfg.color_ok,
		cfg.color_warn,
		cfg.color_hot,
	);
	const previews = buildVariantPreviews(snapshots, cfg, palette, Date.now());
	const labels = STYLE_VARIANTS.map((v) => v.label);
	const currentIndex = Math.max(
		0,
		STYLE_VARIANTS.findIndex(
			(v) => v.style === cfg.style && v.glyph === cfg.bar_glyph,
		),
	);
	const currentLabel = STYLE_VARIANTS[currentIndex]?.label ?? "";
	return {
		id: "style-picker",
		label: "Style picker",
		description: "Preview every look with your live data",
		currentValue: currentLabel,
		submenu: (_currentValue, submenuDone) =>
			new StylePickerComponent(
				keybindings,
				requestRender,
				previews,
				labels,
				currentIndex,
				(result) => {
					if (result) {
						cfg.style = result.style;
						cfg.bar_glyph = result.glyph;
						sparseSave(cfg);
						apply("style", result.style);
						apply("bar_glyph", result.glyph);
					}
					submenuDone();
				},
				pickerThemeFrom(listTheme),
				new DynamicBorder((str: string) =>
					pickerThemeFrom(listTheme).fg("dim", str),
				),
			),
	};
}

function pickerThemeFrom(listTheme: ReturnType<typeof getSettingsListTheme>): {
	fg(token: string, text: string): string;
} {
	// Reuse the settings list's own styler for picker chrome.
	const style = (text: string, selected: boolean) =>
		listTheme.label(text, selected);
	return {
		fg: (token: string, text: string) => style(text, token === "accent"),
	};
}
