// Migration: projects — named groups of fallback chains
//
// DOWN: reversible (drops the tables; request history is untouched)
//
// A project ("discord replies", "automation") bundles the chains one consumer
// calls, so the dashboard can show what each consumer pulls in total and per
// chain. A chain may belong to several projects. Deleting a project or a chain
// removes only the membership row.

import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS project_chains (
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      PRIMARY KEY (project_id, profile_id)
    );
    CREATE INDEX IF NOT EXISTS idx_project_chains_profile ON project_chains(profile_id);
  `);
}

export function down(db: Db): void {
  db.exec(`
    DROP TABLE IF EXISTS project_chains;
    DROP TABLE IF EXISTS projects;
  `);
}
