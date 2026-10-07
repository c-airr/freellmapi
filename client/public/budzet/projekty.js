// Zakladka "Projekty" (/projekty) — rysowana przez link.js wewnatrz panelu.
// Projekt = lancuchy, z ktorych korzysta jeden program (np. bot Discorda albo
// automatyzacje). Pokazuje, ile ciagnie caly projekt, kazdy jego lancuch
// i ktore modele faktycznie odpowiadaly.
//
// API (serwer, routes/projects.ts):
//   GET    /api/projects               -> [{id, name, chains:[{profileId, name, emoji}]}]
//   POST   /api/projects               {name, profileIds}
//   PATCH  /api/projects/:id           {name?, profileIds?}
//   DELETE /api/projects/:id
//   GET    /api/projects/usage?range=  -> {since, chains:[{profileId, requests, ..., models:[...]}]}
// Funkcje api/fmt/esc/modeli: wspolne.js.
(function () {
  const ZAKRESY = [
    { id: '24h', tekst: '24 h' },
    { id: '7d', tekst: '7 dni' },
    { id: '30d', tekst: '30 dni' },
  ];
  const ZAKRES_KEY = 'zk-projekty-zakres';

  let el = null;
  const stan = {
    zakres: '7d',
    profile: [], // wszystkie lancuchy (profile FreeLLMAPI)
    projekty: [],
    uzycie: null, // odpowiedz /api/projects/usage
    edytor: null, // null | { id: number|null, nazwa: string, wybrane: Set<number> }
    rozwiniete: new Set(), // "projekt:lancuch" z rozwinieta lista modeli
  };
  try {
    const z = localStorage.getItem(ZAKRES_KEY);
    if (ZAKRESY.some((x) => x.id === z)) stan.zakres = z;
  } catch { /* zostaje 7 dni */ }

  // ---------- pomocnicze ----------

  function lancuchy(n) {
    const d = n % 10;
    const s = n % 100;
    if (n === 1) return '1 łańcuch';
    if (d >= 2 && d <= 4 && !(s >= 12 && s <= 14)) return `${n} łańcuchy`;
    return `${n} łańcuchów`;
  }

  function kiedy(iso) {
    if (!iso) return '—';
    const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (min < 1) return 'przed chwilą';
    if (min < 60) return `${min} min temu`;
    const h = Math.round(min / 60);
    if (h < 48) return `${h} h temu`;
    return `${Math.round(h / 24)} dni temu`;
  }

  function skutecznosc(c) {
    const razem = c.success + c.errors;
    return razem ? `${Math.round((c.success / razem) * 100)}%` : '—';
  }

  function nazwaLancucha(c) {
    return `${c.emoji ? `${esc(c.emoji)} ` : ''}${esc(c.name)}`;
  }

  /** Statystyki lancucha z /usage; zero, gdy w zakresie nie bylo ruchu. */
  function uzycieLancucha(profileId) {
    return stan.uzycie?.chains.find((c) => c.profileId === profileId)
      ?? { profileId, requests: 0, success: 0, errors: 0, inputTokens: 0, outputTokens: 0, lastSeenAt: null, models: [] };
  }

  function suma(lista) {
    return lista.reduce((s, c) => ({
      requests: s.requests + c.requests,
      success: s.success + c.success,
      errors: s.errors + c.errors,
      tokeny: s.tokeny + c.inputTokens + c.outputTokens,
    }), { requests: 0, success: 0, errors: 0, tokeny: 0 });
  }

  // ---------- render ----------

  function wierszeModeli(c, kluczRozwiniecia) {
    if (!stan.rozwiniete.has(kluczRozwiniecia)) return '';
    const tokenyLancucha = c.inputTokens + c.outputTokens;
    const wiersze = c.models.map((m) => {
      const tok = m.inputTokens + m.outputTokens;
      const udzial = tokenyLancucha ? (tok / tokenyLancucha) * 100 : 0;
      return `
        <tr class="pj-model">
          <td><div class="zk-nazwa">${esc(m.displayName)}</div><div class="zk-pod">${esc(m.platform)} · ${esc(m.modelId)}</div></td>
          <td class="zk-n">${fmt(m.requests)}</td>
          <td class="zk-n">${fmt(m.inputTokens)} / ${fmt(m.outputTokens)}</td>
          <td><div class="pj-udzial"><div class="zk-pasek"><i class="ofic" style="width:${udzial.toFixed(1)}%"></i></div><span>${Math.round(udzial)}%</span></div></td>
          <td></td>
        </tr>`;
    }).join('');
    return wiersze || '<tr class="pj-model"><td colspan="5" class="zk-szary">Ten łańcuch nie obsłużył w tym zakresie żadnego zapytania.</td></tr>';
  }

  /** Tabela lancuchow; `wlasciciel` = id projektu albo "bez" (klucz rozwiniecia). */
  function tabela(lista, wlasciciel) {
    const tokenyRazem = lista.reduce((s, c) => s + c.inputTokens + c.outputTokens, 0);
    const wiersze = lista.map((c) => {
      const tok = c.inputTokens + c.outputTokens;
      const udzial = tokenyRazem ? (tok / tokenyRazem) * 100 : 0;
      const klucz = `${wlasciciel}:${c.profileId}`;
      const otwarte = stan.rozwiniete.has(klucz);
      return `
        <tr class="${c.requests ? '' : 'pj-cichy'}">
          <td>
            <button class="pj-rozwin" type="button" data-rozwin="${esc(klucz)}" aria-expanded="${otwarte}">
              <span class="pj-strzalka" aria-hidden="true"></span>
              <span class="zk-nazwa">${nazwaLancucha(c)}${c.deleted ? ' <span class="zk-szary">(usunięty)</span>' : ''}</span>
            </button>
            <div class="zk-pod pj-wcieta"><code>auto:${esc(c.name)}</code> · ${c.models.length ? modeli(c.models.length) : 'bez ruchu'}</div>
          </td>
          <td class="zk-n">${fmt(c.requests)}${c.requests ? `<div class="zk-pod">${skutecznosc(c)} udanych</div>` : ''}</td>
          <td class="zk-n">${fmt(c.inputTokens)} / ${fmt(c.outputTokens)}</td>
          <td><div class="pj-udzial"><div class="zk-pasek"><i class="ofic" style="width:${udzial.toFixed(1)}%"></i></div><span>${Math.round(udzial)}%</span></div></td>
          <td class="zk-n zk-szary">${kiedy(c.lastSeenAt)}</td>
        </tr>${wierszeModeli(c, klucz)}`;
    }).join('');
    return `
      <div class="zk-tabela">
        <table class="pj-tabela">
          <thead><tr>
            <th>Łańcuch</th><th class="zk-n">Zapytania</th><th class="zk-n">Tokeny wej. / wyj.</th><th>Udział w tokenach</th><th class="zk-n">Ostatnio</th>
          </tr></thead>
          <tbody>${wiersze || '<tr><td colspan="5" class="zk-pusto">Brak łańcuchów.</td></tr>'}</tbody>
        </table>
      </div>`;
  }

  function kartaProjektu(p) {
    const lista = p.chains.map((ch) => ({ ...uzycieLancucha(ch.profileId), name: ch.name, emoji: ch.emoji, deleted: false }))
      .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens) || a.name.localeCompare(b.name));
    const s = suma(lista);
    return `
      <section class="pj-karta" aria-label="Projekt ${esc(p.name)}">
        <header class="pj-glowa">
          <div class="pj-tytul">
            <h2>${esc(p.name)}</h2>
            <div class="zk-pod">${lancuchy(p.chains.length)}</div>
          </div>
          <dl class="pj-liczby">
            <div><dt>Zapytania</dt><dd>${fmt(s.requests)}</dd></div>
            <div><dt>Tokeny</dt><dd>${fmt(s.tokeny)}</dd></div>
            <div><dt>Udane</dt><dd>${skutecznosc(s)}</dd></div>
          </dl>
          <button class="chip" type="button" data-edytuj="${p.id}">Edytuj</button>
        </header>
        ${p.chains.length ? tabela(lista, p.id) : '<p class="zk-szary pj-puste-lancuchy">Projekt nie ma jeszcze łańcuchów. Kliknij „Edytuj” i zaznacz, z których korzysta program.</p>'}
      </section>`;
  }

  function kartaBezProjektu() {
    const wProjektach = new Set(stan.projekty.flatMap((p) => p.chains.map((c) => c.profileId)));
    const lista = (stan.uzycie?.chains ?? []).filter((c) => !wProjektach.has(c.profileId));
    if (!lista.length) return '';
    return `
      <section class="pj-karta pj-bez" aria-label="Łańcuchy bez projektu">
        <header class="pj-glowa">
          <div class="pj-tytul">
            <h2>Bez projektu</h2>
            <div class="zk-pod">Łańcuchy, których nie przypisałeś do żadnego projektu. Zwykłe <code>auto</code> idzie przez aktywny łańcuch.</div>
          </div>
        </header>
        ${tabela(lista, 'bez')}
      </section>`;
  }

  function edytor() {
    const e = stan.edytor;
    if (!e) return '';
    const opcje = stan.profile.map((p) => `
      <label class="pj-opcja">
        <input type="checkbox" value="${p.id}" ${e.wybrane.has(p.id) ? 'checked' : ''}>
        <span><span class="zk-nazwa">${nazwaLancucha(p)}</span><span class="zk-pod"><code>auto:${esc(p.name)}</code>${p.type === 'default' ? ' · też zwykłe <code>auto</code>, gdy jest aktywny' : ''}</span></span>
      </label>`).join('');
    const bezLancuchow = stan.profile.every((p) => p.type === 'default');
    return `
      <section class="pj-edytor" aria-label="${e.id ? 'Edycja projektu' : 'Nowy projekt'}">
        <h2>${e.id ? `Edytuj „${esc(e.nazwaPoczatkowa)}”` : 'Nowy projekt'}</h2>
        <label class="pj-pole"><span>Nazwa</span>
          <input id="pj-nazwa" type="text" maxlength="100" placeholder="np. discord response" autocomplete="off" value="${esc(e.nazwa)}">
        </label>
        <fieldset class="pj-wybor">
          <legend>Łańcuchy, z których korzysta program</legend>
          <div class="pj-opcje">${opcje}</div>
          ${bezLancuchow ? '<p class="zk-pod">Masz tylko domyślny łańcuch. Własne złożysz w zakładce <a href="/lancuchy" data-idz="/lancuchy">Łańcuchy</a>.</p>' : ''}
        </fieldset>
        <div class="przyciski">
          ${e.id ? '<button id="pj-usun" class="drugi" type="button">Usuń projekt</button>' : ''}
          <span class="pj-odstep"></span>
          <button id="pj-anuluj" class="drugi pj-neutralny" type="button">Anuluj</button>
          <button id="pj-zapisz" type="button">${e.id ? 'Zapisz zmiany' : 'Utwórz projekt'}</button>
        </div>
        <p id="pj-status" class="zk-pod" role="status"></p>
      </section>`;
  }

  function render() {
    if (!el?.isConnected) return;
    const segment = ZAKRESY.map((z) => `<button type="button" class="${z.id === stan.zakres ? 'on' : ''}" data-zakres="${z.id}" aria-pressed="${z.id === stan.zakres}">${z.tekst}</button>`).join('');
    const karty = stan.projekty.map(kartaProjektu).join('');
    const pusto = !stan.projekty.length && !stan.edytor
      ? `<section class="pj-pusto">
           <h2>Nie masz jeszcze projektów</h2>
           <p>Utwórz projekt dla każdego programu, który korzysta z FreeLLMAPI, np. „discord response” z dwoma łańcuchami i „automatyzacje” z trzema. Zobaczysz, ile każdy z nich ciągnie.</p>
           <button class="pj-glowny" type="button" data-nowy>Nowy projekt</button>
         </section>`
      : '';
    el.querySelector('#pj-tresc').innerHTML = `
      <div class="zk-pasek-narzedzi">
        <div class="zk-segment" role="group" aria-label="Zakres czasu">${segment}</div>
        <span class="zk-szary zk-ile">${stan.uzycie ? `od ${new Date(stan.uzycie.since).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}` : ''}</span>
        <span class="pj-odstep"></span>
        ${stan.edytor ? '' : '<button class="pj-glowny" type="button" data-nowy>Nowy projekt</button>'}
      </div>
      ${edytor()}
      ${pusto}
      ${karty}
      ${kartaBezProjektu()}
      <p class="zk-pod zk-stopka">Liczą się zapytania z <code>auto:&lt;łańcuch&gt;</code> i zwykłe <code>auto</code> (przez aktywny łańcuch), zapisane od wdrożenia tej wersji. Starsze nie mają zapisanego łańcucha.
        Łańcuch przypisany do dwóch projektów liczy się w obu.</p>`;
    if (stan.edytor) el.querySelector('#pj-nazwa')?.focus({ preventScroll: true });
  }

  // ---------- akcje ----------

  async function wczytajUzycie() {
    stan.uzycie = await api(`/api/projects/usage?range=${stan.zakres}`);
  }

  async function wczytajWszystko() {
    const [profile, projekty] = await Promise.all([api('/api/profiles'), api('/api/projects'), wczytajUzycie()]);
    stan.profile = profile.slice().sort((a, b) => (a.type === 'default' ? -1 : b.type === 'default' ? 1 : 0) || (a.sortOrder ?? a.sort_order ?? 0) - (b.sortOrder ?? b.sort_order ?? 0));
    stan.projekty = projekty;
  }

  function otworzEdytor(projekt) {
    stan.edytor = projekt
      ? { id: projekt.id, nazwa: projekt.name, nazwaPoczatkowa: projekt.name, wybrane: new Set(projekt.chains.map((c) => c.profileId)) }
      : { id: null, nazwa: '', nazwaPoczatkowa: '', wybrane: new Set() };
    render();
    el.querySelector('.pj-edytor')?.scrollIntoView({ block: 'nearest' });
  }

  function status(txt, blad = false) {
    const s = el.querySelector('#pj-status');
    if (!s) return;
    s.textContent = txt;
    s.classList.toggle('zk-blad', blad);
  }

  async function zapisz() {
    const e = stan.edytor;
    e.nazwa = el.querySelector('#pj-nazwa').value.trim();
    if (!e.nazwa) return status('Wpisz nazwę projektu.', true);
    const body = JSON.stringify({ name: e.nazwa, profileIds: [...e.wybrane] });
    const btn = el.querySelector('#pj-zapisz');
    btn.disabled = true;
    status('Zapisuję…');
    try {
      if (e.id) await api(`/api/projects/${e.id}`, { method: 'PATCH', body });
      else await api('/api/projects', { method: 'POST', body });
      stan.projekty = await api('/api/projects');
      stan.edytor = null;
      render();
    } catch (err) {
      btn.disabled = false;
      status(/already exists/.test(err.message) ? `Projekt „${e.nazwa}” już istnieje. Wybierz inną nazwę.` : `Nie udało się zapisać: ${err.message}`, true);
    }
  }

  async function usun() {
    const e = stan.edytor;
    if (!e?.id || !confirm(`Usunąć projekt „${e.nazwaPoczatkowa}”? Łańcuchy i historia zapytań zostają.`)) return;
    try {
      await api(`/api/projects/${e.id}`, { method: 'DELETE' });
      stan.projekty = await api('/api/projects');
      stan.edytor = null;
      render();
    } catch (err) {
      status(`Nie udało się usunąć: ${err.message}`, true);
    }
  }

  async function zmienZakres(zakres) {
    if (zakres === stan.zakres) return;
    stan.zakres = zakres;
    try { localStorage.setItem(ZAKRES_KEY, zakres); } catch { /* tylko na te sesje */ }
    try {
      await wczytajUzycie();
      render();
    } catch (err) {
      el.querySelector('#pj-tresc').insertAdjacentHTML('afterbegin', `<p class="zk-blad">Nie udało się pobrać statystyk: ${esc(err.message)}</p>`);
    }
  }

  function obsluzKlik(ev) {
    const t = ev.target;
    const zakres = t.closest('[data-zakres]');
    if (zakres) return void zmienZakres(zakres.dataset.zakres);
    if (t.closest('[data-nowy]')) return otworzEdytor(null);
    const edytuj = t.closest('[data-edytuj]');
    if (edytuj) return otworzEdytor(stan.projekty.find((p) => p.id === Number(edytuj.dataset.edytuj)));
    const rozwin = t.closest('[data-rozwin]');
    if (rozwin) {
      const k = rozwin.dataset.rozwin;
      if (stan.rozwiniete.has(k)) stan.rozwiniete.delete(k);
      else stan.rozwiniete.add(k);
      return render();
    }
    const idz = t.closest('[data-idz]');
    if (idz) {
      ev.preventDefault();
      return window.zkIdzDo(idz.dataset.idz);
    }
    if (t.closest('#pj-zapisz')) return void zapisz();
    if (t.closest('#pj-usun')) return void usun();
    if (t.closest('#pj-anuluj')) {
      stan.edytor = null;
      return render();
    }
  }

  function obsluzZmiane(ev) {
    const cb = ev.target.closest('.pj-opcja input[type="checkbox"]');
    if (cb && stan.edytor) {
      const id = Number(cb.value);
      if (cb.checked) stan.edytor.wybrane.add(id);
      else stan.edytor.wybrane.delete(id);
    }
  }

  async function zkProjekty(kontener) {
    el = kontener;
    stan.edytor = null;
    el.innerHTML = `
      <div class="zk-glowa">
        <h1 class="text-2xl font-semibold tracking-tight">Projekty</h1>
        <p class="text-sm text-muted-foreground mt-1">Projekt zbiera łańcuchy, z których korzysta jeden program. Widzisz, ile ciągnie cały projekt, każdy jego łańcuch i które modele odpowiadały.</p>
      </div>
      <div id="pj-tresc"><p class="zk-szary">Ładuję…</p></div>`;
    el.addEventListener('click', obsluzKlik);
    el.addEventListener('change', obsluzZmiane);
    el.addEventListener('input', (ev) => {
      if (ev.target.id === 'pj-nazwa' && stan.edytor) stan.edytor.nazwa = ev.target.value;
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target.id === 'pj-nazwa') { ev.preventDefault(); void zapisz(); }
    });
    try {
      await wczytajWszystko();
    } catch (err) {
      if (!el.isConnected) return;
      el.querySelector('#pj-tresc').innerHTML = err.auth
        ? '<p class="zk-szary">Sesja wygasła. Zaloguj się w panelu i wróć na tę zakładkę.</p>'
        : `<p class="zk-blad">Nie udało się pobrać projektów: ${esc(err.message)}</p>`;
      return;
    }
    render();
  }

  window.zkProjekty = zkProjekty;
})();
