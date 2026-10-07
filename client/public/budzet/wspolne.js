// Wspolne funkcje zakladek Budzet i Lancuchy (zwykly skrypt, ladowany przez
// link.js PRZED budzet-strona.js / kreator.js — dzieli z nimi globalny zakres).
// Motyw jasny/ciemny ustawia sam panel.

const TOKEN_KEY = 'freellmapi_dashboard_token';



function token() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

async function api(path, opts = {}) {
  const t = token();
  const res = await fetch(path, {
    ...opts,
    headers: {
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
  });
  if (res.status === 401) throw Object.assign(new Error('niezalogowany'), { auth: true });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`${path}: ${body?.error?.message ?? `HTTP ${res.status}`}`);
  }
  return res.json();
}

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K`;
  return String(Math.round(n));
}

/** 1 model, 2-4 modele, 5+ modeli (12-14 tez "modeli"). */
function modeli(n) {
  const d = n % 10;
  const s = n % 100;
  if (n === 1) return '1 model';
  if (d >= 2 && d <= 4 && !(s >= 12 && s <= 14)) return `${n} modele`;
  return `${n} modeli`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function klasyfikuj(model, cfg) {
  const key = `${model.platform}/${model.modelId}`.toLowerCase();
  const has = (list) => (list ?? []).some((frag) => key.includes(String(frag).toLowerCase()));
  if (has(cfg.alwaysBad)) return 'stolcowe';
  if (has(cfg.alwaysGood)) return 'dobre';
  const rankOk = model.intelligenceRank != null && model.intelligenceRank <= (cfg.maxRank ?? 93);
  return has(cfg.goodFamilies) && rankOk ? 'dobre' : 'stolcowe';
}

/** Limit wspolny dla calego konta u dostawcy ("account-wide", "shared")? */
function wspolny(m) {
  return /account-wide|shared/i.test(m.monthlyTokenBudget ?? '');
}

/**
 * Twardy limit dzienny modelu. Tokeny maja pierwszenstwo (tpd), potem
 * zapytania (rpd). Bez nich: limit nieopublikowany — nic nie zmyslamy.
 * @returns {{ metric: 'tokens'|'requests'|null, perDay: number|null, group: string }}
 */
function limit(m) {
  const shared = wspolny(m);
  if (m.tpdLimit) return { metric: 'tokens', perDay: m.tpdLimit, group: shared ? `${m.platform}|tokens` : `${m.platform}|${m.modelId}` };
  if (m.rpdLimit) return { metric: 'requests', perDay: m.rpdLimit, group: shared ? `${m.platform}|requests` : `${m.platform}|${m.modelId}` };
  return { metric: null, perDay: null, group: `${m.platform}|${m.modelId}` };
}

/** Krotki opis twardego limitu dziennego ("20 zap./dzień", "1M tok./dzień"). */
function limitOpis(m) {
  const l = limit(m);
  if (!l.metric) return m.rpmLimit ? `${m.rpmLimit}/min` : 'nieopublikowany';
  return `${fmt(l.perDay)} ${l.metric === 'tokens' ? 'tok.' : 'zap.'}/dzień`;
}

// Te same reguly co profileNameSchema w server/dist/routes/profiles.js.
const ZAREZERWOWANE = ['auto', 'smart', 'fast', 'cheap', 'budget', 'intelligence', 'speed', 'active', 'default'];

/** null gdy nazwa lancucha jest dobra, inaczej powod po polsku. */
function bladNazwy(nazwa) {
  if (!nazwa) return 'Wpisz nazwę.';
  if (nazwa.length > 20) return 'Maksymalnie 20 znaków.';
  if (!/^[a-zA-Z0-9_-]+$/.test(nazwa)) return 'Tylko litery bez ogonków, cyfry, - i _.';
  if (ZAREZERWOWANE.includes(nazwa.toLowerCase())) return `„${nazwa}” jest zarezerwowane przez FreeLLMAPI.`;
  return null;
}

/**
 * Modele, ktore "mam": wlaczone, na platformie z wlaczonym kluczem — ten sam
 * zbior, ktory /api/free-tier rozklada na pule. Kazdy model raz.
 */
async function mojeModele(cfg) {
  const [models, free] = await Promise.all([api('/api/models'), api('/api/free-tier')]);
  const platformy = new Set((free.pools ?? []).map((p) => p.platform));
  return models
    .filter((m) => m.enabled && platformy.has(m.platform))
    .map((m) => ({ ...m, kat: klasyfikuj(m, cfg), limit: limit(m) }));
}

/**
 * Kopiowanie do schowka. navigator.clipboard dziala tylko w "secure context"
 * (HTTPS albo localhost) — panel po tailnecie to zwykle HTTP, wiec fallback
 * przez ukryte textarea + execCommand.
 */
async function kopiuj(tekst) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(tekst);
      return true;
    }
  } catch { /* fallback nizej */ }
  const ta = document.createElement('textarea');
  ta.value = tekst;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}
