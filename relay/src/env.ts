export interface Env {
	ASSETS: Fetcher;
	INVITES: KVNamespace;
	META_BASE_URL?: string;
	MODEL_API_KEY?: string;
}

export function metaBase(env: Env): string {
	return (env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/+$/, '');
}
