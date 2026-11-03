// Migration: remove the OpenCode Zen provider
// Created: 2026-11-03
//
// DOWN: reversible (the removed rows are kept in settings)
//
// The fork drops OpenCode Zen completely. Since 2026-09 its free roster is
// locked to the OpenCode client and every promotional row answers 403, so the
// provider only offered paid models under a second billing account; the
// adapter is unregistered in server/src/providers/index.ts, so these rows can
// never serve again. Remove the keys, models, embedding/media rows, model
// overrides, quota state, quirk selectors, and the chain and profile entries
// that point at the models. Request history keeps its 'opencode' rows; that is
// a record, not config. Same shape as the Auray and GitHub Models removals.

import type { Db } from '../types.js';

const PLATFORM = 'opencode';
const SETTING_KEY = 'migration_opencode_removed_rows';

type Row = Record<string, unknown>;

// Insert order for DOWN: parents before the rows that reference them.
const TABLES = [
  'api_keys',
  'models',
  'embedding_models',
  'media_models',
  'model_overrides',
  'fallback_config',
  'profile_models',
  'provider_quota_state',
  'quirk_targets',
] as const;
type Table = (typeof TABLES)[number];

function tableExists(db: Db, table: string): boolean {
  return db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

function selectRows(db: Db, table: Table): Row[] {
  if (!tableExists(db, table)) return [];
  if (table === 'fallback_config' || table === 'profile_models') {
    return db.prepare(`
      SELECT * FROM ${table} WHERE model_db_id IN (SELECT id FROM models WHERE platform = ?)
    `).all(PLATFORM) as Row[];
  }
  return db.prepare(`SELECT * FROM ${table} WHERE platform = ?`).all(PLATFORM) as Row[];
}

// Encrypted key columns may be BLOBs; JSON keeps them as tagged base64.
function encode(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = Buffer.isBuffer(v) ? { $buffer: v.toString('base64') } : v;
  }
  return out;
}

function decode(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    const tagged = v as { $buffer?: string } | null;
    out[k] = tagged && typeof tagged === 'object' && typeof tagged.$buffer === 'string'
      ? Buffer.from(tagged.$buffer, 'base64')
      : v;
  }
  return out;
}

export function up(db: Db): void {
  const removed: Partial<Record<Table, Row[]>> = {};
  for (const table of TABLES) removed[table] = selectRows(db, table).map(encode);

  // Children first: chain and profile rows reference models(id).
  for (const table of ['fallback_config', 'profile_models'] as const) {
    if (!tableExists(db, table)) continue;
    db.prepare(`
      DELETE FROM ${table} WHERE model_db_id IN (SELECT id FROM models WHERE platform = ?)
    `).run(PLATFORM);
  }
  for (const table of ['models', 'embedding_models', 'media_models', 'model_overrides', 'provider_quota_state', 'quirk_targets', 'api_keys'] as const) {
    if (!tableExists(db, table)) continue;
    db.prepare(`DELETE FROM ${table} WHERE platform = ?`).run(PLATFORM);
  }

  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(SETTING_KEY, JSON.stringify(removed));
}

export function down(db: Db): void {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTING_KEY) as { value: string } | undefined;
  const removed: Partial<Record<Table, Row[]>> = row ? JSON.parse(row.value) : {};
  for (const table of TABLES) {
    for (const raw of removed[table] ?? []) {
      const r = decode(raw);
      const cols = Object.keys(r);
      db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map(c => r[c]));
    }
  }
  db.prepare('DELETE FROM settings WHERE key = ?').run(SETTING_KEY);
}
