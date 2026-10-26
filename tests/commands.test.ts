import {
	getKeybindings,
	SettingsList,
	visibleWidth,
} from "@earendil-works/pi-tui";
import { beforeEach, expect, test, vi } from "vitest";
import { loadConfig, sparseSave } from "../src/config";
import { type CommandUIContext, runUsageCommand } from "../src/pi/commands";
import { DEFAULT_CONFIG, type UsageSnapshot } from "../src/types";

vi.mock("../src/config.js", () => ({
	configFilePath: () => "/test/usage-bar.json",
	loadConfig: vi.fn(() => structuredClone(DEFAULT_CONFIG)),
	sparseSave: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());

async function inspectMenu(
	inspect: (component: SettingsList) => void,
	onChanged: Parameters<typeof runUsageCommand>[2] = () => {},
	snapshots: UsageSnapshot[] = [],
): Promise<void> {
	const ui: CommandUIContext = {
		select: vi.fn(),
		notify: vi.fn(),
		custom: (factory) =>
			new Promise((resolve) => {
				const component = factory(
					{ requestRender: vi.fn() },
					{ fg: (_token: string, text: string) => text, colors: {} },
					getKeybindings(),
					resolve,
				);
				if (!(component instanceof SettingsList))
					throw new Error("Expected native SettingsList");
				inspect(component);
			}),
	};
	await runUsageCommand(ui, snapshots, onChanged);
}

const screen = (component: SettingsList) => component.render(160).join("\n");

test("details and three categories are at the root with a labeled sample preview", async () => {
	await inspectMenu((c) => {
		expect(screen(c)).toContain("Usage details");
		for (const name of ["Appearance", "Display", "Advanced"])
			expect(screen(c)).toContain(name);
		expect(screen(c)).not.toContain("Settings");
		expect(screen(c)).toContain("sample data");
		expect(screen(c)).toContain("4sapi");
		expect(screen(c)).not.toContain("4sapi.com");
		c.handleInput("\r");
		expect(screen(c)).toContain("No usage data yet");
		c.handleInput("\u001b");
		expect(screen(c)).toContain("Appearance");
		c.handleInput("\u001b");
	});
});

test("style arrows immediately save and update the full preview; Esc keeps changes", async () => {
	const changed = vi.fn();
	await inspectMenu((c) => {
		c.selectItem("Appearance");
		c.handleInput("\r");
		expect(screen(c)).toContain("Bar width");
		expect(screen(c)).not.toMatch(/bar_glyph|Style picker/);
		c.handleInput("\r");
		c.handleInput("\u001b[B");
		expect(changed).toHaveBeenCalledOnce();
		expect(changed.mock.calls[0]?.[0].bar_glyph).toBe("thin");
		expect(sparseSave).toHaveBeenCalledOnce();
		expect(screen(c)).toContain("already saved");
		const preview = screen(c).split("── Preview")[1];
		expect(preview).toContain("━");
		c.handleInput("\u001b");
		expect(screen(c)).toContain("Aurora thin");
		expect(changed).toHaveBeenCalledOnce();
		c.handleInput("\r");
		expect(screen(c)).toContain("❯ Aurora thin");
		c.handleInput("\r");
		c.handleInput("\u001b");
		expect(screen(c)).toContain("Aurora thin · Graphite");
		c.handleInput("\u001b");
	}, changed);
});

test("display toggles affect preview immediately and save domain values", async () => {
	const changed = vi.fn();
	await inspectMenu((c) => {
		c.selectItem("Display");
		c.handleInput("\r");
		c.handleInput("\r");
		expect(changed.mock.calls[0]?.[0].display.mode).toBe("active");
		expect(screen(c).split("── Preview")[1]).not.toContain("ZAI");
		c.handleInput("\r");
		c.handleInput("\u001b[B");
		c.handleInput("\r");
		expect(changed.mock.calls.at(-1)?.[0].display.compact_others).toBe(false);
		c.handleInput("\u001b");
		expect(screen(c)).toContain("All plans · Full details");
		c.handleInput("\u001b");
	}, changed);
});

test("advanced shows units, saves refresh interval and opens mapping instructions", async () => {
	const cfg = structuredClone(DEFAULT_CONFIG);
	cfg.refresh_minutes = 3;
	cfg.providerMap = { "my-provider": "zai-cn" };
	vi.mocked(loadConfig).mockReturnValueOnce(cfg);
	const changed = vi.fn();
	await inspectMenu((c) => {
		c.selectItem("Advanced");
		c.handleInput("\r");
		c.handleInput("\r");
		expect(changed.mock.calls[0]?.[0].refresh_minutes).toBe(1);
		expect(screen(c)).toContain("Refresh every 1 min");
		c.handleInput("\u001b[B");
		c.handleInput("\r");
		expect(screen(c)).toContain("/test/usage-bar.json");
		c.handleInput("\u001b");
		c.handleInput("\u001b");
		c.handleInput("\u001b");
	}, changed);
});

test("live provider detail navigation returns one level at a time", async () => {
	await inspectMenu((c) => {
		expect(screen(c)).toContain("live data");
		c.handleInput("\r");
		c.handleInput("\r");
		expect(screen(c)).toContain("5h: 42%   resets unknown");
		c.handleInput("\u001b");
		expect(screen(c)).toContain("Codex · openai-codex");
		c.handleInput("\u001b");
		c.handleInput("\u001b");
	}, () => {}, [
		{
			provider: "openai-codex",
			plan: "codex",
			status: "ok",
			fetchedAt: Date.now(),
			windows: [
				{ label: "5h", percent: 42, durationSeconds: 18000, resetsAt: null },
			],
		},
	]);
});

test("preview screens respect narrow terminal widths", async () => {
	await inspectMenu((c) => {
		c.selectItem("Appearance");
		c.handleInput("\r");
		c.handleInput("\r");
		for (const width of [24, 60, 110])
			for (const line of c.render(width))
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
		c.handleInput("\u001b");
		c.handleInput("\u001b");
		c.handleInput("\u001b");
	});
});
