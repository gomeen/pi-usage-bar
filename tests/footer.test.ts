import type {
	ReadonlyFooterDataProvider,
	Theme,
} from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	clearDisplay,
	type DisplayUIContext,
	publishDisplay,
	STATUS_KEY,
} from "../src/pi/footer";

const tui = {} as TUI;
const theme = {} as Theme;
const wideRow = `\x1b[38;2;120;125;132m${"⏰中e\u0301".repeat(40)}\x1b[0m`;
const data: ReadonlyFooterDataProvider = {
	getGitBranch: () => null,
	getExtensionStatuses: () => new Map(),
	getAvailableProviderCount: () => 1,
	onBranchChange: () => () => {},
};

function makeUI() {
	return {
		setStatus: vi.fn<DisplayUIContext["setStatus"]>(),
		setWidget: vi.fn<DisplayUIContext["setWidget"]>(),
		setFooter: vi.fn<NonNullable<DisplayUIContext["setFooter"]>>(),
	};
}

afterEach(() => clearDisplay(makeUI()));

describe("footer width contract through publishDisplay", () => {
	it("clips colored wide-character rows at 129 columns and after resizing", () => {
		const ui = makeUI();
		publishDisplay(ui, () => ["", wideRow, "short"]);
		const factory = ui.setFooter.mock.calls.at(-1)?.[0];
		if (!factory) throw new Error("footer factory was not installed");
		const footer = factory(tui, theme, data);

		for (const width of [129, 40, 1, 2, 240]) {
			const rows = footer.render(width);
			expect(rows).toHaveLength(2);
			for (const row of rows) {
				expect(visibleWidth(row)).toBeLessThanOrEqual(width);
			}
			expect(rows[0]).toBe(truncateToWidth(wideRow, width));
			expect(rows[1]).toBe(truncateToWidth("short", width));
		}
	});

	it("keeps footer content live and clips other extensions' statuses", () => {
		const ui = makeUI();
		let row = "short";
		publishDisplay(ui, () => [row]);
		const factory = ui.setFooter.mock.calls.at(-1)?.[0];
		if (!factory) throw new Error("footer factory was not installed");
		const footer = factory(tui, theme, {
			...data,
			getExtensionStatuses: () => new Map([["other", wideRow]]),
		});

		expect(footer.render(129)[0]).toBe("short");
		row = wideRow;
		const rows = footer.render(129);
		expect(rows).toHaveLength(2);
		for (const line of rows) {
			expect(visibleWidth(line)).toBeLessThanOrEqual(129);
		}
		expect(rows[0]).toBe(truncateToWidth(wideRow, 129));
	});

	it("clips legacy single-line status output to the current terminal width", () => {
		const { setFooter: _setFooter, ...ui } = makeUI();
		const build = vi.fn((_width: number) => [wideRow]);
		publishDisplay(ui, build);

		const width = build.mock.calls[0]?.[0];
		if (width === undefined) throw new Error("builder was not called");
		expect(ui.setStatus).toHaveBeenLastCalledWith(
			STATUS_KEY,
			truncateToWidth(wideRow, width),
		);
	});

	it("clips legacy widget rows and rebuilds after a width change", () => {
		const { setFooter: _setFooter, ...ui } = makeUI();
		publishDisplay(ui, () => [wideRow, "short"]);
		const factory = ui.setWidget.mock.calls.at(-1)?.[1];
		if (typeof factory !== "function") {
			throw new Error("widget factory was not installed");
		}
		const widget = factory(tui, theme);

		for (const width of [129, 40, 240]) {
			const rows = widget.render(width);
			expect(rows).toHaveLength(2);
			for (const row of rows) {
				expect(visibleWidth(row)).toBeLessThanOrEqual(width);
			}
			expect(rows[0]).toBe(truncateToWidth(wideRow, width));
		}
	});
});
