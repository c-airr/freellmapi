import type { Db } from '../db/types.js';
import type { Scheduler } from '../lib/scheduler.js';
import { discoverEndpointModels } from './model-discovery.js';
import { registerCustomModels, type CustomModelEntry } from './custom-model-register.js';
import { resolveCustomEndpointKey } from './custom-endpoint.js';
import { isCustomModelTombstoned } from './custom-model-tombstone.js';
import { endpointScopeForBaseUrl, normalizeBaseUrl } from '../lib/endpoint-scope.js';

// ── OpenCode free models through a zen-proxy sidecar (fork c-airr) ───────────
//
// OpenCode Zen's free roster (deepseek-v4.1-flash-free, glm-5.3-flash-free, …)
// answers 403 FreeTierError to anything that is not the OpenCode client, which
// is why the built-in 'opencode' rows are disabled (see providers/index.ts).
// Community proxies such as github.com/12errh/zen-proxy present an
// OpenCode-shaped session upstream and expose the roster as a plain
// OpenAI-compatible /v1. This module does not talk to OpenCode itself: it only
// registers such a proxy as a custom endpoint, so the router treats its models
// like any other relay (failover, cooldowns, chains, analytics).
//
// OPENCODE_PROXY_URL turns it on (docker-compose: http://zen-proxy:8787/v1).
// At boot the endpoint key is created if missing and the proxy's /models is
// registered; the proxy may still be starting, so discovery retries a few
// times. Afterwards the daily custom-model sync picks up new free models.
//
// Operator choices win: an endpoint whose key was disabled is left alone, a
// model already registered is not touched (re-registering would re-enable it),
// and a model the operator deleted stays deleted.

const DEFAULT_LABEL = 'OpenCode Free (zen-proxy)';
// The proxies accept the literal `public` for anonymous free-tier access.
const DEFAULT_KEY = 'public';
const RETRY_DELAY_MS = 30_000;
const MAX_ATTEMPTS = 10;

export interface OpenCodeProxyConfig {
  baseUrl: string;
  apiKey: string;
  label: string;
}

/** Config from env, or null when OPENCODE_PROXY_URL is unset/blank/invalid. */
export function openCodeProxyConfig(env: NodeJS.ProcessEnv = process.env): OpenCodeProxyConfig | null {
  const raw = env.OPENCODE_PROXY_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('not http(s)');
  } catch {
    console.warn(`[opencode-free] OPENCODE_PROXY_URL is not a valid http(s) URL: ${raw}`);
    return null;
  }
  return {
    baseUrl: normalizeBaseUrl(raw),
    apiKey: env.OPENCODE_PROXY_KEY?.trim() || DEFAULT_KEY,
    label: env.OPENCODE_PROXY_LABEL?.trim() || DEFAULT_LABEL,
  };
}

const NAME_TOKENS: Record<string, string> = {
  deepseek: 'DeepSeek',
  glm: 'GLM',
  mimo: 'MiMo',
  minimax: 'MiniMax',
  qwen: 'Qwen',
  kimi: 'Kimi',
  vl: 'VL',
};

/** `deepseek-v4.1-flash-free` → `DeepSeek V4.1 Flash Free (OpenCode)`. */
export function openCodeDisplayName(modelId: string): string {
  const words = modelId.split('-').filter(Boolean).map(token => {
    const known = NAME_TOKENS[token.toLowerCase()];
    if (known) return known;
    if (/^v\d/i.test(token) || /^\d+(\.\d+)?[bkm]$/i.test(token)) return token.toUpperCase();
    return token.charAt(0).toUpperCase() + token.slice(1);
  });
  return `${words.join(' ')} (OpenCode)`;
}

export interface OpenCodeProxySyncResult {
  /** False when the operator disabled the endpoint, so nothing was attempted. */
  active: boolean;
  added: string[];
  skipped: number;
}

/**
 * Ensure the proxy endpoint exists and register the models it serves that are
 * not registered yet. Throws when the proxy cannot be reached, so the caller
 * can retry.
 */
export async function syncOpenCodeProxy(db: Db, cfg: OpenCodeProxyConfig): Promise<OpenCodeProxySyncResult> {
  const existing = db.prepare(
    "SELECT id, enabled FROM api_keys WHERE platform = 'custom' AND base_url = ? ORDER BY id",
  ).all(cfg.baseUrl) as { id: number; enabled: number }[];
  if (existing.length > 0 && existing.every(row => row.enabled === 0)) {
    return { active: false, added: [], skipped: 0 };
  }

  // Create the key up front, even if the proxy is still down: once it exists
  // the daily custom-model sync keeps retrying this endpoint on its own.
  const keyId = existing.find(row => row.enabled === 1)?.id
    ?? resolveCustomEndpointKey(db, cfg.baseUrl, cfg.apiKey, cfg.label).keyId;

  const discovered = await discoverEndpointModels(cfg.baseUrl, cfg.apiKey);

  const scope = endpointScopeForBaseUrl(cfg.baseUrl);
  const registered = new Set(
    (db.prepare("SELECT model_id FROM models WHERE platform = 'custom' AND endpoint_scope = ?").all(scope) as { model_id: string }[])
      .map(row => row.model_id),
  );

  const fresh: CustomModelEntry[] = [];
  let skipped = 0;
  for (const model of discovered) {
    if (model.kind !== undefined || registered.has(model.id) || isCustomModelTombstoned(db, scope, model.id)) {
      skipped += 1;
      continue;
    }
    fresh.push({ modelId: model.id, displayName: openCodeDisplayName(model.id) });
  }

  if (fresh.length > 0) {
    registerCustomModels(db, cfg.baseUrl, undefined, undefined, keyId, fresh);
  }
  return { active: true, added: fresh.map(m => m.modelId), skipped };
}

/** Boot hook: no-op unless OPENCODE_PROXY_URL is set. Returns a cancel fn. */
export function startOpenCodeProxy(db: Db, scheduler: Scheduler): (() => void) | null {
  const cfg = openCodeProxyConfig();
  if (!cfg) return null;

  let cancel: (() => void) | null = null;
  let attempt = 0;
  const run = async () => {
    attempt += 1;
    try {
      const result = await syncOpenCodeProxy(db, cfg);
      if (!result.active) {
        console.log(`[opencode-free] ${cfg.baseUrl} is disabled in the dashboard, skipping`);
      } else if (result.added.length > 0) {
        console.log(`[opencode-free] registered ${result.added.length} model(s) from ${cfg.baseUrl}: ${result.added.join(', ')}`);
      } else {
        console.log(`[opencode-free] ${cfg.baseUrl}: no new models (${result.skipped} already known)`);
      }
    } catch (err: any) {
      const message = err?.message ?? String(err);
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`[opencode-free] ${cfg.baseUrl} not ready (${message}), retry ${attempt}/${MAX_ATTEMPTS - 1} in ${RETRY_DELAY_MS / 1000}s`);
        cancel = scheduler.after(RETRY_DELAY_MS, run);
      } else {
        console.error(`[opencode-free] giving up on ${cfg.baseUrl}: ${message} (the daily custom-model sync will keep trying)`);
      }
    }
  };
  cancel = scheduler.after(0, run);
  return () => cancel?.();
}
