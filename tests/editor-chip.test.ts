/**
 * ChipEditor tests against the REAL pi CustomEditor class: virtual dispatch
 * through renderTopBorder, the working-status composition, and the fallback
 * to pi's own border. Stub TUI/theme/keybindings — renderTopBorder only
 * touches theme.borderColor.
 */

import type { KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import type { EditorTheme, TUI } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { ChipEditor } from "../src/pi/editor-chip";
import { chipText } from "../src/render/chrome";
import { GRAPHITE } from "../src/render/theme";

const PAINT = (s: string) => `«${s}»`;
const theme = { borderColor: PAINT } as unknown as EditorTheme;
const tui = {} as TUI;
const keybindings = {} as KeybindingsManager;

const CHIP = chipText({ branch: "main", percent: 60.8 }, GRAPHITE);

/** renderTopBorder is protected; expose it for golden assertions. */
class TestChipEditor extends ChipEditor {
	border(width: number, hidden = 0): string {
		return this.renderTopBorder(width, hidden);
	}
	setIndicator(indicator: unknown): void {
		this.setWorkingStatusIndicator(
			indicator as Parameters<CustomEditor["setWorkingStatusIndicator"]>[0],
		);
	}
}

function makeEditor(
	provider: (width: number) => string | null,
): TestChipEditor {
	return new TestChipEditor(
		tui,
		theme,
		keybindings,
		{ embedWorkingStatus: true },
		provider,
	);
}

describe("ChipEditor.renderTopBorder", () => {
	it("draws dashes + chip + right run when the chip fits (golden)", () => {
		const editor = makeEditor(() => CHIP);
		expect(editor.border(30)).toBe(
			`${PAINT("─".repeat(10))}  ${CHIP}  ${PAINT("────")}`,
		);
	});

	it("falls back to pi's plain border when the provider returns null", () => {
		const editor = makeEditor(() => null);
		expect(editor.border(30)).toBe(PAINT("─".repeat(30)));
	});

	it("delegates to pi when lines are hidden (scroll marker owns the border)", () => {
		const editor = makeEditor(() => {
			throw new Error("provider must not be called");
		});
		// super renders a scroll indicator; the point is: no throw, no chip.
		const out = editor.border(30, 2);
		expect(out).not.toContain("main");
	});

	it("composes pi's working status on the left of the chip", () => {
		const editor = makeEditor(() => CHIP);
		editor.setIndicator({ renderInBorder: (w: number) => `S(${w})` });
		// avail = 40 - 12 - 8 - 5 = 15 → status S(15); leftW = 3 + 5 + 1
		// fill = 40 - 9 - 12 - 8 = 11
		expect(editor.border(40)).toBe(
			`${PAINT("── ")}S(15)${PAINT(" ")}${PAINT("─".repeat(11))}  ${CHIP}  ${PAINT("────")}`,
		);
	});

	it("returns pi's border when the provider throws", () => {
		const editor = makeEditor(() => {
			throw new Error("boom");
		});
		expect(editor.border(30)).toBe(PAINT("─".repeat(30)));
	});

	it("is a CustomEditor: pi's duck-typed wiring keeps working", () => {
		const editor = makeEditor(() => CHIP);
		expect(editor).toBeInstanceOf(CustomEditor);
		expect(editor.embedWorkingStatus).toBe(true);
		expect(editor.actionHandlers).toBeInstanceOf(Map);
		expect(typeof editor.setWorkingStatusIndicator).toBe("function");
	});
});

describe("installEditorChrome", () => {
	it("installs a factory that produces ChipEditor instances", async () => {
		const { installEditorChrome } = await import("../src/pi/editor-chip");
		let captured: unknown;
		const ui = {
			setEditorComponent(factory: unknown) {
				captured = factory;
			},
		};
		expect(installEditorChrome(ui as never, () => CHIP)).toBe(true);
		expect(typeof captured).toBe("function");
		const editor = (
			captured as (
				tui: TUI,
				theme: EditorTheme,
				kb: KeybindingsManager,
			) => CustomEditor
		)(tui, theme, keybindings);
		expect(editor).toBeInstanceOf(ChipEditor);
	});

	it("returns false when pi rejects the component", async () => {
		const { installEditorChrome } = await import("../src/pi/editor-chip");
		const ui = {
			setEditorComponent() {
				throw new Error("not supported");
			},
		};
		expect(installEditorChrome(ui as never, () => CHIP)).toBe(false);
	});
});
