/**
 * pi-usage-bar entry point — thin wiring per AGENTS.md (issue 011):
 * lifecycle, timers, and assembly only. All logic lives behind the seams.
 */
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
// Grapheme-aware width: the ⏰ marker renders 2 columns wide, and an ASCII
// count underestimates row width, clipping the right-aligned model label.
import { visibleWidth as tuiVisibleWidth } from "@earendil-works/pi-tui";
import { FileCache } from "./cache.js";
import { loadConfig, resolveEndpointOverrides } from "./config.js";
import { detectRoute, firstPartyExpansion, PLAN_HOSTS } from "./detect.js";
import { runUsageCommand } from "./pi/commands.js";
import {
	type RegistryLike,
	resolveCredential,
	resolveCredentialAny,
} from "./pi/credentials.js";
import { installEditorChrome, removeEditorChrome } from "./pi/editor-chip.js";
import {
	clearDisplay,
	type DisplayUIContext,
	publishDisplay,
	STATUS_KEY,
} from "./pi/footer.js";
import { cachedBranch, refreshBranch } from "./pi/git-branch.js";
import { paletteFromPiTheme } from "./pi/theme.js";
import {
	type FetchTarget,
	fetchAllUsages,
	toFetchLike,
} from "./providers/facade.js";
import { appendRight, chipText, layoutChrome } from "./render/chrome.js";
import { renderStatus } from "./render/layout.js";
import {
	applyColorOverrides,
	GRAPHITE as GRAPHITE_FALLBACK,
} from "./render/theme.js";
import { selectSnapshots } from "./select.js";
import type {
	Palette,
	PlanKind,
	UsageBarConfig,
	UsageSnapshot,
} from "./types.js";

const EXTENSION_ID = "@gomeen/pi-usage-bar";

/**
 * Ids on first-party prepaid hosts (issue 019 amendment), discovered from
 * every known model — models.json custom ids live in getAll(), while
 * getRegisteredProviderIds() only covers extension-registered providers.
 * Empty for registries without getAll (older pi).
 */
export function firstPartyCandidateIds(registry: RegistryLike): string[] {
	const getAll = registry.getAll;
	if (typeof getAll !== "function") return [];
	const providerIds = new Set(
		getAll.call(registry).map((model) => model.provider),
	);
	const baseUrlOf = (id: string): string | undefined =>
		(registry.getProvider(id) as { baseUrl?: string } | undefined)?.baseUrl ??
		undefined;
	return firstPartyExpansion([...providerIds], baseUrlOf);
}

const VIRTUAL_GATEWAY_PROVIDERS = new Set(["magpie"]);

interface State {
	ctx: ExtensionContext | undefined;
	config: UsageBarConfig;
	snapshots: UsageSnapshot[];
	cache: FileCache;
	timer: ReturnType<typeof setInterval> | undefined;
	inflight: AbortController | undefined;
	renderQueued: boolean;
	/** Last chrome layout (D3): shared between the footer row and the editor chip. */
	chrome: { width: number; chip: string | null } | undefined;
}

export default function usageBarExtension(pi: ExtensionAPI): void {
	pi.registerFlag("usage", {
		description:
			"Print one JSON line of usage for the active provider and exit",
		type: "boolean",
		default: false,
	});

	const state: State = {
		ctx: undefined,
		config: loadConfig(),
		snapshots: [],
		cache: new FileCache("pi-usage-bar"),
		timer: undefined,
		inflight: undefined,
		renderQueued: false,
		chrome: undefined,
	};

	function registryOf(ctx: ExtensionContext): RegistryLike {
		return ctx.modelRegistry as unknown as RegistryLike;
	}

	function activeTargets(ctx: ExtensionContext): FetchTarget[] {
		const model = ctx.model;
		const provider = model?.provider ?? "";
		if (!provider || VIRTUAL_GATEWAY_PROVIDERS.has(provider)) return [];
		const route = detectRoute(
			provider,
			model?.baseUrl,
			state.config.providerMap,
		);
		if (!route || route.plan === "relay") {
			if (
				route?.plan === "relay" &&
				state.config.show_balance &&
				model?.baseUrl
			) {
				return [
					{
						provider,
						plan: "relay" as PlanKind,
						baseUrl: model.baseUrl,
						credential: null,
					},
				];
			}
			return [];
		}
		return [
			{
				provider,
				plan: route.plan,
				...(model?.baseUrl ? { baseUrl: model.baseUrl } : {}),
				credential: null,
			},
		];
	}

	function allTargets(ctx: ExtensionContext): Promise<FetchTarget[]> {
		const registry = registryOf(ctx);
		const candidates = new Set<string>();
		const active = ctx.model?.provider ?? "";
		if (active && !VIRTUAL_GATEWAY_PROVIDERS.has(active))
			candidates.add(active);
		for (const id of Object.keys(PLAN_HOSTS)) candidates.add(id);
		for (const id of Object.keys(state.config.providerMap)) candidates.add(id);
		// Custom providers on first-party prepaid hosts (issue 019 amendment):
		// their balance is a permanent citizen like the builtin plans, not a
		// candidate only while active. Narrow by design — only exact
		// FIRST_PARTY_HOSTS hosts; relay candidates stay opt-in (providerMap).
		for (const id of firstPartyCandidateIds(registry)) {
			candidates.add(id);
		}

		const filter = state.config.display.providers;
		return Promise.all(
			[...candidates].map(async (id): Promise<FetchTarget | null> => {
				if (VIRTUAL_GATEWAY_PROVIDERS.has(id)) return null;
				const model = ctx.model;
				const baseUrl =
					id === model?.provider
						? model?.baseUrl
						: ((registry.getProvider(id) as { baseUrl?: string } | undefined)
								?.baseUrl ?? undefined);
				const route = detectRoute(id, baseUrl, state.config.providerMap);
				if (!route) return null;
				if (route.plan === "relay") {
					if (!state.config.show_balance || !baseUrl) return null;
					return { provider: id, plan: "relay", baseUrl, credential: null };
				}
				if (filter.length > 0 && !filter.includes(route.plan)) return null;
				return {
					provider: id,
					plan: route.plan,
					...(baseUrl ? { baseUrl } : {}),
					credential: null,
				};
			}),
		).then((list) => list.filter((t): t is FetchTarget => t !== null));
	}

	async function refresh(): Promise<void> {
		const ctx = state.ctx;
		if (!ctx || state.inflight) return;
		if (ctx.mode === "tui") refreshBranch(ctx.cwd); // chip branch refresh piggybacks
		const controller = new AbortController();
		state.inflight = controller;
		try {
			if (ctx.mode === "tui" && state.snapshots.length === 0) {
				// First fetch ever: stay quiet rather than flashing a loading
				// line (issue: keep previous content during refreshes).
			}
			const targets =
				state.config.display.mode === "all"
					? await allTargets(ctx)
					: activeTargets(ctx);
			const resolved = await Promise.all(
				targets.map(async (t) => {
					if (t.credential) return t;
					if (t.plan === "codex") {
						// Codex usage needs the backend-api audience token, which pi
						// stores under the openai-codex provider. The `openai`
						// ChatGPT direct-use token (aud api.openai.com/v1) is
						// rejected by wham/usage — never fall back to it.
						const r = await resolveCredentialAny(registryOf(ctx), [
							"openai-codex",
						]);
						return { ...t, credential: r.credential };
					}
					return {
						...t,
						credential: await resolveCredential(registryOf(ctx), t.provider),
					};
				}),
			);
			const showable = resolved.filter(
				(t) => t.credential !== null || t.plan === "relay",
			);
			const snapshots = showable.length
				? await fetchAllUsages(showable, {
						endpoints: resolveEndpointOverrides(),
						now: Date.now(),
						fetchImpl: toFetchLike(globalThis.fetch),
						signal: controller.signal,
						cache: state.cache,
						showResets: state.config.show_resets,
					})
				: [];
			if (controller.signal.aborted) return;
			// One snapshot per official plan: all-mode candidates can overlap
			// (the `openai` and `openai-codex` providers both map to codex).
			// The active provider's snapshot wins so the full first line always
			// describes the plan the current model actually spends. Relays are
			// one-per-provider: each is its own account with its own balance.
			const activeProviderId = ctx.model?.provider ?? "";
			state.snapshots = selectSnapshots(snapshots, activeProviderId);
			render();
		} finally {
			if (state.inflight === controller) state.inflight = undefined;
		}
	}

	function palette(ctx: ExtensionContext): Palette {
		if (state.config.theme === "pi") {
			const p = paletteFromPiTheme(ctx.ui.theme as never);
			return applyColorOverrides(
				p,
				state.config.color_ok,
				state.config.color_warn,
				state.config.color_hot,
			);
		}
		return applyColorOverrides(
			GRAPHITE_FALLBACK,
			state.config.color_ok,
			state.config.color_warn,
			state.config.color_hot,
		);
	}

	function render(): void {
		const ctx = state.ctx;
		if (ctx?.mode !== "tui" || state.renderQueued) return;
		state.renderQueued = true;
		queueMicrotask(() => {
			state.renderQueued = false;
			const current = state.ctx;
			if (current?.mode !== "tui") return;
			const pal = palette(current);
			const build = (width: number): string[] => {
				const virtualGatewayActive = VIRTUAL_GATEWAY_PROVIDERS.has(
					current.model?.provider ?? "",
				);
				const usage =
					state.snapshots.length === 0
						? []
						: renderStatus(
								state.snapshots,
								state.config,
								width,
								pal,
								Date.now(),
								{
									provider: state.ctx?.model?.provider ?? "",
									plan:
										detectRoute(
											state.ctx?.model?.provider ?? "",
											state.ctx?.model?.baseUrl,
											state.config.providerMap,
										)?.plan ?? null,
								},
							);
				// D3 chrome: model right-aligned on row one, legend chip for the
				// editor top border. The chip survives even with no usage data
				// (ctx% comes from the pi session, not from our fetches).
				const layout = layoutChrome({
					line1: virtualGatewayActive ? "" : (usage[0] ?? ""),
					width,
					widthOf: tuiVisibleWidth,
					model: current.model
						? {
								id: current.model.id,
								thinkingLevel: current.thinkingLevel,
								reasoning: current.model.reasoning,
							}
						: null,
					chip: {
						branch: cachedBranch(),
						percent: current.getContextUsage()?.percent ?? null,
					},
					palette: pal,
				});
				state.chrome = { width, chip: layout.chip };
				if (virtualGatewayActive) {
					// A routing gateway has no billable vendor row of its own. Keep
					// its model on row one, then retain every real provider on row two.
					return layout.modelRight === null
						? usage
						: [
								appendRight("", layout.modelRight, width, tuiVisibleWidth),
								...usage,
							];
				}
				const lines = [...usage];
				const first = lines[0];
				if (first !== undefined && layout.modelRight !== null) {
					lines[0] = appendRight(
						first,
						layout.modelRight,
						width,
						tuiVisibleWidth,
					);
				} else if (first === undefined && layout.modelRight !== null) {
					// Keep the first footer row: empty vendor side, selected model on
					// the right.
					lines.push(
						appendRight("", layout.modelRight, width, tuiVisibleWidth),
					);
				}
				return lines;
			};
			publishDisplay(current.ui as DisplayUIContext, build);
		});
	}

	/**
	 * Editor chip source. The model-on-row-1 decision lives in the footer
	 * builder (it owns the real row width); until the footer recomputes at a
	 * new width this falls back to the base chip — a one-frame difference at
	 * ladder boundaries during resizes.
	 */
	function chipProvider(width: number): string | null {
		const ctx = state.ctx;
		if (ctx?.mode !== "tui") return null;
		const memo = state.chrome;
		if (memo !== undefined && memo.width === width) return memo.chip;
		return chipText(
			{
				branch: cachedBranch(),
				percent: ctx.getContextUsage()?.percent ?? null,
			},
			palette(ctx),
		);
	}

	function schedule(intervalMs: number): void {
		if (state.timer) clearInterval(state.timer);
		state.timer = setInterval(
			() => {
				void refresh();
			},
			Math.max(60_000, intervalMs),
		);
	}

	pi.on("session_start", async (_event, ctx) => {
		state.ctx = ctx;

		if (pi.getFlag("usage")) {
			await oneShotUsage(ctx);
			return;
		}
		if (ctx.mode !== "tui") return;

		// D3: chip editor + footer takeover from frame one (before the first
		// fetch lands) so the stock footer never flashes and then vanishes.
		// A failed install silently keeps the built-in editor (usage footer
		// still works standalone); see installEditorChrome.
		installEditorChrome(ctx.ui, chipProvider);
		refreshBranch(ctx.cwd);
		render();
		void refresh();
		schedule(state.config.refresh_minutes * 60_000);
	});

	pi.on("model_select", () => {
		if (state.ctx?.mode !== "tui") return;
		// A poll may be in flight for the previous provider; abort it so the
		// footer reflects the new active plan immediately.
		state.inflight?.abort();
		state.inflight = undefined;
		void refresh();
	});

	pi.on("thinking_level_select", () => {
		// The model label on row one carries the level.
		if (state.ctx?.mode !== "tui") return;
		render();
	});

	pi.on("session_shutdown", () => {
		if (state.timer) {
			clearInterval(state.timer);
			state.timer = undefined;
		}
		state.inflight?.abort();
		state.inflight = undefined;
		if (state.ctx?.mode === "tui") {
			removeEditorChrome(state.ctx.ui);
			clearDisplay(state.ctx.ui as DisplayUIContext);
		}
		state.ctx = undefined;
	});

	pi.registerCommand("usage", {
		description: "Show usage details and settings",
		handler: async (_args, commandCtx) => {
			await runUsageCommand(commandCtx.ui, state.snapshots, (cfg) => {
				state.config = cfg;
				schedule(cfg.refresh_minutes * 60_000);
				render();
			});
		},
	});

	async function oneShotUsage(ctx: ExtensionContext): Promise<void> {
		const targets = activeTargets(ctx);
		if (targets.length === 0) {
			console.log(JSON.stringify({ status: "unsupported" }));
			await ctx.shutdown();
			return;
		}
		const resolved = await Promise.all(
			targets.map(async (t) => {
				if (t.plan === "codex") {
					// Same rule as refresh(): codex credentials come from the
					// openai-codex provider only (backend-api audience).
					const r = await resolveCredentialAny(registryOf(ctx), [
						"openai-codex",
					]);
					return { ...t, credential: r.credential };
				}
				return {
					...t,
					credential: await resolveCredential(registryOf(ctx), t.provider),
				};
			}),
		);
		const ready = resolved.filter((t) => t.credential !== null);
		if (ready.length === 0) {
			const hint =
				targets[0]?.plan === "codex"
					? "run /login and choose OpenAI Codex (ChatGPT Plus/Pro) — the openai ChatGPT token cannot query backend-api usage"
					: undefined;
			console.log(JSON.stringify({ status: "unconfigured", hint }));
			await ctx.shutdown();
			return;
		}
		const snapshots = await fetchAllUsages(ready, {
			endpoints: resolveEndpointOverrides(),
			now: Date.now(),
			fetchImpl: toFetchLike(globalThis.fetch),
			cache: state.cache,
			showResets: state.config.show_resets,
		});
		const snap = snapshots[0];
		if (!snap || snap.status === "error") {
			console.log(
				JSON.stringify({
					status: "error",
					error: snap?.error ?? "unavailable",
				}),
			);
		} else {
			console.log(
				JSON.stringify({
					status: "ok",
					provider: snap.provider,
					plan: snap.plan,
					windows: snap.windows.map((w) => ({
						label: w.label,
						percent: w.percent,
						resetsAt: w.resetsAt,
					})),
					balance: snap.balance ?? undefined,
					fetchedAt: snap.fetchedAt,
				}),
			);
		}
		await ctx.shutdown();
	}
}

export { EXTENSION_ID, STATUS_KEY };
