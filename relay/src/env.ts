export interface Env {
	ASSETS: Fetcher;
	INVITES: KVNamespace; // invites, plus the daily budget tallies (budget:* keys)
	META_BASE_URL?: string;
	MODEL_API_KEY?: string;
	/** Daily ceiling on model spend in USD across all isolates (default 5). */
	DAILY_BUDGET_USD?: string;
	/** Weave's own share of that ceiling (default 40% of it). */
	WEAVE_BUDGET_USD?: string;
	/** Daily cap on invite/pick KV writes across all isolates (default 600). */
	KV_WRITES_PER_DAY?: string;
	/** Optional edge rate-limit bindings (per location, shared by its isolates). */
	RL_SPARK?: RateLimit;
	RL_WEAVE?: RateLimit;
	RL_VOICE?: RateLimit;
	RL_INVITE?: RateLimit;
}

export function metaBase(env: Env): string {
	return (env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/+$/, '');
}
