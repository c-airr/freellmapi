// Zakladka "Budzet" (/budzet-modeli) — rysowana przez link.js wewnatrz
// panelu FreeLLMAPI. Lista modeli od najmadrzejszego z tokenami na dzien
// i na miesiac.
//
// Kolory liczb:
//  - zwykly  = OFICJALNE: liczba opublikowana przez dostawce w jego
//              dokumentacji (lista dostawcow i linki: config.json -> "oficjalne"),
//  - pomaranczowy "~" = NIEOFICJALNE: szacunek z katalogu FreeLLMAPI albo
//              wyliczenie z Twoich logow; zrodlo w ostatniej kolumnie.
// Pasek przy liczbie: pelny = oficjalne, kreskowany = szacunek (skala log).
//
// Wspolne funkcje (api, fmt, esc): wspolne.js.
(function () {
  const DNI = 30;

  // ---------- dane ----------

  /** Srednia tokenow na UDANE zapytanie z logow (30 dni): per model i ogolna. */
  function srednie(rows) {
    const perModel = new Map();
    let tok = 0;
    let udane = 0;
    for (const r of rows) {
      const ok = (r.requests ?? 0) * ((r.successRate ?? 0) / 100);
      const t = (r.totalInputTokens ?? 0) + (r.totalOutputTokens ?? 0);
      if (ok < 1) continue;
      tok += t;
      udane += ok;
      // Wlasna srednia tylko przy sensownej probce.
      if (ok >= 30) perModel.set(`${r.platform}|${r.modelId}`, t / ok);
    }
    return { perModel, ogolna: udane ? tok / udane : null };
  }

  /** "200/hr" w opisie katalogu -> zapytan na godzine. */
  function zapytanNaGodzine(opis) {
    const m = /(\d+(?:\.\d+)?)\s*([kK])?\s*\/\s*hr/.exec(opis ?? '');
    if (!m) return null;
    return Number(m[1]) * (m[2] ? 1000 : 1);
  }

  function policz(m, katalog, budzet, sr, cfg) {
    const ofic = cfg.oficjalne?.[m.platform] ?? null;
    const pola = new Set(ofic?.pola ?? []);
    const klucze = Math.max(1, katalog?.keyCount ?? 1);
    const opis = katalog?.monthlyTokenBudget ?? '';
    const wspolny = /account-wide|shared|per IP/i.test(opis);

    // Limity zapytan/tokenow jako lista kawalkow, kazdy z flaga oficjalnosci.
    const limity = [];
    const dodaj = (pole, wartosc, jedn) => {
      if (wartosc) limity.push({ txt: `${fmt(wartosc)} ${jedn}`, ofic: pola.has(pole) });
    };
    dodaj('rpd', m.rpdLimit, 'zap./dzień');
    dodaj('rpm', m.rpmLimit, 'zap./min');
    dodaj('tpm', m.tpmLimit, 'tok./min');

    let dzien = null;
    let oficjalne = false;
    let zrodlo;

    const srednia = sr.perModel.get(`${m.platform}|${m.modelId}`) ?? sr.ogolna;
    const naGodzine = zapytanNaGodzine(opis);
    const zapDzien = m.rpdLimit ?? (naGodzine != null ? naGodzine * 24 : null);

    if (m.tpdLimit) {
      // Twardy limit tokenow dziennie z katalogu — oficjalny tylko gdy
      // dostawca faktycznie publikuje TPD.
      dzien = m.tpdLimit * klucze;
      oficjalne = pola.has('tpd');
      zrodlo = oficjalne
        ? { txt: 'dokumentacja dostawcy', url: ofic.url }
        : { txt: `katalog FreeLLMAPI: ${fmt(m.tpdLimit)} tok./dzień${klucze > 1 ? ` × ${klucze} klucze` : ''}, dostawca tego nie publikuje` };
    } else if (budzet > 0 && budzet !== m.rpdLimit) {
      // Szacunek miesieczny FreeLLMAPI (juz pomnozony przez liczbe kluczy).
      // budzet === rpdLimit to blad parsowania katalogu ("14.4K rpd").
      dzien = budzet / DNI;
      zrodlo = { txt: `szacunek FreeLLMAPI „${opis}”/mies.${klucze > 1 ? ` × ${klucze} klucze` : ''}` };
    } else if (zapDzien && srednia) {
      dzien = zapDzien * klucze * srednia;
      const skad = m.rpdLimit ? `${fmt(m.rpdLimit)} zap./dzień` : opis.replace(/^free · /, '');
      zrodlo = {
        txt: `wyliczone: ${skad}${klucze > 1 ? ` × ${klucze} klucze` : ''} × ~${fmt(srednia)} tok./zap.`,
        tytul: 'Średnia tokenów na udane zapytanie z Twoich logów FreeLLMAPI (30 dni)',
      };
    } else if (/no token cap/i.test(opis)) {
      zrodlo = { txt: 'bez limitu tokenów, tylko kolejka (Kudos)' };
    } else {
      zrodlo = { txt: `brak danych${opis ? `, katalog: „${opis}”` : ''}` };
    }

    return {
      nazwa: m.displayName || m.modelId,
      platforma: m.platform,
      modelId: m.modelId,
      rank: m.intelligenceRank,
      dzien,
      miesiac: dzien != null ? dzien * DNI : null,
      oficjalne,
      zrodlo,
      limity,
      wspolny,
    };
  }

  async function zaladuj() {
    const [tu, modele, by30, cfg] = await Promise.all([
      api('/api/fallback/token-usage'),
      api('/api/models'),
      api('/api/analytics/by-model?range=30d'),
      fetch('/budzet/config.json', { cache: 'no-cache' }).then((r) => r.json()),
    ]);
    const katalog = new Map(modele.map((m) => [m.id, m]));
    const sr = srednie(by30);
    const wiersze = tu.models
      .filter((m) => m.enabled)
      .map((m) => policz(m, katalog.get(m.modelDbId), m.budget, sr, cfg));

    // Pula wspolna dla konta/IP: ile modeli z niej pije.
    const wPuli = new Map();
    for (const w of wiersze) if (w.wspolny) wPuli.set(w.platforma, (wPuli.get(w.platforma) ?? 0) + 1);
    for (const w of wiersze) w.puli = w.wspolny ? wPuli.get(w.platforma) : 0;

    // Od najlepszego (najnizszy rank FreeLLMAPI) do najslabszego;
    // przy remisie wiekszy budzet wyzej.
    wiersze.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || (b.dzien ?? -1) - (a.dzien ?? -1));
    return { wiersze, srednia: sr.ogolna, cfg };
  }

  // ---------- render ----------

  /** Szerokosc paska w %: skala logarytmiczna od 10K do maksimum na liscie. */
  function skala(max) {
    const lo = 4;
    const hi = Math.max(lo + 1, Math.log10(max || 1));
    return (v) => Math.max(3, Math.min(100, ((Math.log10(Math.max(v, 1)) - lo) / (hi - lo)) * 100));
  }

  function liczba(w, wartosc) {
    if (wartosc == null) return '<span class="zk-szary">—</span>';
    return w.oficjalne
      ? `<span class="zk-ofic">${fmt(wartosc)}</span>`
      : `<span class="zk-nieof">~${fmt(wartosc)}</span>`;
  }

  function wiersz(w, i, szer) {
    const limity = w.limity.length
      ? w.limity.map((l) => `<span class="${l.ofic ? 'zk-ofic' : 'zk-nieof'}">${esc(l.txt)}</span>`).join('<br>')
      : '<span class="zk-szary">—</span>';
    const zrodlo = w.zrodlo.url
      ? `<a href="${esc(w.zrodlo.url)}" target="_blank" rel="noopener">${esc(w.zrodlo.txt)}</a>`
      : esc(w.zrodlo.txt);
    const tytul = w.zrodlo.tytul ? ` title="${esc(w.zrodlo.tytul)}"` : '';
    const pasek = w.dzien != null
      ? `<div class="zk-pasek" aria-hidden="true"><i class="${w.oficjalne ? 'ofic' : 'nieof'}" style="width:${szer(w.dzien).toFixed(1)}%"></i></div>`
      : '';
    const pula = w.puli > 1 ? `<div class="zk-pod">pula wspólna dla ${w.puli} modeli ${esc(w.platforma)}</div>` : '';
    return `
      <tr>
        <td class="zk-n zk-szary">${i + 1}</td>
        <td>
          <div class="zk-nazwa">${esc(w.nazwa)} <span class="zk-rank" title="Ranking inteligencji FreeLLMAPI (mniej = mądrzejszy)">#${w.rank ?? '?'}</span></div>
          <div class="zk-pod">${esc(w.platforma)} · ${esc(w.modelId)}</div>
        </td>
        <td class="zk-n zk-dzien">${liczba(w, w.dzien)}${pasek}</td>
        <td class="zk-n">${liczba(w, w.miesiac)}${pula}</td>
        <td class="zk-lim">${limity}</td>
        <td class="zk-zrodlo ${w.oficjalne ? '' : 'zk-zrodlo-nieof'}"${tytul}>${zrodlo}</td>
      </tr>`;
  }

  function tabela(el, dane, szukaj) {
    const q = szukaj.trim().toLowerCase();
    const widoczne = q
      ? dane.wiersze.filter((w) => `${w.nazwa} ${w.platforma} ${w.modelId}`.toLowerCase().includes(q))
      : dane.wiersze;
    const szer = skala(Math.max(...dane.wiersze.map((w) => w.dzien ?? 0)));
    // Numeracja = miejsce w rankingu calej listy, takze przy filtrze.
    const miejsce = new Map(dane.wiersze.map((w, i) => [w, i]));
    el.querySelector('tbody').innerHTML = widoczne.length
      ? widoczne.map((w) => wiersz(w, miejsce.get(w), szer)).join('')
      : `<tr><td colspan="6" class="zk-pusto">Żaden model nie pasuje do „${esc(szukaj)}”.</td></tr>`;
    el.querySelector('.zk-ile').textContent = q ? `${widoczne.length} z ${dane.wiersze.length} modeli` : `${dane.wiersze.length} modeli`;
  }

  async function zkBudzet(el) {
    el.innerHTML = `
      <div class="zk-glowa">
        <h1 class="text-2xl font-semibold tracking-tight">Budżet</h1>
        <p class="text-sm text-muted-foreground mt-1">Ile tokenów dziennie i miesięcznie daje każdy model, od najmądrzejszego. Zwykłe liczby publikuje dostawca, pomarańczowe z tyldą to szacunki.</p>
      </div>
      <p class="zk-szary">Ładuję…</p>`;
    let dane;
    try {
      dane = await zaladuj();
    } catch (err) {
      el.lastElementChild.outerHTML = err.auth
        ? '<p class="zk-szary">Sesja wygasła. Zaloguj się w panelu i wróć na tę zakładkę.</p>'
        : `<p class="zk-blad">Nie udało się pobrać danych: ${esc(err.message)}</p>`;
      return;
    }
    if (!el.isConnected) return;

    const linki = Object.entries(dane.cfg.oficjalne ?? {})
      .map(([p, o]) => `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(p)}</a>`)
      .join(', ');
    el.lastElementChild.outerHTML = `
      <div class="zk-pasek-narzedzi">
        <input class="zk-szukaj" type="search" placeholder="Szukaj modelu albo dostawcy" aria-label="Szukaj modelu albo dostawcy" autocomplete="off" spellcheck="false">
        <span class="zk-ile zk-szary"></span>
        <div class="zk-legenda">
          <span><i class="zk-wzor ofic"></i>oficjalne, z dokumentacji: ${linki || 'brak'}</span>
          <span><i class="zk-wzor nieof"></i><span class="zk-nieof">szacunek</span>, źródło w ostatniej kolumnie</span>
        </div>
      </div>
      <div class="zk-tabela">
        <table>
          <thead><tr>
            <th class="zk-n">#</th><th>Model</th><th class="zk-n">Tokeny / dzień</th><th class="zk-n">Tokeny / mies.</th><th>Limity zapytań</th><th>Skąd liczba tokenów</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
      <p class="zk-pod zk-stopka">Miesiąc = ${DNI} × dzień. Średnia z Twoich logów: ~${fmt(dane.srednia)} tok. na udane zapytanie.
        Oficjalne źródła ustawiasz w <code>config.json</code> zakładek (klucz „oficjalne”), patrz FORK.md.</p>`;

    const pole = el.querySelector('.zk-szukaj');
    pole.addEventListener('input', () => tabela(el, dane, pole.value));
    tabela(el, dane, '');
  }

  window.zkBudzet = zkBudzet;
})();
