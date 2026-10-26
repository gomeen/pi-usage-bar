import { expect, test } from "vitest";
import { buildVariantPreviews, STYLE_VARIANTS } from "../src/pi/stylePicker";
import { GRAPHITE } from "../src/render/theme";
import { DEFAULT_CONFIG } from "../src/types";

const NOW = 1_700_000_000_000;
const strip = (s: string) =>
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI in tests.
	s.replace(/\x1b\[[0-9;]*m/g, "");

test("four variants preview non-empty and distinct", () => {
	const previews = buildVariantPreviews([], DEFAULT_CONFIG, GRAPHITE, NOW);
	expect(previews).toHaveLength(4);
	for (const p of previews) {
		expect(strip(p).length).toBeGreaterThan(5);
	}
	const unique = new Set(previews);
	expect(unique.size).toBe(4);
});

test("variant table covers style/glyph pairs", () => {
	expect(STYLE_VARIANTS.map((v) => v.id)).toEqual([
		"aurora-block",
		"aurora-thin",
		"ring",
		"classic",
	]);
});
