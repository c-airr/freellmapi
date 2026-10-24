// Zakladka "Budzet" (/budzet-modeli) — rysowana przez link.js wewnatrz
// panelu FreeLLMAPI. Lista modeli od najmadrzejszego z tokenami na dzien
// i na miesiac.
//
// Kolory liczb:
//  - zwykly  = OFICJALNE: liczba opublikowana przez dostawce w jego
//              dokumentacji (lista dostawcow i linki: config.json -> "oficjalne"),
//  - pomaranczowy "~" = NIEOFICJALNE: szacunek z katalogu FreeLLMAPI albo
//              wyliczenie z Twoich logow; zrodlo w ostatniej kolumnie,
//  - zolty "~" = NAUCZONE: model oddal 429, wiec tyle tokenow zjadl tego dnia
//              do bledu (max z 30 dni, /api/projects/learned-limits).
// Pasek przy liczbie: pelny = oficjalne, kreskowany = szacunek (skala log).
// Nad lista: suma per dostawca (tylko platformy z kluczem); modele ze wspolnej
// puli konta/IP licza sie raz. Nie pule z /api/free-tier: tam Groq i Google sa
// jedna pula na konto, choc ich limity tokenow sa per model.
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

  function policz(m, katalog, budzet, sr, cfg, nauczone) {
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
    }

    // Realny limit z wlasnych bledow 429 wygrywa z kazdym szacunkiem, nie z oficjalnym.
    // Stary szacunek zostaje obok: limit bywa w zapytaniach albo miesieczny, a 429 tego nie powie.
    const n = nauczone.get(`${m.platform}|${m.modelId}`);
    let szacunek = null;
    if (n && !oficjalne) {
      if (dzien != null) szacunek = { dzien, zrodlo };
      dzien = n.tokens;
      zrodlo = {
        txt: `nauczone z błędów 429: tyle zjadł danego dnia do limitu (${n.days} ${n.days === 1 ? 'dzień' : 'dni'} z limitem w 30 dni, ostatnio ${n.lastDay})`,
        tytul: 'Suma tokenów udanych zapytań od północy UTC do ostatniego błędu 429 tego dnia; najwyższa z 30 dni. Rośnie, gdy znów dobijesz do limitu.',
      };
    } else if (dzien == null) {
      zrodlo = /no token cap/i.test(opis)
        ? { txt: 'bez limitu tokenów, tylko kolejka (Kudos)' }
        : { txt: `brak danych${opis ? `, katalog: „${opis}”` : ''}` };
    }

    return {
      nazwa: m.displayName || m.modelId,
      platforma: m.platform,
      modelId: m.modelId,
      rank: m.intelligenceRank,
      dzien,
      miesiac: dzien != null ? dzien * DNI : null,
      oficjalne,
      nauczone: !!(n && !oficjalne),
      szacunek,
      zrodlo,
      limity,
      wspolny,
    };
  }

  /**
   * Suma per dostawca: limity per model sie sumuja, z puli wspolnej (w.wspolny)
   * bierzemy jeden, najwiekszy model.
   * Kolor sumy = najmniej pewny skladnik: oficjalna tylko gdy wszystkie sa oficjalne.
   */
  function dostawcy(wiersze, klucze) {
    const wynik = new Map();
    for (const w of wiersze) {
      let d = wynik.get(w.platforma);
      if (!d) wynik.set(w.platforma, (d = { platforma: w.platforma, modele: 0, bezDanych: 0, klucze: 0, pule: new Map() }));
      d.modele += 1;
      d.klucze = klucze.get(w.platforma) ?? 1;
      if (w.dzien == null) { d.bezDanych += 1; continue; }
      const klucz = w.wspolny ? 'wspolna' : w.modelId;
      const naj = d.pule.get(klucz);
      if (!naj || w.dzien > naj.dzien) d.pule.set(klucz, w);
    }
    return [...wynik.values()].map((d) => {
      const czesci = [...d.pule.values()];
      const rodzaje = new Set(czesci.map(rodzaj));
      const dzien = czesci.length ? czesci.reduce((s, w) => s + w.dzien, 0) : null;
      return {
        ...d,
        dzien,
        wspolne: d.modele - d.bezDanych - czesci.length,
        rodzaj: rodzaje.has('nieof') ? 'nieof' : rodzaje.has('nauk') ? 'nauk' : 'ofic',
      };
    }).sort((a, b) => (b.dzien ?? -1) - (a.dzien ?? -1) || a.platforma.localeCompare(b.platforma));
  }

  async function zaladuj() {
    const [tu, modele, by30, cfg, nauk] = await Promise.all([
      api('/api/fallback/token-usage'),
      api('/api/models'),
      api('/api/analytics/by-model?range=30d'),
      fetch('/budzet/config.json', { cache: 'no-cache' }).then((r) => r.json()),
      api('/api/projects/learned-limits'),
    ]);
    const nauczone = new Map(nauk.models.map((n) => [`${n.platform}|${n.modelId}`, n]));
    const katalog = new Map(modele.map((m) => [m.id, m]));
    const sr = srednie(by30);
    const wiersze = tu.models
      .filter((m) => m.enabled)
      .map((m) => policz(m, katalog.get(m.modelDbId), m.budget, sr, cfg, nauczone));

    // Pula wspolna dla konta/IP: ile modeli z niej pije.
    const wPuli = new Map();
    for (const w of wiersze) if (w.wspolny) wPuli.set(w.platforma, (wPuli.get(w.platforma) ?? 0) + 1);
    for (const w of wiersze) w.puli = w.wspolny ? wPuli.get(w.platforma) : 0;

    // Od najlepszego (najnizszy rank FreeLLMAPI) do najslabszego;
    // przy remisie wiekszy budzet wyzej.
    wiersze.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || (b.dzien ?? -1) - (a.dzien ?? -1));
    const klucze = new Map(modele.map((m) => [m.platform, Math.max(1, m.keyCount ?? 1)]));
    return { wiersze, dostawcy: dostawcy(wiersze, klucze), srednia: sr.ogolna, cfg };
  }

  // ---------- render ----------

  /** Szerokosc paska w %: skala logarytmiczna od 10K do maksimum na liscie. */
  function skala(max) {
    const lo = 4;
    const hi = Math.max(lo + 1, Math.log10(max || 1));
    return (v) => Math.max(3, Math.min(100, ((Math.log10(Math.max(v, 1)) - lo) / (hi - lo)) * 100));
  }

  const rodzaj = (w) => (w.oficjalne ? 'ofic' : w.nauczone ? 'nauk' : 'nieof');

  function liczba(w, wartosc, r = rodzaj(w)) {
    if (wartosc == null) return '<span class="zk-szary">—</span>';
    return r === 'ofic'
      ? `<span class="zk-ofic">${fmt(wartosc)}</span>`
      : `<span class="zk-${r}">~${fmt(wartosc)}</span>`;
  }

  function dostawca(d, szer, wybrany) {
    const opis = [
      modeli(d.modele),
      d.wspolne > 0 ? `${d.wspolne} we wspólnej puli` : '',
      d.bezDanych ? `${d.bezDanych} bez danych` : '',
      d.klucze > 1 ? `${d.klucze} klucze` : '',
    ].filter(Boolean).join(', ');
    return `
      <li><button type="button" class="zk-dost" data-p="${esc(d.platforma)}" aria-pressed="${wybrany}">
        <span class="zk-dost-nazwa">${esc(d.platforma)}</span>
        <span class="zk-dost-liczba">${d.dzien != null ? `${liczba(null, d.dzien, d.rodzaj)}<small> tok./dzień</small>` : '<small>limit nieopublikowany</small>'}</span>
        <span class="zk-dost-pasek" aria-hidden="true">${d.dzien != null ? `<i class="${d.rodzaj}" style="width:${szer(d.dzien).toFixed(1)}%"></i>` : ''}</span>
        <span class="zk-pod">${d.dzien != null ? `${liczba(null, d.dzien * DNI, d.rodzaj)} / mies., ` : ''}${esc(opis)}</span>
      </button></li>`;
  }

  function listaDostawcow(el, dane, wybrany) {
    const szer = skala(Math.max(...dane.dostawcy.map((d) => d.dzien ?? 0)));
    el.querySelector('.zk-dostawcy').innerHTML = dane.dostawcy.map((d) => dostawca(d, szer, d.platforma === wybrany)).join('');
  }

  function wiersz(w, i, szer) {
    const limity = w.limity.length
      ? w.limity.map((l) => `<span class="${l.ofic ? 'zk-ofic' : 'zk-nieof'}">${esc(l.txt)}</span>`).join('<br>')
      : '<span class="zk-szary">—</span>';
    const zrodlo = w.zrodlo.url
      ? `<a href="${esc(w.zrodlo.url)}" target="_blank" rel="noopener">${esc(w.zrodlo.txt)}</a>`
      : esc(w.zrodlo.txt);
    const zrodloSzac = w.szacunek ? `<div class="zk-pod zk-nieof">szacunek: ${esc(w.szacunek.zrodlo.txt)}</div>` : '';
    const tytul = w.zrodlo.tytul ? ` title="${esc(w.zrodlo.tytul)}"` : '';
    const pasek = w.dzien != null
      ? `<div class="zk-pasek" aria-hidden="true"><i class="${rodzaj(w)}" style="width:${szer(w.dzien).toFixed(1)}%"></i></div>`
      : '';
    const stary = (v) => (w.szacunek ? `<div class="zk-pod zk-nieof" title="Szacunek sprzed nauki">szac. ~${fmt(v)}</div>` : '');
    const pula = w.puli > 1 ? `<div class="zk-pod">pula wspólna dla ${w.puli} modeli ${esc(w.platforma)}</div>` : '';
    return `
      <tr>
        <td class="zk-n zk-szary">${i + 1}</td>
        <td>
          <div class="zk-nazwa">${esc(w.nazwa)} <span class="zk-rank" title="Ranking inteligencji FreeLLMAPI (mniej = mądrzejszy)">#${w.rank ?? '?'}</span></div>
          <div class="zk-pod">${esc(w.platforma)} · ${esc(w.modelId)}</div>
        </td>
        <td class="zk-n zk-dzien">${liczba(w, w.dzien)}${pasek}${stary(w.szacunek?.dzien)}</td>
        <td class="zk-n">${liczba(w, w.miesiac)}${stary(w.szacunek?.dzien * DNI)}${pula}</td>
        <td class="zk-lim">${limity}</td>
        <td class="zk-zrodlo ${w.oficjalne ? '' : `zk-zrodlo-${rodzaj(w)}`}"${tytul}>${zrodlo}${zrodloSzac}</td>
      </tr>`;
  }

  function tabela(el, dane, szukaj, wybrany) {
    const q = szukaj.trim().toLowerCase();
    const widoczne = dane.wiersze.filter((w) => (!wybrany || w.platforma === wybrany)
      && (!q || `${w.nazwa} ${w.platforma} ${w.modelId}`.toLowerCase().includes(q)));
    const szer = skala(Math.max(...dane.wiersze.map((w) => w.dzien ?? 0)));
    // Numeracja = miejsce w rankingu calej listy, takze przy filtrze.
    const miejsce = new Map(dane.wiersze.map((w, i) => [w, i]));
    el.querySelector('tbody').innerHTML = widoczne.length
      ? widoczne.map((w) => wiersz(w, miejsce.get(w), szer)).join('')
      : `<tr><td colspan="6" class="zk-pusto">Żaden model${wybrany ? ` ${esc(wybrany)}` : ''} nie pasuje do „${esc(szukaj)}”.</td></tr>`;
    el.querySelector('.zk-ile').textContent = q || wybrany ? `${widoczne.length} z ${dane.wiersze.length} modeli` : `${dane.wiersze.length} modeli`;
  }

  async function zkBudzet(el) {
    el.innerHTML = `
      <div class="zk-glowa">
        <h1 class="text-2xl font-semibold tracking-tight">Budżet</h1>
        <p class="text-sm text-muted-foreground mt-1">Ile tokenów dziennie i miesięcznie daje każdy dostawca, u którego masz klucz, a niżej każdy model, od najmądrzejszego. Zwykłe liczby publikuje dostawca, pomarańczowe z tyldą to szacunki, żółte to realne limity nauczone z błędów 429.</p>
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

    const linki = Object.entries(dane.cfg.oficjalne ?? {})
      .map(([p, o]) => `<a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(p)}</a>`)
      .join(', ');
    const razem = dane.dostawcy.reduce((s, d) => s + (d.dzien ?? 0), 0);
    const razemRodzaj = dane.dostawcy.every((d) => d.rodzaj === 'ofic') ? 'ofic' : 'nieof';
    el.lastElementChild.outerHTML = `
      <section class="zk-sekcja" aria-labelledby="zk-dost-tytul">
        <h2 id="zk-dost-tytul" class="zk-h2">Dostawcy <span class="zk-pod">razem ${liczba(null, razem, razemRodzaj)} tok./dzień, kliknij dostawcę, żeby zawęzić listę modeli</span></h2>
        <ul class="zk-dostawcy"></ul>
      </section>
      <h2 class="zk-h2">Modele</h2>
      <div class="zk-pasek-narzedzi">
        <input class="zk-szukaj" type="search" placeholder="Szukaj modelu albo dostawcy" aria-label="Szukaj modelu albo dostawcy" autocomplete="off" spellcheck="false">
        <span class="zk-ile zk-szary"></span>
        <div class="zk-legenda">
          <span><i class="zk-wzor ofic"></i>oficjalne, z dokumentacji: ${linki || 'brak'}</span>
          <span><i class="zk-wzor nieof"></i><span class="zk-nieof">szacunek</span>, źródło w ostatniej kolumnie</span>
          <span><i class="zk-wzor nauk"></i><span class="zk-nauk">szacunek realny</span>, nauczony z Twoich błędów limitu (429)</span>
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
    let wybrany = null;
    const odswiez = () => { listaDostawcow(el, dane, wybrany); tabela(el, dane, pole.value, wybrany); };
    pole.addEventListener('input', () => tabela(el, dane, pole.value, wybrany));
    el.querySelector('.zk-dostawcy').addEventListener('click', (e) => {
      const b = e.target.closest('.zk-dost');
      if (!b) return;
      wybrany = wybrany === b.dataset.p ? null : b.dataset.p;
      odswiez();
      el.querySelector(`.zk-dost[data-p="${CSS.escape(b.dataset.p)}"]`).focus();
    });
    odswiez();
  }

  window.zkBudzet = zkBudzet;
})();
