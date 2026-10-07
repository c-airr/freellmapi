// Zakladka "Lancuchy" (/lancuchy) — rysowana przez link.js wewnatrz panelu
// FreeLLMAPI (window.zkKreator). Nazwa + zaznaczone modele -> profil FreeLLMAPI.
// Klient wybiera lancuch przez "model": "auto:<nazwa>".
// API (to samo, z ktorego korzysta panel):
//   POST   /api/profiles               {name, emoji, empty:true} -> nowy, pusty
//   PUT    /api/profiles/:id           {name}                    -> zmiana nazwy
//   PUT    /api/profiles/:id/reorder   [{modelDbId, priority, enabled}]
//   GET    /api/profiles/:id/models    -> obecny sklad
//   DELETE /api/profiles/:id
// Funkcje api/fmt/esc/modeli/bladNazwy/mojeModele/limitOpis/kopiuj: wspolne.js.

let app = null; // kontener strony, ustawia zkKreator()
// Panel potrafi przerysowac strone tuz po wejsciu, wiec zkKreator bywa wolany
// dwa razy. Starsze uruchomienie (i starsze wczytanie lancucha) po kazdym
// await sprawdza, czy jest jeszcze aktualne — inaczej podpieloby drugi raz
// te same zdarzenia i lista modeli by sie dublowala.
let przebieg = 0;
let wczytanie = 0;

const stan = {
  cfg: null,
  modele: [],
  profile: [],
  edytowany: null, // profil custom albo null = nowy
  zaznaczone: new Map(), // id modelu -> kolejnosc zaznaczenia
  licznik: 0,
  zachowane: [], // modele z edytowanego lancucha, ktorych nie ma na liscie (brak klucza)
  filtr: 'wszystkie',
  szukaj: '',
  kolejnosc: 'rank', // 'rank' | 'klik'
  apiKey: null, // klucz /v1 z /api/settings/api-key (null = nie udalo sie pobrac)
  pokazKlucz: false,
  aktywny: null, // id lancucha, ktory obsluguje zwykle "auto"
  wSkladzie: new Set(), // modele z listy, ktore edytowany lancuch juz ma (wlaczone i wylaczone)
};

/** Wbudowany lancuch (Default): serwer nie pozwala zmienic mu nazwy ani go usunac. */
function wbudowany(p) {
  return !!p && (p.type === 'default' || p.type === 'builtin');
}

/** Wszystkie lancuchy do edycji: wbudowane na gorze, potem wlasne. */
function lancuchy() {
  return stan.profile.slice().sort((a, b) => Number(wbudowany(b)) - Number(wbudowany(a)));
}

/** Adres proxy OpenAI-kompatybilnego — ten sam host, z ktorego otwarto panel. */
function baseUrl() {
  return `${location.origin}/v1`;
}

function maska(klucz) {
  if (!klucz) return '';
  return klucz.length > 12 ? `${klucz.slice(0, 6)}…${klucz.slice(-4)}` : '••••';
}

/** Przyklady uzycia; `klucz` = co wstawic jako klucz (prawdziwy albo maska). */
function przyklady(nazwa, klucz) {
  const model = `auto:${nazwa}`;
  return {
    curl: `curl ${baseUrl()}/chat/completions \\
  -H "Authorization: Bearer ${klucz}" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${model}", "messages": [{"role": "user", "content": "Cześć!"}]}'`,
    python: `from openai import OpenAI

client = OpenAI(base_url="${baseUrl()}", api_key="${klucz}")
odp = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Cześć!"}],
)
print(odp.choices[0].message.content)`,
  };
}

/** Ramka "Jak uzyc" dla nazwy z pola (zapisanej albo dopiero wpisywanej). */
function renderEndpoint() {
  const box = document.getElementById('endpoint');
  const nazwa = document.getElementById('nazwa').value.trim();
  if (bladNazwy(nazwa)) {
    box.innerHTML = '<p class="muted">Wpisz nazwę łańcucha — tu pojawi się endpoint i gotowe przykłady do wklejenia.</p>';
    return;
  }
  const zapisany = stan.edytowany && stan.edytowany.name === nazwa;
  const klucz = stan.apiKey ?? 'TWOJ_KLUCZ_API';
  const widoczny = stan.apiKey && !stan.pokazKlucz ? maska(stan.apiKey) : klucz;
  const pokaz = przyklady(nazwa, widoczny);
  const pole = (etykieta, wartosc, doSchowka, extra = '') => `
    <div class="ep-wiersz">
      <span class="ep-etykieta">${etykieta}</span>
      <code class="ep-wartosc">${esc(wartosc)}</code>
      ${extra}
      <button class="chip" type="button" data-kopiuj="${esc(doSchowka)}">Kopiuj</button>
    </div>`;
  box.innerHTML = `
    <h2>Jak użyć ${zapisany ? '' : '<span class="muted">(po zapisaniu łańcucha)</span>'}</h2>
    ${pole('Endpoint (base URL)', baseUrl(), baseUrl())}
    ${pole('Model', `auto:${nazwa}`, `auto:${nazwa}`)}
    ${stan.apiKey
      ? pole('Klucz API', widoczny, stan.apiKey, `<button class="chip" type="button" id="pokaz-klucz">${stan.pokazKlucz ? 'Ukryj' : 'Pokaż'}</button>`)
      : '<div class="ep-wiersz"><span class="ep-etykieta">Klucz API</span><span class="muted">nie udało się pobrać — skopiuj go z panelu FreeLLMAPI</span></div>'}
    <p class="muted ep-opis">Działa z każdym programem, który obsługuje API OpenAI: wpisujesz endpoint, klucz i jako model <code>auto:${esc(nazwa)}</code>. FreeLLMAPI próbuje modele po kolei, aż któryś odpowie.</p>
    <div class="ep-przyklady">
      <div>
        <div class="ep-naglowek"><b>curl</b><button class="chip" type="button" data-kopiuj-przyklad="curl">Kopiuj</button></div>
        <pre>${esc(pokaz.curl)}</pre>
      </div>
      <div>
        <div class="ep-naglowek"><b>Python (openai)</b><button class="chip" type="button" data-kopiuj-przyklad="python">Kopiuj</button></div>
        <pre>${esc(pokaz.python)}</pre>
      </div>
    </div>`;
}

async function obsluzKlikEndpointu(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.id === 'pokaz-klucz') {
    stan.pokazKlucz = !stan.pokazKlucz;
    renderEndpoint();
    return;
  }
  let tekst = btn.dataset.kopiuj;
  if (btn.dataset.kopiujPrzyklad) {
    // Do schowka zawsze idzie prawdziwy klucz, nawet gdy na ekranie jest maska.
    const nazwa = document.getElementById('nazwa').value.trim();
    tekst = przyklady(nazwa, stan.apiKey ?? 'TWOJ_KLUCZ_API')[btn.dataset.kopiujPrzyklad];
  }
  if (tekst == null) return;
  const ok = await kopiuj(tekst);
  const stary = btn.textContent;
  btn.textContent = ok ? 'Skopiowano' : 'Nie da się — zaznacz ręcznie';
  setTimeout(() => { btn.textContent = stary; }, 1500);
}

function zaznacz(id, on) {
  if (on && !stan.zaznaczone.has(id)) stan.zaznaczone.set(id, ++stan.licznik);
  if (!on) stan.zaznaczone.delete(id);
}

function widoczne() {
  const q = stan.szukaj.trim().toLowerCase();
  return stan.modele.filter((m) => {
    if (stan.filtr === 'dobre' && m.kat !== 'dobre') return false;
    if (stan.filtr === 'stolcowe' && m.kat !== 'stolcowe') return false;
    if (stan.filtr === 'zaznaczone' && !stan.zaznaczone.has(m.id)) return false;
    if (!q) return true;
    return `${m.displayName} ${m.platform} ${m.modelId}`.toLowerCase().includes(q);
  });
}

/** Wybrane modele w kolejnosci, w jakiej pojda do lancucha. */
function wybraneWKolejnosci() {
  const wybrane = stan.modele.filter((m) => stan.zaznaczone.has(m.id));
  return stan.kolejnosc === 'klik'
    ? wybrane.sort((a, b) => stan.zaznaczone.get(a.id) - stan.zaznaczone.get(b.id))
    : wybrane.sort((a, b) => (a.intelligenceRank ?? 999) - (b.intelligenceRank ?? 999));
}

function renderLista() {
  const lista = widoczne();
  const tbody = document.getElementById('lista');
  tbody.innerHTML = lista.map((m) => `
    <tr data-id="${m.id}" class="${stan.zaznaczone.has(m.id) ? 'wybrany' : ''}">
      <td class="cb"><input type="checkbox" data-id="${m.id}" ${stan.zaznaczone.has(m.id) ? 'checked' : ''} aria-label="Wybierz ${esc(m.displayName || m.modelId)}"></td>
      <td>${esc(m.displayName || m.modelId)}<span class="rank">#${m.intelligenceRank ?? '?'}</span><div class="id">${esc(m.platform)} · ${esc(m.modelId)}</div></td>
      <td><span class="znaczek ${m.kat}">${m.kat === 'dobre' ? 'dobre' : 'stolcowe'}</span></td>
      <td class="n">${esc(limitOpis(m))}</td>
      <td class="n">${m.contextWindow ? fmt(m.contextWindow) : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="muted">Nic nie pasuje do filtra.</td></tr>';
  document.getElementById('ile-widocznych').textContent = `${modeli(lista.length)} na liście`;
  renderPasek();
}

function renderPasek() {
  const wybrane = wybraneWKolejnosci();
  document.getElementById('ile-wybranych').textContent = wybrane.length
    ? `Zaznaczono ${modeli(wybrane.length)}`
    : 'Nic nie zaznaczono';
  const podglad = wybrane.slice(0, 6).map((m, i) => `${i + 1}. ${esc(m.displayName || m.modelId)}`).join(' · ');
  document.getElementById('podglad').innerHTML = wybrane.length
    ? `${podglad}${wybrane.length > 6 ? ` · … +${wybrane.length - 6}` : ''}`
    : '<span class="muted">Zaznacz modele na liście — pierwszy w kolejności jest próbowany jako pierwszy.</span>';
  for (const el of document.querySelectorAll('.chip[data-filtr]')) el.classList.toggle('on', el.dataset.filtr === stan.filtr);
}

function ustawStatus(txt, blad = false) {
  const el = document.getElementById('status');
  el.textContent = txt;
  el.classList.toggle('blad', blad);
}

async function wczytajLancuch(id) {
  const nr = ++wczytanie;
  stan.zaznaczone.clear();
  stan.licznik = 0;
  stan.zachowane = [];
  stan.wSkladzie = new Set();
  stan.edytowany = id ? stan.profile.find((p) => p.id === id) ?? null : null;
  const pole = document.getElementById('nazwa');
  pole.value = stan.edytowany?.name ?? '';
  pole.disabled = wbudowany(stan.edytowany);
  document.getElementById('nazwa-uwaga').textContent = wbudowany(stan.edytowany)
    ? 'Wbudowanemu łańcuchowi nie da się zmienić nazwy ani go usunąć. Skład i kolejność zmieniasz normalnie.'
    : '';
  document.getElementById('usun').hidden = !stan.edytowany || wbudowany(stan.edytowany);
  if (stan.edytowany) {
    const sklad = await api(`/api/profiles/${stan.edytowany.id}/models`);
    if (nr !== wczytanie) return; // w miedzyczasie wybrano inny lancuch
    const znane = new Set(stan.modele.map((m) => m.id));
    for (const r of sklad) {
      if (!znane.has(r.model_db_id)) {
        stan.zachowane.push(r);
        continue;
      }
      stan.wSkladzie.add(r.model_db_id);
      // Wylaczony w lancuchu (np. suwakiem na stronie Models) = odznaczony.
      if (r.enabled) zaznacz(r.model_db_id, true);
    }
    // Edycja: domyslnie zostawiamy kolejnosc, ktora lancuch juz ma.
    stan.kolejnosc = 'klik';
  } else {
    stan.kolejnosc = 'rank';
  }
  document.querySelector(`input[name="kolejnosc"][value="${stan.kolejnosc}"]`).checked = true;
  document.getElementById('zachowane').textContent = stan.zachowane.length
    ? `${modeli(stan.zachowane.length)} z tego łańcucha nie ma teraz aktywnego klucza — zostaną na końcu łańcucha.`
    : '';
  ustawStatus('');
  renderLista();
  renderEndpoint();
}

function renderWybor() {
  const sel = document.getElementById('lancuch');
  const dopisek = (p) => [wbudowany(p) ? 'wbudowany' : '', p.id === stan.aktywny ? 'zwykłe auto' : ''].filter(Boolean).join(', ');
  sel.innerHTML = '<option value="">+ Nowy łańcuch</option>'
    + lancuchy().map((p) => `<option value="${p.id}">${esc(p.emoji ? `${p.emoji} ` : '')}${esc(p.name)}${dopisek(p) ? ` (${dopisek(p)})` : ''}</option>`).join('');
  sel.value = stan.edytowany ? String(stan.edytowany.id) : '';
}

async function zapisz() {
  const staly = wbudowany(stan.edytowany);
  const nazwa = staly ? stan.edytowany.name : document.getElementById('nazwa').value.trim();
  const blad = staly ? null : bladNazwy(nazwa);
  if (blad) return ustawStatus(blad, true);
  const wybrane = wybraneWKolejnosci();
  if (!wybrane.length) return ustawStatus('Zaznacz przynajmniej jeden model.', true);
  const kolizja = staly ? null : stan.profile.find((p) => p.name.toLowerCase() === nazwa.toLowerCase() && p.id !== stan.edytowany?.id);
  if (kolizja) {
    return ustawStatus(kolizja.type === 'custom'
      ? `Łańcuch „${kolizja.name}” już istnieje — wybierz go z listy u góry, żeby go edytować.`
      : `„${kolizja.name}” to wbudowany profil FreeLLMAPI — wybierz inną nazwę.`, true);
  }

  const btn = document.getElementById('zapisz');
  btn.disabled = true;
  ustawStatus('Zapisuję…');
  try {
    let profil = stan.edytowany;
    if (!profil) {
      profil = await api('/api/profiles', { method: 'POST', body: JSON.stringify({ name: nazwa, emoji: '🔗', empty: true }) });
    } else if (profil.name !== nazwa) {
      await api(`/api/profiles/${profil.id}`, { method: 'PUT', body: JSON.stringify({ name: nazwa }) });
    }
    // Odznaczony model, ktory lancuch juz mial, zostaje w nim jako wylaczony —
    // tak jak suwak na stronie Models — zamiast znikac z lancucha.
    const wybraneId = new Set(wybrane.map((m) => m.id));
    const wylaczone = stan.modele.filter((m) => stan.wSkladzie.has(m.id) && !wybraneId.has(m.id));
    const sklad = [
      ...wybrane.map((m) => ({ modelDbId: m.id, enabled: true })),
      ...wylaczone.map((m) => ({ modelDbId: m.id, enabled: false })),
      ...stan.zachowane.map((r) => ({ modelDbId: r.model_db_id, enabled: !!r.enabled })),
    ].map((e, i) => ({ ...e, priority: i + 1 }));
    await api(`/api/profiles/${profil.id}/reorder`, { method: 'PUT', body: JSON.stringify(sklad) });

    stan.profile = await api('/api/profiles');
    stan.edytowany = stan.profile.find((p) => p.id === profil.id) ?? null;
    for (const m of wybrane) stan.wSkladzie.add(m.id);
    renderWybor();
    document.getElementById('usun').hidden = wbudowany(stan.edytowany);
    ustawStatus(`Zapisano „${nazwa}”. Włączone: ${wybrane.length}${wylaczone.length ? `, wyłączone: ${wylaczone.length}` : ''}. Endpoint i przykłady są w ramce „Jak użyć” u góry.`);
    renderEndpoint();
  } catch (err) {
    ustawStatus(`Błąd: ${err.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

async function usun() {
  const p = stan.edytowany;
  if (!p || !confirm(`Usunąć łańcuch „${p.name}”? Klienci używający "auto:${p.name}" dostaną błąd.`)) return;
  try {
    await api(`/api/profiles/${p.id}`, { method: 'DELETE' });
    stan.profile = await api('/api/profiles');
    stan.edytowany = null;
    renderWybor();
    await wczytajLancuch(null);
    ustawStatus(`Usunięto „${p.name}”.`);
  } catch (err) {
    ustawStatus(`Błąd: ${err.message}`, true);
  }
}

async function main(moj) {
  const nieaktualny = () => moj !== przebieg || !app.isConnected;
  app.innerHTML = `
    <div class="zk-glowa">
      <h1 class="text-2xl font-semibold tracking-tight">Łańcuchy</h1>
      <p class="text-sm text-muted-foreground mt-1">Złóż łańcuch z wybranych modeli. Program wywołuje go jako <code>auto:nazwa</code>, a FreeLLMAPI próbuje modele po kolei, aż któryś odpowie.</p>
    </div>
    <p class="muted">Ładuję…</p>`;
  try {
    stan.cfg = await fetch('/budzet/config.json', { cache: 'no-cache' }).then((r) => r.json());
    [stan.modele, stan.profile, stan.aktywny] = await Promise.all([
      mojeModele(stan.cfg),
      api('/api/profiles'),
      api('/api/profiles/active').then((r) => r.activeProfileId ?? null).catch(() => null),
    ]);
  } catch (err) {
    if (nieaktualny()) return;
    app.lastElementChild.outerHTML = err.auth
      ? '<p class="muted">Sesja wygasła. Zaloguj się w panelu i wróć na tę zakładkę.</p>'
      : `<p class="blad">Nie udało się pobrać danych: ${esc(err.message)}</p>`;
    return;
  }
  stan.modele.sort((a, b) => (a.intelligenceRank ?? 999) - (b.intelligenceRank ?? 999));
  // Klucz do /v1 tylko do ramki "Jak uzyc" — bez niego kreator dziala dalej.
  stan.apiKey = await api('/api/settings/api-key').then((r) => r.apiKey ?? null).catch(() => null);

  if (nieaktualny()) return;
  app.lastElementChild.outerHTML = `
    <div class="kreator-gora">
      <label><span>Łańcuch</span>
        <select id="lancuch"></select>
      </label>
      <label><span>Nazwa — w kliencie <code>"model": "auto:nazwa"</code></span>
        <input id="nazwa" type="text" maxlength="20" placeholder="np. kod-szybki" autocomplete="off" spellcheck="false">
      </label>
      <p class="muted" id="nazwa-uwaga"></p>
      <p class="muted" id="zachowane"></p>
    </div>
    <div class="pula endpoint" id="endpoint"></div>
    <div class="filtry">
      <input id="szukaj" type="search" placeholder="Szukaj modelu…" autocomplete="off">
      <button class="chip" data-filtr="wszystkie" type="button">Wszystkie</button>
      <button class="chip" data-filtr="dobre" type="button">Dobre</button>
      <button class="chip" data-filtr="stolcowe" type="button">Stolcowe</button>
      <button class="chip" data-filtr="zaznaczone" type="button">Zaznaczone</button>
      <span class="muted" id="ile-widocznych"></span>
      <span class="odstep"></span>
      <button class="chip" id="zaznacz-widoczne" type="button">Zaznacz widoczne</button>
      <button class="chip" id="odznacz-widoczne" type="button">Odznacz widoczne</button>
    </div>
    <div class="pula">
      <table class="modele">
        <thead><tr><th class="cb"></th><th>Model</th><th>Kategoria</th><th class="n">Limit (twardy)</th><th class="n">Kontekst</th></tr></thead>
        <tbody id="lista"></tbody>
      </table>
    </div>
    <div class="pasek-dolny">
      <div class="pasek-dolny-tresc">
        <div>
          <b id="ile-wybranych"></b>
          <div class="podglad" id="podglad"></div>
        </div>
        <div class="kolejnosc">
          <label><input type="radio" name="kolejnosc" value="rank"> od najmądrzejszego</label>
          <label><input type="radio" name="kolejnosc" value="klik"> w kolejności zaznaczania</label>
        </div>
        <div class="przyciski">
          <button id="usun" class="drugi" type="button" hidden>Usuń łańcuch</button>
          <button id="zapisz" type="button">Zapisz łańcuch</button>
        </div>
      </div>
      <div id="status" class="muted"></div>
    </div>`;

  renderWybor();
  document.getElementById('lancuch').addEventListener('change', (e) => void wczytajLancuch(e.target.value ? Number(e.target.value) : null));
  document.getElementById('szukaj').addEventListener('input', (e) => { stan.szukaj = e.target.value; renderLista(); });
  for (const el of document.querySelectorAll('.chip[data-filtr]')) {
    el.addEventListener('click', () => { stan.filtr = el.dataset.filtr; renderLista(); });
  }
  document.getElementById('zaznacz-widoczne').addEventListener('click', () => { for (const m of widoczne()) zaznacz(m.id, true); renderLista(); });
  document.getElementById('odznacz-widoczne').addEventListener('click', () => { for (const m of widoczne()) zaznacz(m.id, false); renderLista(); });
  for (const r of document.querySelectorAll('input[name="kolejnosc"]')) {
    r.addEventListener('change', () => { stan.kolejnosc = r.value; renderPasek(); });
  }
  // Klik w checkbox albo w dowolne miejsce wiersza przelacza model.
  document.getElementById('lista').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = Number(tr.dataset.id);
    zaznacz(id, !stan.zaznaczone.has(id));
    if (stan.filtr === 'zaznaczone') return renderLista();
    tr.classList.toggle('wybrany', stan.zaznaczone.has(id));
    tr.querySelector('input').checked = stan.zaznaczone.has(id);
    renderPasek();
  });
  document.getElementById('nazwa').addEventListener('input', renderEndpoint);
  document.getElementById('endpoint').addEventListener('click', (e) => void obsluzKlikEndpointu(e));
  document.getElementById('zapisz').addEventListener('click', () => void zapisz());
  document.getElementById('usun').addEventListener('click', () => void usun());

  // ?lancuch=<id> otwiera od razu edycje.
  const z = new URLSearchParams(location.search).get('lancuch');
  await wczytajLancuch(z ? Number(z) : null);
}

window.zkKreator = (kontener) => {
  app = kontener;
  return main(++przebieg);
};
