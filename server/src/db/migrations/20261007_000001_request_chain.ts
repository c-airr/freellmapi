// Migration: stamp request history with the named chain that routed it
//
// DOWN: reversible
//
// `auto:<name>` (and plain `auto`, which is served by the active chain) routes
// over a named profile, but the request row only kept the model that answered
// — requested_model is NULL for auto-routed traffic. Without the chain there is
// no way to tell how much each chain (and so each project grouping chains)
// actually pulls.
//
// chain_profile_id points at profiles(id) without a foreign key: history must
// survive the user deleting the chain. chain_name is the name at request time,
// so a deleted (or later renamed) chain still reads sensibly. Both stay NULL for
// pinned-model requests, global sorts (auto:smart, ...) and older rows.

import type { Db } from '../types.js';

function hasColumn(db: Db, table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return columns.some(c => c.name === column);
}

export function up(db: Db): void {
  if (!hasColumn(db, 'requests', 'chain_profile_id')) {
    db.prepare('ALTER TABLE requests ADD COLUMN chain_profile_id INTEGER').run();
  }
  if (!hasColumn(db, 'requests', 'chain_name')) {
    db.prepare('ALTER TABLE requests ADD COLUMN chain_name TEXT').run();
  }
  // Per-chain usage reads filter by chain and a time window.
  db.prepare('CREATE INDEX IF NOT EXISTS idx_requests_chain_created ON requests(chain_profile_id, created_at)').run();
}

export function down(db: Db): void {
  db.prepare('DROP INDEX IF EXISTS idx_requests_chain_created').run();
  if (hasColumn(db, 'requests', 'chain_name')) db.prepare('ALTER TABLE requests DROP COLUMN chain_name').run();
  if (hasColumn(db, 'requests', 'chain_profile_id')) db.prepare('ALTER TABLE requests DROP COLUMN chain_profile_id').run();
}
