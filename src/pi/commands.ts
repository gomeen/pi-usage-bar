/** Single /usage menu with details, configuration, and a live preview. */

import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
	type SettingItem,
	SettingsList,
	type SettingsListTheme,
	Text,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import { configFilePath, loadConfig, sparseSave } from "../config.js";
import { planDisplayLabel } from "../detect.js";
import { applyColorOverrides, GRAPHITE } from "../render/theme.js";
import type { UsageBarConfig, UsageSnapshot } from "../types.js";
import { type ActiveUsage, buildUsagePreview } from "./preview.js";
import {
	buildVariantPreviews,
	STYLE_VARIANTS,
	StylePickerComponent,
} from "./stylePicker.js";
import { paletteFromPiTheme } from "./theme.js";

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

interface Setting {
	id: string;
	label: string;
	description: string;
	read(cfg: UsageBarConfig): string;
	write(cfg: UsageBarConfig, value: string): void;
	values: string[];
}

const SETTINGS: readonly Setting[] = [
	{
		id: "theme",
		label: "Color theme",
		description: "Use the Graphite palette or follow your Pi theme.",
		read: (c) => (c.theme === "pi" ? "Pi theme" : "Graphite"),
		write: (c, v) => {
			c.theme = v === "Pi theme" ? "pi" : "graphite";
		},
		values: ["Graphite", "Pi theme"],
	},
	{
		id: "density",
		label: "Spacing",
		description: "Space between usage windows and provider segments.",
		read: (c) =>
			c.density === "compact"
				? "Compact"
				: c.density === "cozy"
					? "Cozy"
					: "Regular",
		write: (c, v) => {
			c.density =
				v === "Compact" ? "compact" : v === "Cozy" ? "cozy" : "regular";
		},
		values: ["Compact", "Regular", "Cozy"],
	},
	{
		id: "bar_width",
		label: "Bar width",
		description: "Number of cells in each usage bar.",
		read: (c) => `${c.bar_width} cells`,
		write: (c, v) => {
			const n = Number.parseInt(v, 10);
			if (Number.isFinite(n)) c.bar_width = n;
		},
		values: ["8 cells", "10 cells", "12 cells", "16 cells"],
	},
	{
		id: "display.mode",
		label: "Show plans",
		description: "Show all configured plans or only the current model's plan.",
		read: (c) => (c.display.mode === "all" ? "All plans" : "Current plan"),
		write: (c, v) => {
			c.display.mode = v === "All plans" ? "all" : "active";
		},
		values: ["All plans", "Current plan"],
	},
	{
		id: "display.compact_others",
		label: "Compact other plans",
		description:
			"When showing all plans, combine non-active plans into one summary line.",
		read: (c) => (c.display.compact_others ? "On" : "Off"),
		write: (c, v) => {
			c.display.compact_others = v === "On";
		},
		values: ["On", "Off"],
	},
	{
		id: "show_reset_countdown",
		label: "Reset countdown",
		description: "Show the time remaining until each quota window resets.",
		read: (c) => (c.show_reset_countdown ? "On" : "Off"),
		write: (c, v) => {
			c.show_reset_countdown = v === "On";
		},
		values: ["On", "Off"],
	},
	{
		id: "show_resets",
		label: "Codex reset announcements",
		description:
			"Show official Codex reset announcements from codex-resets.com.",
		read: (c) => (c.show_resets ? "On" : "Off"),
		write: (c, v) => {
			c.show_resets = v === "On";
		},
		values: ["On", "Off"],
	},
	{
		id: "show_balance",
		label: "Relay balance",
		description: "Query and display the remaining balance for relay providers.",
		read: (c) => (c.show_balance ? "On" : "Off"),
		write: (c, v) => {
			c.show_balance = v === "On";
		},
		values: ["On", "Off"],
	},
	{
		id: "currency",
		label: "Currency symbol",
		description:
			"Symbol shown next to relay balances; this does not convert amounts.",
		read: (c) => c.currency,
		write: (c, v) => {
			c.currency = v;
		},
		values: ["$", "¥", "€"],
	},
	{
		id: "refresh_minutes",
		label: "Refresh interval",
		description: "How often provider usage is refreshed.",
		read: (c) => `${c.refresh_minutes} min`,
		write: (c, v) => {
			const n = Number.parseInt(v, 10);
			if (Number.isFinite(n) && n >= 1) c.refresh_minutes = n;
		},
		values: ["1 min", "2 min", "5 min", "10 min"],
	},
];

function styleIndex(cfg: UsageBarConfig): number {
	return Math.max(
		0,
		STYLE_VARIANTS.findIndex(
			(v) =>
				v.style === cfg.style &&
				(v.style !== "aurora" || v.glyph === cfg.bar_glyph),
		),
	);
}

function styleLabel(cfg: UsageBarConfig): string {
	return STYLE_VARIANTS[styleIndex(cfg)]?.label ?? "";
}

interface SettingsSection {
	label: string;
	description: string;
	ids: readonly string[];
	summary(cfg: UsageBarConfig): string;
}

const SECTIONS: readonly SettingsSection[] = [
	{
		label: "Appearance",
		description: "Bar style, color theme, spacing, and width.",
		ids: ["theme", "density", "bar_width"],
		summary: (cfg) =>
			`${styleLabel(cfg)} · ${cfg.theme === "pi" ? "Pi theme" : "Graphite"}`,
	},
	{
		label: "Display",
		description: "Visible plans, reset information, and relay balances.",
		ids: [
			"display.mode",
			"display.compact_others",
			"show_reset_countdown",
			"show_resets",
			"show_balance",
			"currency",
		],
		summary: (cfg) =>
			cfg.display.mode === "active"
				? "Current plan"
				: `All plans · ${cfg.display.compact_others ? "Compact others" : "Full details"}`,
	},
	{
		label: "Advanced",
		description: "Refresh interval and custom provider mapping.",
		ids: ["refresh_minutes"],
		summary: (cfg) => `Refresh every ${cfg.refresh_minutes} min`,
	},
];

class UsageMenu extends SettingsList {
	constructor(
		items: SettingItem[],
		theme: SettingsListTheme,
		onCancel: () => void,
		private preview: (width: number) => string[],
	) {
		super(items, 12, theme, () => {}, onCancel, { enableSearch: true });
	}

	override render(width: number): string[] {
		return [...super.render(width), "", ...this.preview(width)];
	}
}

export async function runUsageCommand(
	ui: CommandUIContext,
	snapshots: UsageSnapshot[],
	onChanged: (cfg: UsageBarConfig) => void,
	active?: ActiveUsage,
): Promise<void> {
	const cfg = loadConfig();
	await ui.custom<null>((tui, theme, keybindings, done) => {
		const th = theme as {
			fg(token: string, text: string): string;
			colors: Record<string, unknown>;
		};
		const listTheme: SettingsListTheme = {
			label: (text, selected) => (selected ? th.fg("accent", text) : text),
			value: (text, selected) => th.fg(selected ? "accent" : "muted", text),
			description: (text) => th.fg("dim", text),
			cursor: th.fg("accent", "→ "),
			hint: (text) => th.fg("dim", text),
		};
		const requestRender = () =>
			(tui as { requestRender(): void }).requestRender();
		const save = () => {
			sparseSave(cfg);
			onChanged(cfg);
		};
		const palette = () =>
			applyColorOverrides(
				cfg.theme === "pi" ? paletteFromPiTheme(th) : GRAPHITE,
				cfg.color_ok,
				cfg.color_warn,
				cfg.color_hot,
			);
		const info = (title: string, lines: string[], back: () => void) => {
			const text = new Text(
				[
					th.fg("accent", title),
					"",
					...lines,
					"",
					th.fg("dim", "Enter or Esc to return"),
				].join("\n"),
				1,
				0,
			);
			return {
				render: (width: number) => text.render(width),
				invalidate: () => text.invalidate(),
				handleInput: (data: string) => {
					if (
						keybindings.matches(data, "tui.select.cancel") ||
						keybindings.matches(data, "tui.select.confirm")
					)
						back();
				},
			};
		};
		const categoryItem = (section: SettingsSection): SettingItem => ({
			id: section.label,
			label: section.label,
			description: section.description,
			currentValue: section.summary(cfg),
			submenu: (_currentValue, submenuDone) => {
				const settings = SETTINGS.filter((setting) =>
					section.ids.includes(setting.id),
				);
				const items: SettingItem[] = settings.map((setting) => ({
					id: setting.id,
					label: setting.label,
					description: setting.description,
					currentValue: setting.read(cfg),
					values: setting.values,
				}));
				if (section.label === "Appearance") {
					items.unshift({
						id: "bar-style",
						label: "Bar style",
						description: "Preview and choose a bar style with your usage data.",
						currentValue: styleLabel(cfg),
						submenu: (_value, styleDone) => {
							return new StylePickerComponent(
								keybindings,
								requestRender,
								buildVariantPreviews(snapshots, cfg, palette(), Date.now()),
								STYLE_VARIANTS.map((v) => v.label),
								styleIndex(cfg),
								() => styleDone(styleLabel(cfg)),
								th,
								new DynamicBorder((text: string) => th.fg("accent", text)),
								(result) => {
									cfg.style = result.style;
									cfg.bar_glyph = result.glyph;
									save();
								},
							);
						},
					});
				}
				if (section.label === "Advanced") {
					const mappingCount = Object.keys(cfg.providerMap).length;
					items.push({
						id: "providerMap",
						label: "Provider mapping",
						description:
							"View instructions for mapping custom providers in the configuration file.",
						currentValue: `${mappingCount} ${mappingCount === 1 ? "mapping" : "mappings"}`,
						submenu: (_value, mappingDone) =>
							info(
								"Provider mapping",
								[
									"Edit providerMap in:",
									configFilePath(),
									"",
									'Example: { "providerMap": { "my-provider": "zai-cn" } }',
									"",
									"Run /reload after saving the file.",
								],
								mappingDone,
							),
					});
				}
				return new SettingsList(
					items,
					12,
					listTheme,
					(id, value) => {
						const setting = settings.find((s) => s.id === id);
						if (setting) {
							setting.write(cfg, value);
							save();
						}
					},
					() => submenuDone(section.summary(cfg)),
					{ enableSearch: true },
				);
			},
		});
		const details: SettingItem = {
			id: "usage-details",
			label: "Usage details",
			description: "Inspect quota windows, balances, and provider status.",
			currentValue:
				snapshots.length === 0
					? "No data yet"
					: `${snapshots.length} providers`,
			submenu: (_value, back) =>
				snapshots.length === 0
					? info(
							"Usage details",
							["No usage data yet — wait for the first refresh."],
							back,
						)
					: new SettingsList(
							snapshots.map((snapshot, index) => ({
								id: String(index),
								label: `${planDisplayLabel(snapshot.plan)} · ${snapshot.provider}`,
								currentValue: snapshot.status,
								submenu: (_status, detailBack) =>
									info("Usage details", describeSnapshot(snapshot), detailBack),
							})),
							12,
							listTheme,
							() => {},
							back,
						),
		};
		return new UsageMenu(
			[details, ...SECTIONS.map(categoryItem)],
			listTheme,
			() => done(null),
			(width) => {
				const preview = buildUsagePreview(
					snapshots,
					cfg,
					width,
					palette(),
					Date.now(),
					active,
				);
				return [
					th.fg(
						"dim",
						truncateToWidth(
							`── Preview · ${preview.source === "live" ? "live data" : "sample data"} · changes saved immediately ──`,
							width,
						),
					),
					...preview.lines.map((line) => truncateToWidth(line, width)),
					th.fg(
						"dim",
						truncateToWidth(`Refresh every ${cfg.refresh_minutes} min`, width),
					),
				];
			},
		);
	});
}
