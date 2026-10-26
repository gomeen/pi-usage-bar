/**
 * Slash commands: /usage (detail view) and /usage-bar (dialog-based config
 * editor). Interaction decisions: issue 009 (dialog-driven, no subcommand
 * syntax), v1 scopes providerMap editing to the config file.
 */

import { configFilePath, loadConfig, sparseSave } from "../config.js";
import { planDisplayLabel } from "../detect.js";
import type { UsageBarConfig, UsageSnapshot } from "../types.js";

export interface CommandUIContext {
	select(
		title: string,
		options: string[],
		opts?: unknown,
	): Promise<string | undefined>;
	notify(message: string, type?: "info" | "warning" | "error"): void;
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
export async function runConfigCommand(
	ui: CommandUIContext,
	onChanged: (cfg: UsageBarConfig) => void,
): Promise<void> {
	const cfg = loadConfig();
	const catLabels = [
		...CATEGORIES.map((c) => `${c.label} = ${c.read(cfg)}`),
		"Open config file location",
	];
	const choice = await ui.select("usage-bar settings", catLabels);
	if (choice === undefined) return;
	if (choice === "Open config file location") {
		ui.notify(
			`Config file: ${configFilePath()} (edit providerMap and fine-tuning there)`,
			"info",
		);
		return;
	}
	const cat = CATEGORIES.find((c) => choice.startsWith(`${c.label} =`));
	if (!cat) return;
	const value = await ui.select(`Set ${cat.label}`, cat.values());
	if (value === undefined) return;
	cat.write(cfg, value);
	sparseSave(cfg);
	onChanged(cfg);
	ui.notify(`${cat.label} → ${value} (saved)`, "info");
}
