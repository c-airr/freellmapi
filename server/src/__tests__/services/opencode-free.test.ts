import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDb, initDb } from '../../db/index.js';
import {
  openCodeProxyConfig,
  openCodeDisplayName,
  syncOpenCodeProxy,
  startOpenCodeProxy,
  openCodeProxyQuota,
  adviseOpenCodeProxyQuota,
} from '../../services/opencode-free.js';
import { discoverEndpointModels } from '../../services/model-discovery.js';
import { recordCustomModelTombstone } from '../../services/custom-model-tombstone.js';
import type { Scheduler } from '../../lib/scheduler.js';

vi.mock('../../services/model-discovery.js', async () => {
  const actual = await vi.importActual('../../services/model-discovery.js');
  return { ...actual, discoverEndpointModels: vi.fn() };
});

const discover = discoverEndpointModels as unknown as ReturnType<typeof vi.fn>;
const BASE = 'http://zen-proxy:8787/v1';
const cfg = { baseUrl: BASE, apiKey: 'public', label: 'OpenCode Free (zen-proxy)' };

function proxyModels(): Array<{ model_id: string; display_name: string; enabled: number }> {
  return getDb().prepare(
    "SELECT model_id, display_name, enabled FROM models WHERE platform = 'custom' AND endpoint_scope = ? ORDER BY model_id",
  ).all(BASE) as Array<{ model_id: string; display_name: string; enabled: number }>;
}

function proxyKeys(): Array<{ id: number; label: string; enabled: number }> {
  return getDb().prepare(
    "SELECT id, label, enabled FROM api_keys WHERE platform = 'custom' AND base_url = ?",
  ).all(BASE) as Array<{ id: number; label: string; enabled: number }>;
}

describe('opencode free proxy', () => {
  beforeEach(() => {
    process.env.DEV_MODE = 'true';
    process.env.NODE_ENV = 'test';
    initDb(':memory:');
    getDb().exec('DELETE FROM fallback_config; DELETE FROM api_keys; DELETE FROM models; DELETE FROM requests;');
    vi.clearAllMocks();
  });

  it('reads config from env and stays off without a URL', () => {
    expect(openCodeProxyConfig({})).toBeNull();
    expect(openCodeProxyConfig({ OPENCODE_PROXY_URL: '  ' })).toBeNull();
    expect(openCodeProxyConfig({ OPENCODE_PROXY_URL: 'not a url' })).toBeNull();
    expect(openCodeProxyConfig({ OPENCODE_PROXY_URL: 'http://zen-proxy:8787/v1/' })).toEqual(cfg);
    expect(openCodeProxyConfig({
      OPENCODE_PROXY_URL: BASE, OPENCODE_PROXY_KEY: 'zen-key', OPENCODE_PROXY_LABEL: 'Zen',
    })).toEqual({ baseUrl: BASE, apiKey: 'zen-key', label: 'Zen' });
  });

  it('builds readable display names', () => {
    expect(openCodeDisplayName('deepseek-v4.1-flash-free')).toBe('DeepSeek V4.1 Flash Free (OpenCode)');
    expect(openCodeDisplayName('glm-5.3-flash-free')).toBe('GLM 5.3 Flash Free (OpenCode)');
    expect(openCodeDisplayName('flint-40b-free')).toBe('Flint 40B Free (OpenCode)');
    expect(openCodeDisplayName('big-pickle')).toBe('Big Pickle (OpenCode)');
  });

  it('creates the endpoint key and registers discovered chat models', async () => {
    discover.mockResolvedValue([
      { id: 'deepseek-v4.1-flash-free', ownedBy: null },
      { id: 'glm-5.3-flash-free', ownedBy: null },
      { id: 'some-embed-free', ownedBy: null, kind: 'embedding' },
    ]);

    const result = await syncOpenCodeProxy(getDb(), cfg);

    expect(discover).toHaveBeenCalledWith(BASE, 'public');
    expect(result).toEqual({ active: true, added: ['deepseek-v4.1-flash-free', 'glm-5.3-flash-free'], skipped: 1 });
    expect(proxyKeys()).toEqual([expect.objectContaining({ label: 'OpenCode Free (zen-proxy)', enabled: 1 })]);
    expect(proxyModels()).toEqual([
      { model_id: 'deepseek-v4.1-flash-free', display_name: 'DeepSeek V4.1 Flash Free (OpenCode)', enabled: 1 },
      { model_id: 'glm-5.3-flash-free', display_name: 'GLM 5.3 Flash Free (OpenCode)', enabled: 1 },
    ]);
  });

  it('leaves operator choices alone on the next boot', async () => {
    discover.mockResolvedValue([
      { id: 'deepseek-v4.1-flash-free', ownedBy: null },
      { id: 'glm-5.3-flash-free', ownedBy: null },
    ]);
    await syncOpenCodeProxy(getDb(), cfg);

    // Operator disables one model and deletes the other.
    getDb().prepare("UPDATE models SET enabled = 0, display_name = 'DS' WHERE model_id = 'deepseek-v4.1-flash-free'").run();
    getDb().prepare("DELETE FROM fallback_config WHERE model_db_id IN (SELECT id FROM models WHERE model_id = 'glm-5.3-flash-free')").run();
    getDb().prepare("DELETE FROM models WHERE model_id = 'glm-5.3-flash-free'").run();
    recordCustomModelTombstone(getDb(), BASE, 'glm-5.3-flash-free');

    const result = await syncOpenCodeProxy(getDb(), cfg);

    expect(result.added).toEqual([]);
    expect(proxyKeys()).toHaveLength(1);
    expect(proxyModels()).toEqual([{ model_id: 'deepseek-v4.1-flash-free', display_name: 'DS', enabled: 0 }]);
  });

  it('does nothing when the endpoint key is disabled', async () => {
    discover.mockResolvedValue([{ id: 'glm-5.3-flash-free', ownedBy: null }]);
    await syncOpenCodeProxy(getDb(), cfg);
    getDb().prepare("UPDATE api_keys SET enabled = 0 WHERE base_url = ?").run(BASE);
    discover.mockClear();

    const result = await syncOpenCodeProxy(getDb(), cfg);

    expect(result.active).toBe(false);
    expect(discover).not.toHaveBeenCalled();
  });

  it('keeps the key when the proxy is down so the daily sync can retry', async () => {
    discover.mockRejectedValue(new Error('Could not reach'));

    await expect(syncOpenCodeProxy(getDb(), cfg)).rejects.toThrow('Could not reach');
    expect(proxyKeys()).toHaveLength(1);
    expect(proxyModels()).toEqual([]);
  });

  it('retries at boot until the proxy answers', async () => {
    const pending: Array<() => void | Promise<void>> = [];
    const scheduler: Scheduler = {
      every: () => () => {},
      after: (_ms, fn) => { pending.push(fn); return () => {}; },
    };
    discover
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValue([{ id: 'glm-5.3-flash-free', ownedBy: null }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    // The boot path also peeks at the sidecar's /api/status; keep the test
    // hermetic — the proxy is unreachable here.
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => { throw new Error('unreachable'); }) as any;

    const prev = process.env.OPENCODE_PROXY_URL;
    process.env.OPENCODE_PROXY_URL = BASE;
    try {
      expect(startOpenCodeProxy(getDb(), scheduler)).not.toBeNull();
      await pending.shift()!();
      expect(proxyModels()).toEqual([]);
      await pending.shift()!();
      expect(proxyModels().map(m => m.model_id)).toEqual(['glm-5.3-flash-free']);
      expect(pending).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.OPENCODE_PROXY_URL;
      else process.env.OPENCODE_PROXY_URL = prev;
      globalThis.fetch = realFetch;
      warn.mockRestore();
      log.mockRestore();
    }
  });
});

describe('opencode proxy quota advisory', () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  function statusResponse(sync: unknown, ok = true) {
    return { ok, json: async () => ({ sync }) };
  }

  function mockStatus(sync: unknown, ok = true) {
    globalThis.fetch = vi.fn(async () => statusResponse(sync, ok)) as any;
  }

  it('reads the sidecar verdict without touching the DB', async () => {
    mockStatus({
      ok: true,
      working: ['beam-free'],
      rateLimited: ['glm-5.3-flash-free'],
      flaky: ['deepseek-v4.1-flash-free'],
      gated: [],
      dead: ['big-pickle'],
    });

    const quota = await openCodeProxyQuota(cfg);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://zen-proxy:8787/api/status',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(quota).toEqual({
      settled: true,
      reachable: ['beam-free', 'glm-5.3-flash-free'],
      stalled: ['deepseek-v4.1-flash-free', 'big-pickle'],
    });
  });

  it('returns null when the verdict is unknown', async () => {
    // Unreachable proxy.
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as any;
    expect(await openCodeProxyQuota(cfg)).toBeNull();

    // HTTP error.
    mockStatus({}, false);
    expect(await openCodeProxyQuota(cfg)).toBeNull();

    // Bad JSON.
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => { throw new Error('bad json'); } })) as any;
    expect(await openCodeProxyQuota(cfg)).toBeNull();

    // A non-zen-proxy URL answers something else.
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ object: 'list', data: [] }) })) as any;
    expect(await openCodeProxyQuota(cfg)).toBeNull();
  });

  it('marks the verdict unsettled before the first probe cycle', async () => {
    mockStatus({ ok: false, working: [], rateLimited: [], flaky: [], gated: [], dead: [] });
    expect(await openCodeProxyQuota(cfg)).toEqual({ settled: false, reachable: [], stalled: [] });
  });

  it('warns with the anonymous-pool remedy when everything stalls', async () => {
    mockStatus({
      ok: true, working: [], rateLimited: [],
      flaky: ['glm-5.3-flash-free', 'deepseek-v4.1-flash-free'],
      gated: [], dead: [],
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await adviseOpenCodeProxyQuota(cfg);

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain('0 of 2 model(s) reachable');
    expect(line).toContain('https://opencode.ai/auth');
  });

  it('warns about the key itself when a personal key stalls', async () => {
    mockStatus({ ok: true, working: [], rateLimited: [], flaky: [], gated: [], dead: ['glm-5.3-flash-free'] });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await adviseOpenCodeProxyQuota({ ...cfg, apiKey: 'sk-personal' });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('or the key is invalid');
  });

  it('stays silent when the pool is alive, unsettled or unknown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // A rate-limited model is still alive.
    mockStatus({ ok: true, working: [], rateLimited: ['glm-5.3-flash-free'], flaky: [], gated: [], dead: [] });
    await adviseOpenCodeProxyQuota(cfg);

    // No probe cycle completed yet.
    mockStatus({ ok: false, working: [], rateLimited: [], flaky: ['glm-5.3-flash-free'], gated: [], dead: [] });
    await adviseOpenCodeProxyQuota(cfg);

    // Proxy unreachable.
    globalThis.fetch = vi.fn(async () => { throw new Error('down'); }) as any;
    await adviseOpenCodeProxyQuota(cfg);

    expect(warn).not.toHaveBeenCalled();
  });
});
