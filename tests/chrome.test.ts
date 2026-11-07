/**
 * Golden ANSI tests for the editor chrome layout (prototype D3). Palette is
 * the built-in graphite; expected strings hardcode the wire format the same
 * way tests/render.test.ts does.
 */
import { describe, expect, it } from "vitest";
import {
	appendRight,
	chipText,
	layoutChrome,
	type ModelInfo,
	modelLabel,
	visibleWidth,
} from "../src/render/chrome";
import { fg, GRAPHITE, RESET } from "../src/render/theme";

const MUTE = fg(GRAPHITE.mute);
const EDGE = fg(GRAPHITE.edge);
const WT = fg(GRAPHITE.wt);
const WARN = fg(GRAPHITE.warn);
const HOT = fg(GRAPHITE.hot);

const CHIP_SRC = { branch: "main", percent: 60.8 };

describe("modelLabel", () => {
	it("bare id without reasoning", () => {
		expect(modelLabel({ id: "gpt-6.1-sol" })).toBe("gpt-6.1-sol");
		expect(
			modelLabel({
				id: "gpt-6.1-sol",
				reasoning: false,
				thinkingLevel: "high",
			}),
		).toBe("gpt-6.1-sol");
	});
	it("appends the thinking level (pi footer parity)", () => {
		const m: ModelInfo = {
			id: "gpt-6.1-sol",
			reasoning: true,
			thinkingLevel: "high",
		};
		expect(modelLabel(m)).toBe("gpt-6.1-sol • high");
	});
	it("thinking off is spelled out (pi footer parity)", () => {
		expect(modelLabel({ id: "m", reasoning: true })).toBe("m • thinking off");
		expect(modelLabel({ id: "m", reasoning: true, thinkingLevel: "off" })).toBe(
			"m • thinking off",
		);
	});
});

describe("chipText", () => {
	it("branch · percent with mute/edge colors (golden)", () => {
		expect(chipText(CHIP_SRC, GRAPHITE)).toBe(
			`${MUTE}main${RESET}${EDGE} · ${RESET}${MUTE}60.8%${RESET}`,
		);
	});
	it("percent severity follows pi footer thresholds", () => {
		expect(chipText({ branch: null, percent: 60.8 }, GRAPHITE)).toContain(MUTE);
		expect(chipText({ branch: null, percent: 75 }, GRAPHITE)).toContain(WARN);
		expect(chipText({ branch: null, percent: 95 }, GRAPHITE)).toContain(HOT);
	});
	it("percent always shows one decimal", () => {
		const chip = chipText({ branch: null, percent: 60 }, GRAPHITE);
		expect(chip).toContain("60.0%");
	});
	it("null source → null chip", () => {
		expect(chipText({ branch: null, percent: null }, GRAPHITE)).toBeNull();
	});
});

describe("layoutChrome", () => {
	const model = {
		id: "gpt-6.1-sol",
		reasoning: true,
		thinkingLevel: "high",
	};

	it("full label rides row one when it fits", () => {
		const r = layoutChrome({
			line1: "ab",
			width: 80,
			model,
			chip: CHIP_SRC,
			palette: GRAPHITE,
		});
		expect(r.modelRight).toBe("gpt-6.1-sol • high");
		expect(r.chip).toBe(chipText(CHIP_SRC, GRAPHITE));
		expect(r.dropped).toEqual([]);
	});

	it("falls back to the bare id when only that fits", () => {
		const r = layoutChrome({
			line1: "a".repeat(61),
			width: 80,
			model,
			chip: CHIP_SRC,
			palette: GRAPHITE,
		});
		expect(r.modelRight).toBe("gpt-6.1-sol");
		expect(r.dropped).toEqual(["thinking level"]);
	});

	it("merges the model into the chip when row one cannot take it", () => {
		const r = layoutChrome({
			line1: "a".repeat(70),
			width: 80,
			model,
			chip: CHIP_SRC,
			palette: GRAPHITE,
		});
		expect(r.modelRight).toBeNull();
		expect(r.chip).toBe(
			`${MUTE}main${RESET}${EDGE} · ${RESET}${MUTE}60.8%${RESET}${EDGE} · ${RESET}${WT}gpt-6.1-sol${RESET}`,
		);
		expect(r.dropped).toContain("model row 1 → merged into chip");
	});

	it("chip sheds the merged model, then branch, then percent", () => {
		const merged = layoutChrome({
			line1: "a".repeat(70),
			width: 80,
			model,
			chip: CHIP_SRC,
			palette: GRAPHITE,
		});
		// 26 + 8 > 30 → shed model → base chip (12 + 8 ≤ 30)
		const at30 = layoutChrome({
			line1: "a".repeat(70),
			width: 30,
			model,
			chip: CHIP_SRC,
			palette: GRAPHITE,
		});
		expect(at30.chip).toBe(chipText(CHIP_SRC, GRAPHITE));
		expect(at30.dropped).toContain("model (chip)");
		expect(at30.chip).not.toBe(merged.chip);

		// 20 > 19 → shed branch → percent only
		const at19 = layoutChrome({
			line1: "",
			width: 19,
			model: null,
			chip: CHIP_SRC,
			palette: GRAPHITE,
		});
		expect(at19.chip).toBe(`${MUTE}60.8%${RESET}`);
		expect(at19.dropped).toContain("branch");

		// 13 > 12 → shed percent → plain border
		const at12 = layoutChrome({
			line1: "",
			width: 12,
			model: null,
			chip: CHIP_SRC,
			palette: GRAPHITE,
		});
		expect(at12.chip).toBeNull();
		expect(at12.dropped).toContain("context percent");
	});

	it("no model → chip only", () => {
		const r = layoutChrome({
			line1: "ab",
			width: 80,
			model: null,
			chip: CHIP_SRC,
			palette: GRAPHITE,
		});
		expect(r.modelRight).toBeNull();
		expect(r.chip).toBe(chipText(CHIP_SRC, GRAPHITE));
	});
});

describe("appendRight", () => {
	it("pads flush to the edge with a 2-column minimum gap", () => {
		expect(appendRight("ab", "cd", 10)).toBe("ab      cd");
	});
	it("keeps ANSI styling on the right part", () => {
		const styled = `${fg(GRAPHITE.ok)}ok${RESET}`;
		const out = appendRight("ab", styled, 10);
		expect(out).toBe(`ab      ${styled}`);
		expect(visibleWidth(out)).toBe(10);
	});
	it("returns the line unchanged when there is no room", () => {
		expect(appendRight("abcdef", "xy", 8)).toBe("abcdef");
	});
	it("truncates the right side bare when tight", () => {
		expect(appendRight("abc", "wxyz", 7)).toBe("abc  w…");
	});
});

describe("visibleWidth", () => {
	it("strips SGR sequences", () => {
		expect(visibleWidth(`${MUTE}main${RESET}`)).toBe(4);
	});
});
