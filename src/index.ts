/**
 * pi-usage-bar entry point — thin wiring per AGENTS.md (issue 011):
 * lifecycle, timers, and assembly only. All logic lives behind the seams.
 */
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { FileCache } from "./cache.js";
import { loadConfig, resolveEndpointOverrides } from "./config.js";
import { detectRoute, PLAN_HOSTS } from "./detect.js";
import { runConfigCommand, runUsageCommand } from "./pi/commands.js";
import {
	type RegistryLike,
	resolveCredential,
	resolveCredentialAny,
} from "./pi/credentials.js";
import {
	clearDisplay,
	type DisplayUIContext,
	publishDisplay,
	STATUS_KEY,
} from "./pi/footer.js";
import { paletteFromPiTheme } from "./pi/theme.js";
import {
	type FetchTarget,
	fetchAllUsages,
	toFetchLike,
} from "./providers/facade.js";
import { renderStatus } from "./render/layout.js";
import {
	applyColorOverrides,
	GRAPHITE as GRAPHITE_FALLBACK,
} from "./render/theme.js";
import type {
	Palette,
	PlanKind,
	UsageBarConfig,
	UsageSnapshot,
} from "./types.js";

const EXTENSION_ID = "@gomeen/pi-usage-bar";

interface State {
	ctx: ExtensionContext | undefined;
	config: UsageBarConfig;
	snapshots: UsageSnapshot[];
	cache: FileCache;
	timer: ReturnType<typeof setInterval> | undefined;
	inflight: AbortController | undefined;
	renderQueued: boolean;
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
	};

	function registryOf(ctx: ExtensionContext): RegistryLike {
		return ctx.modelRegistry as unknown as RegistryLike;
	}

	function activeTargets(ctx: ExtensionContext): FetchTarget[] {
		const model = ctx.model;
		const provider = model?.provider ?? "";
		if (!provider) return [];
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
		if (active) candidates.add(active);
		for (const id of Object.keys(PLAN_HOSTS)) candidates.add(id);
		for (const id of Object.keys(state.config.providerMap)) candidates.add(id);

		const filter = state.config.display.providers;
		return Promise.all(
			[...candidates].map(async (id): Promise<FetchTarget | null> => {
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
			// One snapshot per plan: all-mode candidates can overlap (the
			// `openai` and `openai-codex` providers both map to codex). The
			// active provider's snapshot wins so the full first line always
			// describes the plan the current model actually spends.
			const activeProviderId = ctx.model?.provider ?? "";
			const byPlan = new Map<PlanKind, UsageSnapshot>();
			for (const snap of snapshots) {
				if (snap.provider === activeProviderId) {
					byPlan.set(snap.plan, snap);
					continue;
				}
				if (!byPlan.has(snap.plan)) byPlan.set(snap.plan, snap);
			}
			state.snapshots = [...byPlan.values()];
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
			if (state.ctx?.mode !== "tui") return;
			const pal = palette(state.ctx);
			const build = (width: number): string[] =>
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
			publishDisplay(state.ctx.ui as DisplayUIContext, build);
		});
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

	pi.on("session_shutdown", () => {
		if (state.timer) {
			clearInterval(state.timer);
			state.timer = undefined;
		}
		state.inflight?.abort();
		state.inflight = undefined;
		if (state.ctx?.mode === "tui") {
			clearDisplay(state.ctx.ui as DisplayUIContext);
		}
		state.ctx = undefined;
	});

	pi.registerCommand("usage", {
		description: "Show usage details for configured providers",
		handler: async (_args, commandCtx) => {
			await runUsageCommand(commandCtx.ui, state.snapshots);
		},
	});

	pi.registerCommand("usage-bar", {
		description: "Configure usage-bar settings",
		handler: async (_args, commandCtx) => {
			await runConfigCommand(commandCtx.ui, (cfg) => {
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
