/**
 * Projects: named groups of fallback chains (profiles), mounted under
 * /api/projects behind the dashboard session gate.
 *
 * A project is what one consumer calls — e.g. "discord replies" uses two
 * chains, "automation" three more — so the dashboard can show how much each
 * consumer pulls, per chain and per model. Usage comes from the chain stamped
 * on every auto-routed request (requests.chain_profile_id), so only traffic
 * logged after that column existed is attributable.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { getSinceTimestamp } from './analytics.js';

export const projectsRouter = Router();

const MAX_NAME_LEN = 100;

const profileIdsSchema = z.array(z.number().int().positive()).max(500);
const createSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LEN),
  profileIds: profileIdsSchema.optional(),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME_LEN).optional(),
  profileIds: profileIdsSchema.optional(),
});

interface ProjectRow {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

interface ChainMember {
  profileId: number;
  name: string;
  emoji: string | null;
}

function chainsOf(projectId: number): ChainMember[] {
  return getDb().prepare(`
    SELECT p.id AS profileId, p.name AS name, p.emoji AS emoji
    FROM project_chains pc
    JOIN profiles p ON p.id = pc.profile_id
    WHERE pc.project_id = ?
    ORDER BY p.sort_order, p.id
  `).all(projectId) as ChainMember[];
}

function toJson(row: ProjectRow) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    chains: chainsOf(row.id),
  };
}

function getProject(id: number): ProjectRow | undefined {
  return getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;
}

function parseId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: { message: 'Invalid project id' } });
    return null;
  }
  return id;
}

function nameTaken(name: string, exceptId?: number): boolean {
  const row = getDb().prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE').get(name) as { id: number } | undefined;
  return !!row && row.id !== exceptId;
}

/** The ids that are not existing profiles, so a typo is a 400 instead of a silent drop. */
function unknownProfiles(ids: number[]): number[] {
  if (ids.length === 0) return [];
  const known = new Set(
    (getDb().prepare(`SELECT id FROM profiles WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: number }[])
      .map(r => r.id),
  );
  return ids.filter(id => !known.has(id));
}

function setChains(projectId: number, profileIds: number[]): void {
  const db = getDb();
  db.prepare('DELETE FROM project_chains WHERE project_id = ?').run(projectId);
  const insert = db.prepare('INSERT OR IGNORE INTO project_chains (project_id, profile_id) VALUES (?, ?)');
  for (const id of profileIds) insert.run(projectId, id);
}

projectsRouter.get('/', (_req, res) => {
  const rows = getDb().prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE').all() as ProjectRow[];
  res.json(rows.map(toJson));
});

projectsRouter.post('/', (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: 'A project name is required' } });
    return;
  }
  const { name } = parsed.data;
  const profileIds = [...new Set(parsed.data.profileIds ?? [])];
  if (nameTaken(name)) {
    res.status(409).json({ error: { message: `Project '${name}' already exists` } });
    return;
  }
  const missing = unknownProfiles(profileIds);
  if (missing.length) {
    res.status(400).json({ error: { message: `Unknown chain id(s): ${missing.join(', ')}` } });
    return;
  }
  const db = getDb();
  const id = db.transaction(() => {
    const info = db.prepare('INSERT INTO projects (name) VALUES (?)').run(name);
    const newId = Number(info.lastInsertRowid);
    setChains(newId, profileIds);
    return newId;
  })();
  res.status(201).json(toJson(getProject(id)!));
});

projectsRouter.patch('/:id', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: 'Invalid project update' } });
    return;
  }
  const row = getProject(id);
  if (!row) {
    res.status(404).json({ error: { message: 'Project not found' } });
    return;
  }
  const { name } = parsed.data;
  const profileIds = parsed.data.profileIds ? [...new Set(parsed.data.profileIds)] : undefined;
  if (name && nameTaken(name, id)) {
    res.status(409).json({ error: { message: `Project '${name}' already exists` } });
    return;
  }
  const missing = profileIds ? unknownProfiles(profileIds) : [];
  if (missing.length) {
    res.status(400).json({ error: { message: `Unknown chain id(s): ${missing.join(', ')}` } });
    return;
  }
  const db = getDb();
  db.transaction(() => {
    db.prepare("UPDATE projects SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name ?? row.name, id);
    if (profileIds) setChains(id, profileIds);
  })();
  res.json(toJson(getProject(id)!));
});

projectsRouter.delete('/:id', (req, res) => {
  const id = parseId(req, res);
  if (id === null) return;
  const info = getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
  if (info.changes === 0) {
    res.status(404).json({ error: { message: 'Project not found' } });
    return;
  }
  res.json({ success: true });
});

interface UsageRow {
  chain_profile_id: number;
  chain_name: string | null;
  platform: string;
  model_id: string;
  display_name: string | null;
  requests: number;
  success: number;
  errors: number;
  input_tokens: number | null;
  output_tokens: number | null;
  last_seen_at: string | null;
}

/**
 * Per-chain usage in the window, with the per-model breakdown — the dashboard
 * groups chains into projects itself, so one call serves every project (and
 * the chains that belong to none). Chains with no traffic are included at zero
 * so a fresh project still lists its chains.
 */
projectsRouter.get('/usage', (req, res) => {
  const range = typeof req.query.range === 'string' ? req.query.range : '7d';
  const since = getSinceTimestamp(range);
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      r.chain_profile_id AS chain_profile_id,
      MAX(r.chain_name) AS chain_name,
      r.platform AS platform,
      r.model_id AS model_id,
      MAX(m.display_name) AS display_name,
      COUNT(*) AS requests,
      SUM(CASE WHEN r.status = 'success' THEN 1 ELSE 0 END) AS success,
      SUM(CASE WHEN r.status = 'error' THEN 1 ELSE 0 END) AS errors,
      SUM(r.input_tokens) AS input_tokens,
      SUM(r.output_tokens) AS output_tokens,
      MAX(strftime('%Y-%m-%dT%H:%M:%SZ', r.created_at)) AS last_seen_at
    FROM requests r
    LEFT JOIN models m ON m.id = r.model_db_id
    WHERE r.chain_profile_id IS NOT NULL AND r.created_at >= ?
    GROUP BY r.chain_profile_id, r.platform, r.model_id
    ORDER BY requests DESC
  `).all(since) as UsageRow[];

  const profiles = db.prepare('SELECT id, name, emoji FROM profiles').all() as { id: number; name: string; emoji: string | null }[];
  const byId = new Map(profiles.map(p => [p.id, p]));

  type ChainUsage = {
    profileId: number;
    name: string;
    emoji: string | null;
    deleted: boolean;
    requests: number;
    success: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
    lastSeenAt: string | null;
    models: {
      platform: string;
      modelId: string;
      displayName: string;
      requests: number;
      success: number;
      inputTokens: number;
      outputTokens: number;
    }[];
  };
  const chains = new Map<number, ChainUsage>();
  const chainFor = (id: number, fallbackName: string | null): ChainUsage => {
    let c = chains.get(id);
    if (!c) {
      const p = byId.get(id);
      c = {
        profileId: id,
        name: p?.name ?? fallbackName ?? `#${id}`,
        emoji: p?.emoji ?? null,
        deleted: !p,
        requests: 0, success: 0, errors: 0, inputTokens: 0, outputTokens: 0,
        lastSeenAt: null,
        models: [],
      };
      chains.set(id, c);
    }
    return c;
  };

  for (const r of rows) {
    const c = chainFor(r.chain_profile_id, r.chain_name);
    c.requests += r.requests;
    c.success += r.success;
    c.errors += r.errors;
    c.inputTokens += r.input_tokens ?? 0;
    c.outputTokens += r.output_tokens ?? 0;
    if (r.last_seen_at && (!c.lastSeenAt || r.last_seen_at > c.lastSeenAt)) c.lastSeenAt = r.last_seen_at;
    c.models.push({
      platform: r.platform,
      modelId: r.model_id,
      displayName: r.display_name ?? r.model_id,
      requests: r.requests,
      success: r.success,
      inputTokens: r.input_tokens ?? 0,
      outputTokens: r.output_tokens ?? 0,
    });
  }
  // Every existing chain appears, idle ones at zero.
  for (const p of profiles) chainFor(p.id, p.name);

  res.json({
    range,
    since: since.replace(' ', 'T') + 'Z',
    chains: [...chains.values()].sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name)),
  });
});
