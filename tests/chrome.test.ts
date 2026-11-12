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

	it("omits the model when row one cannot take it", () => {
		const r = layoutChrome({
			line1: "a".repeat(70),
			width: 80,
			model,
			chip: CHIP_SRC,
			palette: GRAPHITE,
		});
		expect(r.modelRight).toBeNull();
		expect(r.chip).toBe(chipText(CHIP_SRC, GRAPHITE));
		expect(r.dropped).toContain("model row 1 → omitted");
	});

	it("keeps the model on the right when the vendor side is empty", () => {
		const r = layoutChrome({
			line1: "",
			width: 80,
			model,
			chip: CHIP_SRC,
			palette: GRAPHITE,
		});
		expect(r.modelRight).toBe("gpt-6.1-sol • high");
		expect(r.chip).toBe(chipText(CHIP_SRC, GRAPHITE));
	});

	it("keeps the chip separate when the model does not fit row one", () => {
		// 26 + 8 > 30 → leave the model area empty; the chip stays intact.
		const at30 = layoutChrome({
			line1: "a".repeat(70),
			width: 30,
			model,
			chip: CHIP_SRC,
			palette: GRAPHITE,
		});
		expect(at30.chip).toBe(chipText(CHIP_SRC, GRAPHITE));
		expect(at30.modelRight).toBeNull();
		expect(at30.dropped).toContain("model row 1 → omitted");

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
	it("regression: injected widthOf counts emoji (⏰) as 2 columns", () => {
		// The usage row carries two ⏰ countdown markers; an ASCII count
		// underestimates the row by 2 columns and clipped the model label to
		// "hi". With a grapheme-aware widthOf the full label must survive.
		const widthOf = (s: string): number =>
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI in tests.
			[...s.replace(/\x1b\[[0-9;]*m/g, "")].reduce(
				(n, ch) => n + (ch === "⏰" ? 2 : 1),
				0,
			);
		const line1 = `ZAI 5h ━━ 10% ⏰1h04m │ 7d ━━ 84% ⏰3d02h`; // ASCII count 39, true 41
		const r = layoutChrome({
			line1,
			width: 73,
			model: { id: "glm-5.3-flash", reasoning: true, thinkingLevel: "high" },
			chip: { branch: "main", percent: 10 },
			palette: GRAPHITE,
			widthOf,
		});
		// At the boundary the two counts disagree: width 62 — the ASCII count
		// (39+2+20=61 ≤ 62) would keep the full label, the true count
		// (41+2+20=63 > 62) must shed the thinking level instead.
		const tight = layoutChrome({
			line1,
			width: 62,
			model: { id: "glm-5.3-flash", reasoning: true, thinkingLevel: "high" },
			chip: { branch: "main", percent: 10 },
			palette: GRAPHITE,
			widthOf,
		});
		expect(tight.modelRight).toBe("glm-5.3-flash");
		expect(tight.dropped).toContain("thinking level");
		expect(r.modelRight).toBe("glm-5.3-flash • high");
	});
	it("appendRight with injected widthOf keeps the label inside the row", () => {
		const widthOf = (s: string): number =>
			// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI in tests.
			[...s.replace(/\x1b\[[0-9;]*m/g, "")].reduce(
				(n, ch) => n + (ch === "⏰" ? 2 : 1),
				0,
			);
		const line1 = `ZAI 5h ━━ 10% ⏰1h04m │ 7d ━━ 84% ⏰3d02h`; // true width 46
		const out = appendRight(line1, "glm-5.3-flash • high", 73, widthOf);
		// line 46 + pad + label 20 = 73, right-aligned flush
		expect(widthOf(out)).toBe(73);
		expect(out.endsWith("glm-5.3-flash • high")).toBe(true);
	});
});
