import { getKeybindings, SettingsList } from "@earendil-works/pi-tui";
import { beforeEach, expect, test, vi } from "vitest";
import { loadConfig, sparseSave } from "../src/config";
import {
	type CommandUIContext,
	runConfigCommand,
	runUsageCommand,
} from "../src/pi/commands";
import { DEFAULT_CONFIG } from "../src/types";

vi.mock("../src/config.js", () => ({
	configFilePath: () => "/test/usage-bar.json",
	loadConfig: vi.fn(() => structuredClone(DEFAULT_CONFIG)),
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

async function inspectSettings(
	inspect: (component: SettingsList) => void,
	onChanged: Parameters<typeof runConfigCommand>[1] = () => {},
): Promise<void> {
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
				if (!(component instanceof SettingsList))
					throw new Error("Expected a native SettingsList");
				inspect(component);
			}),
	};
	await runConfigCommand(ui, onChanged);
}

test("settings have three readable categories and one bar style entry", async () => {
	const onChanged = vi.fn();
	await inspectSettings((component) => {
		const rendered = () => component.render(100).join("\n");
		expect(rendered()).toContain("Appearance");
		expect(rendered()).toContain("Aurora block · Graphite");
		expect(rendered()).toContain("All plans · Compact others");
		expect(rendered()).toContain("Refresh every 2 min");
		expect(rendered()).not.toContain("providerMap");
		component.handleInput("\r");
		expect(rendered()).toContain("Bar style");
		expect(rendered()).toContain("Color theme");
		expect(rendered()).toContain("Bar width");
		expect(rendered()).toContain("12 cells");
		expect(rendered()).not.toMatch(/bar_glyph|Style picker/);
		component.handleInput("\r");
		component.handleInput("\u001b[B");
		component.handleInput("\r");
		expect(onChanged).toHaveBeenCalledOnce();
		expect(onChanged.mock.calls[0]?.[0].bar_glyph).toBe("thin");
		expect(sparseSave).toHaveBeenCalledOnce();
		expect(rendered()).toContain("Aurora thin");
		component.handleInput("\r");
		expect(rendered()).toContain("❯ Aurora thin");
		component.handleInput("\u001b");
		expect(onChanged).toHaveBeenCalledOnce();
		component.handleInput("\u001b");
		expect(rendered()).toContain("Aurora thin · Graphite");
		component.handleInput("\u001b");
	}, onChanged);
});

test("display choices save domain values and update the category summary", async () => {
	const onChanged = vi.fn();
	await inspectSettings((component) => {
		component.selectItem("Display");
		component.handleInput("\r");
		const rendered = () => component.render(100).join("\n");
		expect(rendered()).toContain("Show plans");
		expect(rendered()).toContain("Compact other plans");
		expect(rendered()).not.toContain("true");
		component.handleInput("\r");
		expect(onChanged.mock.calls[0]?.[0].display.mode).toBe("active");
		component.handleInput("\u001b[B");
		component.handleInput("\r");
		expect(onChanged.mock.calls[1]?.[0].display.compact_others).toBe(false);
		component.handleInput("\u001b");
		expect(rendered()).toContain("Current plan");
		expect(rendered()).not.toContain("Compact others");
		component.handleInput("\u001b");
	}, onChanged);
});

test("advanced settings show units and provider mapping instructions", async () => {
	const config = structuredClone(DEFAULT_CONFIG);
	config.refresh_minutes = 3;
	config.providerMap = { "my-provider": "zai-cn" };
	vi.mocked(loadConfig).mockReturnValueOnce(config);
	const onChanged = vi.fn();
	await inspectSettings((component) => {
		const rendered = () => component.render(100).join("\n");
		expect(rendered()).toContain("Refresh every 3 min");
		component.selectItem("Advanced");
		component.handleInput("\r");
		expect(rendered()).toContain("Refresh interval");
		expect(rendered()).toContain("3 min");
		expect(rendered()).toContain("Provider mapping");
		component.handleInput("\r");
		expect(onChanged.mock.calls[0]?.[0].refresh_minutes).toBe(1);
		component.handleInput("\u001b[B");
		component.handleInput("\r");
		expect(rendered()).toContain("/test/usage-bar.json");
		expect(rendered()).toContain('"my-provider": "zai-cn"');
		component.handleInput("\u001b");
		expect(rendered()).toContain("Refresh interval");
		component.handleInput("\r");
		component.handleInput("\r");
		expect(rendered()).toContain("Refresh interval");
		expect(onChanged).toHaveBeenCalledOnce();
		component.handleInput("\u001b");
		expect(rendered()).toContain("Refresh every 1 min");
		component.handleInput("\u001b");
	}, onChanged);
});
