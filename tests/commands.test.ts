import { getKeybindings, SettingsList } from "@earendil-works/pi-tui";
import { beforeEach, expect, test, vi } from "vitest";
import {
	type CommandUIContext,
	runConfigCommand,
	runUsageCommand,
} from "../src/pi/commands";
import { DEFAULT_CONFIG } from "../src/types";

vi.mock("../src/config.js", () => ({
	configFilePath: () => "/test/usage-bar.json",
	loadConfig: () => structuredClone(DEFAULT_CONFIG),
	sparseSave: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

function menuUI(choices: (string | undefined)[]): CommandUIContext {
	return {
		select: vi.fn(async () => choices.shift()),
		notify: vi.fn(),
		async custom() {
			throw new Error("Unexpected custom screen");
		},
	};
}

test("settings is reachable without any usage data and returns to the main menu", async () => {
	const ui = menuUI(["Settings", undefined]);
	const openSettings = vi.fn(async () => {});
	await runUsageCommand(ui, [], openSettings);
	expect(openSettings).toHaveBeenCalledOnce();
	expect(ui.notify).not.toHaveBeenCalled();
	expect(ui.select).toHaveBeenCalledTimes(2);
	expect(ui.select).toHaveBeenLastCalledWith("Usage bar", [
		"Usage details",
		"Settings",
	]);
});

test("an empty detail view returns to the menu so settings stays reachable", async () => {
	const ui = menuUI(["Usage details", "Settings", undefined]);
	const openSettings = vi.fn(async () => {});
	await runUsageCommand(ui, [], openSettings);
	expect(ui.notify).toHaveBeenCalledOnce();
	expect(openSettings).toHaveBeenCalledOnce();
});

test("cancelling the main menu does not open settings", async () => {
	const ui = menuUI([undefined]);
	const openSettings = vi.fn(async () => {});
	await runUsageCommand(ui, [], openSettings);
	expect(openSettings).not.toHaveBeenCalled();
});

test("provider details return to the provider list before the main menu", async () => {
	const ui = menuUI([
		"Usage details",
		"Codex · openai-codex",
		"Back",
		undefined,
		undefined,
	]);
	await runUsageCommand(
		ui,
		[
			{
				provider: "openai-codex",
				plan: "codex",
				status: "ok",
				windows: [
					{ label: "5h", percent: 42, resetsAt: null, durationSeconds: 18000 },
				],
				fetchedAt: 1_700_000_000_000,
			},
		],
		async () => {},
	);
	expect(ui.select).toHaveBeenNthCalledWith(
		3,
		"Codex · openai-codex",
		expect.arrayContaining(["5h: 42%   resets unknown", "Back"]),
	);
	expect(ui.select).toHaveBeenNthCalledWith(4, "Usage details", [
		"Codex · openai-codex",
	]);
	expect(ui.select).toHaveBeenNthCalledWith(5, "Usage bar", [
		"Usage details",
		"Settings",
	]);
});

test("native settings lists nest Look and style preview and return one level at a time", async () => {
	const onChanged = vi.fn();
	const ui: CommandUIContext = {
		...menuUI([]),
		custom: (factory) =>
			new Promise((resolve) => {
				const component = factory(
					{ requestRender: vi.fn() },
					{ fg: (_token: string, text: string) => text },
					getKeybindings(),
					resolve,
				);
				if (!(component instanceof SettingsList)) {
					throw new Error("Expected a native SettingsList");
				}
				const rendered = () => component.render(100).join("\n");
				expect(rendered()).toContain("Look");
				expect(rendered()).not.toContain("Style picker");
				component.handleInput("\r");
				expect(rendered()).toContain("Style picker");
				component.handleInput("\r");
				expect(rendered()).toContain("usage-bar style");
				component.handleInput("\u001b[B");
				component.handleInput("\r");
				expect(onChanged).toHaveBeenCalledOnce();
				expect(onChanged.mock.calls[0]?.[0].bar_glyph).toBe("thin");
				expect(rendered()).toContain("Style picker");
				component.handleInput("\u001b");
				expect(rendered()).toContain("Look");
				expect(rendered()).not.toContain("Style picker");
				component.handleInput("\u001b");
			}),
	};
	await runConfigCommand(ui, onChanged);
});
