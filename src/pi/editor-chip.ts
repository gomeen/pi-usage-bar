/**
 * Editor chrome takeover (prototype D3): a CustomEditor subclass that draws
 * the legend chip (`branch · ctx%`) into the top border's right side — the
 * same border row pi itself embeds its working-status indicator in, so both
 * compose (status left, chip right).
 *
 * CustomEditor is a public export of the pi package, and interactive-mode's
 * setCustomEditorComponent explicitly supports extension editors that extend
 * it: after the swap pi re-wires onSubmit/onChange, copies the text, border
 * color, padding, autocomplete provider and (duck-typed via `actionHandlers`)
 * the app-level handlers. The working-status embedding is duck-typed too
 * (`embedWorkingStatus === true` + `setWorkingStatusIndicator`), which our
 * subclass satisfies — pi keeps embedding the indicator and we render it on
 * the left half of the border.
 *
 * Everything this module adds is best-effort: any failure in chip rendering
 * falls back to CustomEditor's own border, and an install failure leaves the
 * built-in editor completely untouched.
 */
import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "../render/chrome.js";

/** Space around the chip (2+2 gaps) plus the right dash run (4) — keep in sync with render/chrome.ts. */
const CHIP_OVERHEAD = 8;

/** Structural type for the working-status indicator (not exported by pi). */
interface StatusIndicatorLike {
	renderInBorder(width: number): string;
}

type CustomEditorArgs = ConstructorParameters<typeof CustomEditor>;

export class ChipEditor extends CustomEditor {
	private provider: (width: number) => string | null;

	constructor(
		...args: [...CustomEditorArgs, (width: number) => string | null]
	) {
		const [tui, theme, keybindings, options, provider] = args;
		super(tui, theme, keybindings, options);
		this.provider = provider;
	}

	protected renderTopBorder(width: number, hiddenLineCount: number): string {
		// A scroll marker (hidden lines) owns the border; the chip yields.
		if (width > 0 && hiddenLineCount <= 0) {
			const composed = this.chipBorder(width);
			if (composed !== null) return composed;
		}
		return super.renderTopBorder(width, hiddenLineCount);
	}

	/**
	 * `── [working status] ──────  chip  ────` — the left half mirrors
	 * CustomEditor's working-status embedding, squeezed to leave the chip its
	 * right side. `workingStatusIndicator` is private in pi's typings; the
	 * cast keeps the compat isolation honest about that.
	 */
	private chipBorder(width: number): string | null {
		try {
			const chip = this.provider(width);
			if (chip === null) return null;
			const chipW = visibleWidth(chip);
			const indicator = (
				this as unknown as {
					embedWorkingStatus?: boolean;
					workingStatusIndicator?: StatusIndicatorLike | undefined;
				}
			).workingStatusIndicator;
			let left = "";
			let leftW = 0;
			if (this.embedWorkingStatus === true && indicator !== undefined) {
				const avail = width - chipW - CHIP_OVERHEAD - 5;
				if (avail > 1) {
					const status = indicator.renderInBorder(avail);
					const statusW = visibleWidth(status);
					if (statusW > 0) {
						left = `${this.borderColor("── ")}${status}${this.borderColor(" ")}`;
						leftW = 3 + statusW + 1;
					}
				}
			}
			const fill = width - leftW - chipW - CHIP_OVERHEAD;
			if (fill < 1) return null; // status and chip cannot coexist this frame
			return `${left}${this.borderColor("─".repeat(fill))}  ${chip}  ${this.borderColor("────")}`;
		} catch {
			return null; // any surprise → CustomEditor's own border
		}
	}
}

/**
 * Swap in the chip editor. Returns false when pi rejects the component (the
 * built-in editor stays active; the usage footer still works standalone).
 */
export function installEditorChrome(
	ui: {
		setEditorComponent(
			factory:
				| ((
						tui: CustomEditorArgs[0],
						theme: CustomEditorArgs[1],
						keybindings: CustomEditorArgs[2],
				  ) => CustomEditor)
				| undefined,
		): void;
	},
	provider: (width: number) => string | null,
): boolean {
	try {
		ui.setEditorComponent(
			(tui, theme, keybindings) =>
				// embedWorkingStatus: true keeps pi's working indicator in the
				// border (duck-typed in interactive-mode), composed left of the chip.
				new ChipEditor(
					tui,
					theme,
					keybindings,
					{ embedWorkingStatus: true },
					provider,
				),
		);
		return true;
	} catch {
		return false;
	}
}

/** Restore pi's built-in editor (idempotent). */
export function removeEditorChrome(
	ui: Parameters<typeof installEditorChrome>[0],
): void {
	try {
		ui.setEditorComponent(undefined);
	} catch {
		// already gone or never installed
	}
}
