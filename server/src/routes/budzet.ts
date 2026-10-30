import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb, getUnifiedApiKey } from '../db/index.js';
import { extractApiToken, timingSafeStringEqual } from './proxy.js';
import { chainModelBudgets } from './fallback.js';
import { learnedLimits } from './projects.js';
import { getSinceTimestamp } from './analytics.js';

// Fork: GET /v1/budzet — ile tokenow i zapytan zostalo dzis (od polnocy UTC)
// per model i per dostawca, dla klientow z kluczem API (OpenBot). Limit dzienny
// liczony jak w zakladce Budzet (client/public/budzet/budzet.js, funkcja policz):
// oficjalny z config.json, nauczony z 429, szacunek z katalogu albo z logow.
// shortcut: logika limitu jest skopiowana z budzet.js, zmiana tam = zmiana tu;
// przeniesc zakladke na ten endpoint, gdy beda sie rozjezdzac.

const DNI = 30;

interface Oficjalne { url: string; pola: string[] }

function wczytajOficjalne(clientDist: string): Record<string, Oficjalne> {
  try {
    const cfg = JSON.parse(readFileSync(path.join(clientDist, 'budzet', 'config.json'), 'utf8'));
    return cfg.oficjalne ?? {};
  } catch {
    return {};
  }
}

/** "200/hr" w opisie katalogu -> zapytan na godzine. */
function zapytanNaGodzine(opis: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*([kK])?\s*\/\s*hr/.exec(opis);
  return m ? Number(m[1]) * (m[2] ? 1000 : 1) : null;
}

export function createBudzetRouter(clientDist: string) {
  const router = Router();
  router.get('/budzet', (req: Request, res: Response) => {
    const token = extractApiToken(req);
    if (!token || !timingSafeStringEqual(token, getUnifiedApiKey())) {
      res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error' } });
      return;
    }
    const db = getDb();
    const oficjalne = wczytajOficjalne(clientDist);
    const nauczone = new Map(learnedLimits().map((n) => [`${n.platform}|${n.modelId}`, n]));

    // Srednia tokenow na udane zapytanie (30 dni): per model przy >= 30 udanych, inaczej ogolna.
    const logi = db.prepare(`
      SELECT platform, model_id AS modelId,
             SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS ok,
             SUM(CASE WHEN status = 'success' THEN input_tokens + output_tokens ELSE 0 END) AS tok
      FROM requests WHERE created_at >= ? AND request_type = 'chat'
      GROUP BY platform, model_id
    `).all(getSinceTimestamp('30d')) as { platform: string; modelId: string; ok: number; tok: number }[];
    const sredniaModelu = new Map(logi.filter((r) => r.ok >= 30).map((r) => [`${r.platform}|${r.modelId}`, r.tok / r.ok]));
    const okRazem = logi.reduce((s, r) => s + r.ok, 0);
    const sredniaOgolna = okRazem ? logi.reduce((s, r) => s + r.tok, 0) / okRazem : null;

    const dzis = db.prepare(`
      SELECT platform, model_id AS modelId, COUNT(*) AS zapytania,
             COALESCE(SUM(CASE WHEN status = 'success' THEN input_tokens + output_tokens ELSE 0 END), 0) AS tokeny
      FROM requests WHERE created_at >= date('now') AND request_type = 'chat'
      GROUP BY platform, model_id
    `).all() as { platform: string; modelId: string; zapytania: number; tokeny: number }[];
    const dzisModelu = new Map(dzis.map((r) => [`${r.platform}|${r.modelId}`, r]));

    const modele = chainModelBudgets().filter((m) => m.enabled).map((m) => {
      const klucz = `${m.platform}|${m.modelId}`;
      const pola = new Set(oficjalne[m.platform]?.pola ?? []);
      const opis = m.monthlyTokenBudget ?? '';
      const klucze = Math.max(1, m.keyCount);
      let dzien: number | null = null;
      let rodzaj: 'oficjalny' | 'szacunek' | 'nauczony' = 'szacunek';
      const srednia = sredniaModelu.get(klucz) ?? sredniaOgolna;
      const naGodzine = zapytanNaGodzine(opis);
      const zapDzien = m.rpdLimit ?? (naGodzine != null ? naGodzine * 24 : null);
      if (m.tpdLimit) {
        dzien = m.tpdLimit * klucze;
        if (pola.has('tpd')) rodzaj = 'oficjalny';
      } else if (m.budget > 0 && m.budget !== m.rpdLimit) {
        // budget === rpdLimit to blad parsowania katalogu ("14.4K rpd").
        dzien = m.budget / DNI;
      } else if (zapDzien && srednia) {
        dzien = zapDzien * klucze * srednia;
      }
      // Limit nauczony z 429 wygrywa z kazdym szacunkiem, nie z oficjalnym.
      const n = nauczone.get(klucz);
      if (n && rodzaj !== 'oficjalny') {
        dzien = n.tokens;
        rodzaj = 'nauczony';
      }
      const uzyte = dzisModelu.get(klucz);
      const zapytaniaLimit = m.rpdLimit ? m.rpdLimit * klucze : null;
      return {
        nazwa: m.displayName || m.modelId,
        platforma: m.platform,
        modelId: m.modelId,
        rank: m.intelligenceRank,
        tokenyDzien: dzien != null ? Math.round(dzien) : null,
        tokenyDzis: uzyte?.tokeny ?? 0,
        tokenyZostalo: dzien != null ? Math.max(0, Math.round(dzien - (uzyte?.tokeny ?? 0))) : null,
        zapytaniaDzien: zapytaniaLimit,
        zapytaniaDzis: uzyte?.zapytania ?? 0,
        zapytaniaZostalo: zapytaniaLimit != null ? Math.max(0, zapytaniaLimit - (uzyte?.zapytania ?? 0)) : null,
        rodzaj,
        wspolny: /account-wide|shared|per IP/i.test(opis),
      };
    });

    // Per dostawca: limity per model sie sumuja; pula wspolna konta/IP liczy sie raz
    // (najwiekszy limit z puli, zuzycie calej puli).
    const dostawcy = new Map<string, { platforma: string; pule: Map<string, { dzien: number; dzis: number }> }>();
    for (const m of modele) {
      let d = dostawcy.get(m.platforma);
      if (!d) dostawcy.set(m.platforma, (d = { platforma: m.platforma, pule: new Map() }));
      if (m.tokenyDzien == null) continue;
      const pula = m.wspolny ? 'wspolna' : m.modelId;
      const p = d.pule.get(pula) ?? { dzien: 0, dzis: 0 };
      p.dzien = Math.max(p.dzien, m.tokenyDzien);
      p.dzis += m.tokenyDzis;
      d.pule.set(pula, p);
    }

    const polnoc = new Date();
    polnoc.setUTCHours(24, 0, 0, 0);
    res.json({
      resetAt: polnoc.toISOString(),
      dostawcy: [...dostawcy.values()].map((d) => {
        const pule = [...d.pule.values()];
        return {
          platforma: d.platforma,
          tokenyDzien: pule.length ? pule.reduce((s, p) => s + p.dzien, 0) : null,
          tokenyDzis: pule.reduce((s, p) => s + p.dzis, 0),
          tokenyZostalo: pule.length ? pule.reduce((s, p) => s + Math.max(0, p.dzien - p.dzis), 0) : null,
        };
      }).sort((a, b) => (b.tokenyDzien ?? -1) - (a.tokenyDzien ?? -1)),
      modele,
    });
  });
  return router;
}
