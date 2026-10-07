import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// Mock only routeRequest so requests "succeed" without real provider keys; the
// rest of the router (resolveRoutingChain, which stamps the chain) stays real.
const { mockRouteRequest } = vi.hoisted(() => ({ mockRouteRequest: vi.fn() }));
vi.mock('../../services/router.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/router.js')>();
  return { ...actual, routeRequest: mockRouteRequest };
});

import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb, getUnifiedApiKey } from '../../db/index.js';
import { getActiveProfileId } from '../../services/profile-models.js';
import { mintDashboardToken } from '../helpers/auth.js';

let dashToken = '';

async function request(
  app: Express,
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {},
) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const addr = server.address() as any;
  const res = await fetch(`http://127.0.0.1:${addr.port}${path}`, {
    method,
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const body = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body };
}

function fakeRoute() {
  return {
    provider: {
      name: 'fake',
      async chatCompletion() {
        return {
          id: 'c', object: 'chat.completion', created: 0, model: 'fake-model',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
        };
      },
    },
    modelId: 'fake-model', modelDbId: 9999, apiKey: 'k', keyId: 1, platform: 'fake', displayName: 'Fake Model',
  };
}

/** A named chain (profile) holding one enabled catalog model, so `auto:<name>` resolves. */
function createChain(name: string): number {
  const db = getDb();
  const info = db.prepare("INSERT INTO profiles (name, emoji, type) VALUES (?, '🔗', 'custom')").run(name);
  const profileId = Number(info.lastInsertRowid);
  const model = db.prepare('SELECT id FROM models WHERE enabled = 1 LIMIT 1').get() as { id: number };
  db.prepare('INSERT INTO profile_models (profile_id, model_db_id, priority, enabled) VALUES (?, ?, 1, 1)').run(profileId, model.id);
  return profileId;
}

function lastRequestChain() {
  return getDb().prepare('SELECT chain_profile_id, chain_name FROM requests ORDER BY id DESC LIMIT 1').get() as
    { chain_profile_id: number | null; chain_name: string | null };
}

describe('projects', () => {
  let app: Express;
  let unifiedKey: string;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    unifiedKey = getUnifiedApiKey();
    dashToken = mintDashboardToken('projects@example.com');
  });

  beforeEach(() => {
    mockRouteRequest.mockReset();
    mockRouteRequest.mockImplementation(() => fakeRoute());
    const db = getDb();
    db.prepare('DELETE FROM projects').run();
    db.prepare('DELETE FROM requests').run();
    db.prepare("DELETE FROM profiles WHERE type = 'custom'").run();
  });

  describe('request chain attribution', () => {
    async function chat(model?: string) {
      const res = await request(app, 'POST', '/v1/chat/completions', {
        token: unifiedKey,
        body: { ...(model ? { model } : {}), messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(res.status).toBe(200);
    }

    it('stamps the named chain on an auto:<name> request', async () => {
      const id = createChain('Discord-Odp');
      await chat('auto:discord-odp');
      expect(lastRequestChain()).toEqual({ chain_profile_id: id, chain_name: 'Discord-Odp' });
    });

    it('stamps the active chain on a plain auto request', async () => {
      const activeId = getActiveProfileId(getDb());
      expect(activeId).not.toBeNull();
      const active = getDb().prepare('SELECT name FROM profiles WHERE id = ?').get(activeId) as { name: string };
      await chat();
      expect(lastRequestChain()).toEqual({ chain_profile_id: activeId, chain_name: active.name });
    });

    it('leaves the chain empty for a global sort', async () => {
      await chat('auto:fast');
      expect(lastRequestChain()).toEqual({ chain_profile_id: null, chain_name: null });
    });
  });

  describe('CRUD', () => {
    it('creates a project with chains, lists it, renames it and swaps its chains', async () => {
      const a = createChain('kanal-a');
      const b = createChain('kanal-b');
      const created = await request(app, 'POST', '/api/projects', {
        token: dashToken, body: { name: 'discord response', profileIds: [a, b, a] },
      });
      expect(created.status).toBe(201);
      expect(created.body.name).toBe('discord response');
      expect(created.body.chains.map((c: any) => c.profileId).sort()).toEqual([a, b].sort());

      const list = await request(app, 'GET', '/api/projects', { token: dashToken });
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(1);

      const patched = await request(app, 'PATCH', `/api/projects/${created.body.id}`, {
        token: dashToken, body: { name: 'discord', profileIds: [b] },
      });
      expect(patched.status).toBe(200);
      expect(patched.body.name).toBe('discord');
      expect(patched.body.chains.map((c: any) => c.profileId)).toEqual([b]);
    });

    it('rejects a duplicate name (case-insensitive) and unknown chains', async () => {
      await request(app, 'POST', '/api/projects', { token: dashToken, body: { name: 'Automatyzacja' } });
      const dup = await request(app, 'POST', '/api/projects', { token: dashToken, body: { name: 'automatyzacja' } });
      expect(dup.status).toBe(409);
      const unknown = await request(app, 'POST', '/api/projects', {
        token: dashToken, body: { name: 'x', profileIds: [987654] },
      });
      expect(unknown.status).toBe(400);
      const noName = await request(app, 'POST', '/api/projects', { token: dashToken, body: { profileIds: [] } });
      expect(noName.status).toBe(400);
    });

    it('deletes a project, and deleting a chain drops only its membership', async () => {
      const a = createChain('zostaje');
      const b = createChain('znika');
      const created = await request(app, 'POST', '/api/projects', {
        token: dashToken, body: { name: 'p', profileIds: [a, b] },
      });
      getDb().prepare('DELETE FROM profiles WHERE id = ?').run(b);
      const list = await request(app, 'GET', '/api/projects', { token: dashToken });
      expect(list.body[0].chains.map((c: any) => c.profileId)).toEqual([a]);

      const del = await request(app, 'DELETE', `/api/projects/${created.body.id}`, { token: dashToken });
      expect(del.status).toBe(200);
      const again = await request(app, 'DELETE', `/api/projects/${created.body.id}`, { token: dashToken });
      expect(again.status).toBe(404);
    });

    it('requires the dashboard session', async () => {
      const res = await request(app, 'GET', '/api/projects');
      expect(res.status).toBe(401);
    });
  });

  describe('usage', () => {
    it('sums requests and tokens per chain with a per-model breakdown', async () => {
      const busy = createChain('busy');
      const idle = createChain('idle');
      for (let i = 0; i < 3; i++) {
        const res = await request(app, 'POST', '/v1/chat/completions', {
          token: unifiedKey, body: { model: 'auto:busy', messages: [{ role: 'user', content: 'hi' }] },
        });
        expect(res.status).toBe(200);
      }

      const usage = await request(app, 'GET', '/api/projects/usage?range=24h', { token: dashToken });
      expect(usage.status).toBe(200);
      const b = usage.body.chains.find((c: any) => c.profileId === busy);
      expect(b).toMatchObject({ name: 'busy', requests: 3, success: 3, errors: 0, deleted: false });
      expect(b.inputTokens + b.outputTokens).toBe(30);
      expect(b.models).toEqual([
        expect.objectContaining({ platform: 'fake', modelId: 'fake-model', requests: 3 }),
      ]);
      // Idle chains are listed at zero so a fresh project still shows them.
      expect(usage.body.chains.find((c: any) => c.profileId === idle)).toMatchObject({ requests: 0, models: [] });
    });

    it('keeps the history of a deleted chain under its last name', async () => {
      const gone = createChain('stary');
      await request(app, 'POST', '/v1/chat/completions', {
        token: unifiedKey, body: { model: 'auto:stary', messages: [{ role: 'user', content: 'hi' }] },
      });
      getDb().prepare('DELETE FROM profiles WHERE id = ?').run(gone);
      const usage = await request(app, 'GET', '/api/projects/usage?range=7d', { token: dashToken });
      expect(usage.body.chains.find((c: any) => c.profileId === gone)).toMatchObject({ name: 'stary', deleted: true, requests: 1 });
    });
  });
});
