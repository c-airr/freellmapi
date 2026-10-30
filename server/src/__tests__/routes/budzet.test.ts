import { describe, it, expect, beforeAll } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb, getUnifiedApiKey } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';

// Fork: GET /v1/budzet — ile zostalo dzis per model i dostawca.
async function get(app: Express, path: string, headers: Record<string, string> = {}) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', () => resolve()));
  const { port } = server.address() as { port: number };
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  const body = await res.json().catch(() => null);
  server.close();
  return { status: res.status, body };
}

describe('GET /v1/budzet', () => {
  let app: Express;
  let key = '';

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    key = getUnifiedApiKey();
  });

  it('answers 404 for an unknown chain', async () => {
    const { status } = await get(app, '/v1/budzet?lancuch=nie-ma-takiego', { Authorization: `Bearer ${key}` });
    expect(status).toBe(404);
  });

  it('rejects a missing key with 401', async () => {
    const { status } = await get(app, '/v1/budzet');
    expect(status).toBe(401);
  });

  it('subtracts today\'s tokens and requests from the daily limit', async () => {
    const db = getDb();
    const secret = encrypt('groq-test-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES ('groq', 'test', ?, ?, ?, 'healthy', 1)
    `).run(secret.encrypted, secret.iv, secret.authTag);
    const model = db.prepare(`
      SELECT m.model_id FROM models m JOIN fallback_config fc ON fc.model_db_id = m.id
      WHERE m.platform = 'groq' AND m.enabled = 1 AND fc.enabled = 1 AND m.tpd_limit > 0 AND m.rpd_limit > 0 LIMIT 1
    `).get() as { model_id: string };
    expect(model).toBeTruthy();
    const insert = db.prepare(`
      INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens) VALUES ('groq', ?, ?, ?, ?)
    `);
    insert.run(model.model_id, 'success', 1000, 500);
    insert.run(model.model_id, 'error', 0, 0);

    const { status, body } = await get(app, '/v1/budzet', { Authorization: `Bearer ${key}` });
    expect(status).toBe(200);
    const row = body.modele.find((m: { modelId: string }) => m.modelId === model.model_id);
    expect(row.tokenyDzis).toBe(1500);
    expect(row.tokenyZostalo).toBe(row.tokenyDzien - 1500);
    expect(row.zapytaniaDzis).toBe(2);
    expect(row.zapytaniaZostalo).toBe(row.zapytaniaDzien - 2);
    const groq = body.dostawcy.find((d: { platforma: string }) => d.platforma === 'groq');
    expect(groq.tokenyDzis).toBeGreaterThanOrEqual(1500);
    expect(groq.tokenyZostalo).toBeLessThanOrEqual(groq.tokenyDzien);
    expect(Date.parse(body.resetAt)).toBeGreaterThan(Date.now());
  });

  it('reads the models of a chain by name, as auto:<name> routes it', async () => {
    const db = getDb();
    const profile = db.prepare("INSERT INTO profiles (name) VALUES ('Code')").run().lastInsertRowid;
    const model = db.prepare("SELECT id, model_id FROM models WHERE platform = 'groq' AND enabled = 1 LIMIT 1").get() as { id: number; model_id: string };
    db.prepare('INSERT INTO profile_models (profile_id, model_db_id, priority, enabled) VALUES (?, ?, 1, 1)').run(profile, model.id);
    const { status, body } = await get(app, '/v1/budzet?lancuch=code', { Authorization: `Bearer ${key}` });
    expect(status).toBe(200);
    expect(body.lancuch).toBe('code');
    expect(body.modele.map((m: { modelId: string }) => m.modelId)).toEqual([model.model_id]);
  });
});
