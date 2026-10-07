// Zakladka "Endpointy" (/endpointy) — rysowana przez link.js wewnatrz panelu.
// Lista tego, co FreeLLMAPI wystawia programom, z krotkim opisem po polsku.
// Zrodlo: /v1/openapi.json serwera (czytane na zywo, wiec nowe endpointy
// z aktualizacji pojawia sie same — z angielskim opisem, dopoki nie dopiszesz
// polskiego do OPISY). /mcp nie ma w specyfikacji, wiec jest dopisany recznie.
// Funkcje api/esc/kopiuj: wspolne.js.
(function () {
  // Klucz: "METODA sciezka" ze specyfikacji.
  const OPISY = {
    'POST /v1/chat/completions': 'Rozmowa z modelem w formacie OpenAI. Główny endpoint, z niego korzysta większość programów. Obsługuje strumieniowanie, narzędzia i obrazy.',
    'POST /v1/completions': 'Stary format OpenAI: sam tekst do dokończenia, bez listy wiadomości.',
    'POST /v1/embeddings': 'Zamienia tekst na wektory liczb (do wyszukiwania podobnych treści, RAG).',
    'POST /v1/images/generations': 'Generuje obrazy z opisu.',
    'POST /v1/videos/generations': 'Generuje wideo z opisu.',
    'POST /v1/audio/speech': 'Zamienia tekst na mowę (plik audio).',
    'POST /v1/audio/transcriptions': 'Zamienia nagranie na tekst (transkrypcja).',
    'POST /v1/responses': 'Nowszy format OpenAI (Responses API), używany m.in. przez Codex i nowe SDK.',
    'POST /v1/messages': 'Format Anthropic (Claude). Pozwala podpiąć Claude Code i inne programy pisane pod Claude.',
    'POST /v1/messages/count_tokens': 'Liczy tokeny wiadomości w formacie Anthropic, bez wysyłania jej do modelu.',
    'GET /v1/models': 'Lista dostępnych modeli i łańcuchów (auto, auto:nazwa). Programy pytają o nią przy starcie.',
    'GET /v1beta/models': 'Lista modeli w formacie Google Gemini.',
    'GET /v1beta/models/{model}': 'Szczegóły jednego modelu w formacie Gemini.',
    'POST /v1beta/models/{model}:generateContent': 'Rozmowa w natywnym formacie Gemini, dla programów pisanych pod API Google.',
    'POST /v1beta/models/{model}:streamGenerateContent': 'To samo co generateContent, ale odpowiedź spływa na bieżąco.',
    'POST /v1beta/models/{model}:countTokens': 'Szacuje liczbę tokenów w formacie Gemini.',
    'GET /api/tags': 'Lista modeli w formacie Ollama, żeby programy pod Ollamę widziały FreeLLMAPI jak lokalną Ollamę.',
    'POST /api/chat': 'Rozmowa w formacie Ollama.',
    'POST /api/generate': 'Stary format Ollama: sam tekst do dokończenia.',
    'POST /api/show': 'Szczegóły modelu w formacie Ollama.',
    'GET /api/version': 'Wersja „Ollamy” — programy sprawdzają nią, czy serwer żyje.',
    'POST /api/embed': 'Wektory (embeddingi) w formacie Ollama.',
    'POST /api/embeddings': 'Wektory w starszym formacie Ollama.',
    'GET /v1/t/{token}/models': 'Lista modeli bez nagłówka z kluczem: klucz siedzi w adresie. Dla programów, w których nie da się ustawić nagłówka.',
    'POST /v1/t/{token}/chat/completions': 'Rozmowa OpenAI z kluczem w adresie zamiast w nagłówku.',
    'POST /v1/t/{token}/responses': 'Responses API z kluczem w adresie.',
    'POST /v1/t/{token}/api/chat': 'Rozmowa Ollama z kluczem w adresie.',
    'GET /v1/t/{token}/api/tags': 'Lista modeli Ollama z kluczem w adresie.',
  };

  // Kolejnosc i polskie nazwy grup (tagi ze specyfikacji).
  const GRUPY = [
    { tag: 'Chat', tytul: 'OpenAI', opis: 'Format, który obsługuje prawie każdy program. Base URL kończy się na /v1.' },
    { tag: 'Responses', tytul: 'OpenAI Responses', opis: 'Nowszy format OpenAI.' },
    { tag: 'Models', tytul: 'Modele', opis: 'Co jest dostępne.' },
    { tag: 'Anthropic', tytul: 'Anthropic (Claude)', opis: 'Dla programów pisanych pod Claude, np. Claude Code (ANTHROPIC_BASE_URL bez /v1).' },
    { tag: 'Gemini', tytul: 'Google Gemini', opis: 'Natywny format Google, base URL kończy się na /v1beta.' },
    { tag: 'Ollama', tytul: 'Ollama', opis: 'FreeLLMAPI udaje lokalną Ollamę, adres bez /v1.' },
    { tag: 'Media', tytul: 'Obraz, wideo, dźwięk', opis: 'Generowanie i transkrypcja.' },
    { tag: 'URL tokens', tytul: 'Klucz w adresie', opis: 'Dla programów bez możliwości ustawienia nagłówka. Tokeny tworzysz w ustawieniach panelu.' },
  ];

  const MCP = {
    metoda: 'POST',
    sciezka: '/mcp',
    opis: 'Serwer MCP dla asystentów (Claude, Cursor…): podgląd modeli, stanu i zużycia. Nie wysyła zapytań do modeli. Włączasz go w ustawieniach panelu.',
  };

  function wiersz(metoda, sciezka, opis, angielski) {
    return `
      <tr>
        <td class="ep-metoda"><span class="ep-m ep-${metoda.toLowerCase()}">${metoda}</span></td>
        <td class="ep-sciezka"><code>${esc(sciezka)}</code></td>
        <td class="ep-opis-kol">${esc(opis)}${angielski ? ' <span class="zk-szary">(opis ze specyfikacji)</span>' : ''}</td>
        <td class="ep-akcja"><button class="chip" type="button" data-kopiuj="${esc(location.origin + sciezka)}" aria-label="Kopiuj adres ${esc(sciezka)}">Kopiuj</button></td>
      </tr>`;
  }

  function grupa(tytul, opis, wiersze) {
    return `
      <section class="ep-grupa" aria-label="${esc(tytul)}">
        <h2>${esc(tytul)}</h2>
        <p class="zk-pod">${esc(opis)}</p>
        <div class="zk-tabela"><table class="ep-tabela"><tbody>${wiersze}</tbody></table></div>
      </section>`;
  }

  async function zkEndpointy(el) {
    el.innerHTML = `
      <div class="zk-glowa">
        <h1 class="text-2xl font-semibold tracking-tight">Endpointy</h1>
        <p class="text-sm text-muted-foreground mt-1">Wszystko, co FreeLLMAPI wystawia programom, i do czego służy. Każdy endpoint wymaga klucza API w nagłówku <code>Authorization: Bearer …</code>, chyba że klucz siedzi w adresie.</p>
      </div>
      <p class="zk-szary">Ładuję…</p>`;

    let spec;
    let klucz = null;
    try {
      [spec, klucz] = await Promise.all([
        fetch('/v1/openapi.json').then((r) => {
          if (!r.ok) throw new Error(`/v1/openapi.json: HTTP ${r.status}`);
          return r.json();
        }),
        api('/api/settings/api-key').then((r) => r.apiKey ?? null).catch(() => null),
      ]);
    } catch (err) {
      el.lastElementChild.outerHTML = `<p class="zk-blad">Nie udało się pobrać listy endpointów: ${esc(err.message)}</p>`;
      return;
    }
    if (!el.isConnected) return;

    const poTagu = new Map();
    for (const [sciezka, operacje] of Object.entries(spec.paths ?? {})) {
      for (const [metoda, op] of Object.entries(operacje)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(metoda)) continue;
        const M = metoda.toUpperCase();
        const tag = op.tags?.[0] ?? 'Inne';
        const pl = OPISY[`${M} ${sciezka}`];
        if (!poTagu.has(tag)) poTagu.set(tag, []);
        poTagu.get(tag).push(wiersz(M, sciezka, pl ?? op.summary ?? '', !pl));
      }
    }
    const znane = new Set(GRUPY.map((g) => g.tag));
    const sekcje = GRUPY.filter((g) => poTagu.has(g.tag)).map((g) => grupa(g.tytul, g.opis, poTagu.get(g.tag).join('')));
    for (const [tag, wiersze] of poTagu) if (!znane.has(tag)) sekcje.push(grupa(tag, 'Grupa ze specyfikacji serwera.', wiersze.join('')));
    sekcje.push(grupa('MCP', 'Dla asystentów AI, nie dla zwykłych programów.', wiersz(MCP.metoda, MCP.sciezka, MCP.opis, false)));

    const widocznyKlucz = (pokaz) => (klucz ? (pokaz ? klucz : `${klucz.slice(0, 6)}…${klucz.slice(-4)}`) : 'nie udało się pobrać, skopiuj z zakładki Keys');
    el.lastElementChild.outerHTML = `
      <section class="pula endpoint">
        <div class="ep-wiersz">
          <span class="ep-etykieta">Base URL (OpenAI)</span>
          <code class="ep-wartosc">${esc(location.origin)}/v1</code>
          <button class="chip" type="button" data-kopiuj="${esc(location.origin)}/v1">Kopiuj</button>
        </div>
        <div class="ep-wiersz">
          <span class="ep-etykieta">Klucz API</span>
          <code class="ep-wartosc" id="ep-klucz">${esc(widocznyKlucz(false))}</code>
          ${klucz ? `<button class="chip" type="button" id="ep-pokaz">Pokaż</button><button class="chip" type="button" data-kopiuj="${esc(klucz)}">Kopiuj</button>` : ''}
        </div>
        <div class="ep-wiersz">
          <span class="ep-etykieta">Model</span>
          <span class="zk-pod"><code>auto</code> wybiera sam, <code>auto:nazwa</code> idzie przez łańcuch z zakładki Łańcuchy, a konkretne id modelu przypina model.</span>
        </div>
      </section>
      ${sekcje.join('')}
      <p class="zk-pod zk-stopka">Pełna specyfikacja z przykładami: <a href="/v1/docs" target="_blank" rel="noopener">/v1/docs</a> (OpenAPI: <a href="/v1/openapi.json" target="_blank" rel="noopener">/v1/openapi.json</a>).</p>`;

    let pokazany = false;
    el.addEventListener('click', async (ev) => {
      const pokaz = ev.target.closest('#ep-pokaz');
      if (pokaz) {
        pokazany = !pokazany;
        el.querySelector('#ep-klucz').textContent = widocznyKlucz(pokazany);
        pokaz.textContent = pokazany ? 'Ukryj' : 'Pokaż';
        return;
      }
      const btn = ev.target.closest('[data-kopiuj]');
      if (!btn) return;
      const ok = await kopiuj(btn.dataset.kopiuj);
      const stary = btn.textContent;
      btn.textContent = ok ? 'Skopiowano' : 'Nie da się, zaznacz ręcznie';
      setTimeout(() => { btn.textContent = stary; }, 1500);
    });
  }

  window.zkEndpointy = zkEndpointy;
})();
