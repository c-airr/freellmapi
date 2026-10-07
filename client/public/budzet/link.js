// Wlasne zakladki w gornym menu panelu FreeLLMAPI: Budzet, Lancuchy, Projekty
// i Endpointy. Ladowane z client/index.html (<script src="/budzet/link.js">).
//
// Dzialaja jak natywne zakladki: ten sam naglowek i menu, zmienia sie tylko
// tresc pod menu. Ich adresy (/budzet-modeli, /lancuchy...) sa dla routera panelu
// nieznane, wiec renderuje on "Page not found" w <main> — chowamy to i w tym
// samym <main> rysujemy wlasna strone. Klik w nasz link idzie przez
// history.pushState + popstate, wiec strona sie nie przeladowuje.
// React przerysowuje menu i <main>, wiec wszystko pilnuje obserwator.
(function () {
  const BAZA = '/budzet/';
  for (const plik of ['wspolne.js', 'budzet-strona.js', 'kreator.js', 'projekty.js', 'endpointy.js']) {
    const s = document.createElement('script');
    s.src = BAZA + plik;
    s.async = false; // kolejnosc: wspolne.js definiuje funkcje dla pozostalych
    document.head.appendChild(s);
  }
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = `${BAZA}zakladki.css`;
  document.head.appendChild(css);

  const ZAKLADKI = [
    { id: 'zk-budzet', path: '/budzet-modeli', tekst: 'Budżet', tytul: 'Budżet', render: (el) => window.zkBudzet(el) },
    { id: 'zk-lancuchy', path: '/lancuchy', tekst: 'Łańcuchy', tytul: 'Łańcuchy', render: (el) => window.zkKreator(el) },
    { id: 'zk-projekty', path: '/projekty', tekst: 'Projekty', tytul: 'Projekty', render: (el) => window.zkProjekty(el) },
    { id: 'zk-endpointy', path: '/endpointy', tekst: 'Endpointy', tytul: 'Endpointy', render: (el) => window.zkEndpointy(el) },
  ];

  // Klasy linku menu skopiowane z natywnych zakladek (aktywna = podkreslenie).
  const NIEAKTYWNY = ['text-muted-foreground', 'hover:text-foreground'];
  const AKTYWNY = ['text-foreground', 'after:absolute', 'after:inset-x-0', 'after:-bottom-px', 'after:h-px', 'after:bg-foreground'];

  const TYTUL_PANELU = document.title;
  let narysowana = null; // path strony, ktora jest teraz w <main>
  // Referencja, nie getElementById: gdy panel podmieni <main>, strona jest
  // odlaczona od dokumentu i po id by sie nie znalazla.
  let strona = null;

  /** Pozycja menu (bezposrednie dziecko wspolnego rodzica) zawierajaca el. */
  function pozycja(el, rodzic) {
    let n = el;
    while (n && n.parentElement !== rodzic) n = n.parentElement;
    return n;
  }

  function idzDo(path) {
    if (location.pathname + location.search === path) return;
    history.pushState({}, '', path);
    // Router panelu slucha popstate — po nim wyrenderuje swoje "not found",
    // ktore zaraz podmienimy.
    dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    zaplanuj();
  }

  function dodajLinki() {
    if (ZAKLADKI.every((z) => document.getElementById(z.id)) && document.getElementById('zk-wiecej')) return;
    const analytics = document.querySelector('a[href="/analytics"]');
    const premium = document.querySelector('a[href="/premium"]');
    if (!analytics || !premium) return;
    // Wspolny rodzic = lista pozycji menu. Analytics ma wlasna strzalke
    // rozwijania w swoim opakowaniu, wiec wstawiamy ZA cala pozycja.
    let rodzic = analytics.parentElement;
    while (rodzic && !rodzic.contains(premium)) rodzic = rodzic.parentElement;
    if (!rodzic) return;
    let po = pozycja(analytics, rodzic);
    const wzor = pozycja(premium, rodzic);
    if (!po || !wzor) return;

    for (const z of ZAKLADKI) {
      const jest = document.getElementById(z.id);
      if (jest) { po = jest; continue; }
      // Premium jest prostym linkiem bez podmenu — jego wyglad kopiujemy.
      const item = wzor.cloneNode(true);
      const a = item.tagName === 'A' ? item : item.querySelector('a');
      if (!a) return;
      item.id = z.id;
      a.href = z.path;
      a.textContent = z.tekst;
      a.removeAttribute('data-discover');
      a.addEventListener('click', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        idzDo(z.path);
      });
      item.classList.add('zk-tab');
      po.insertAdjacentElement('afterend', item);
      po = item;
    }
    if (!document.getElementById('zk-wiecej')) po.insertAdjacentElement('afterend', menuWiecej(wzor));
  }

  /**
   * Przy srednich szerokosciach (768-1239 px, zakladki.css) cztery zakladki
   * nie mieszcza sie w rzedzie — wtedy zamiast nich jest jedna pozycja
   * z rozwijana lista. Pokazuje nazwe biezacej zakladki, gdy jestesmy na niej.
   */
  function menuWiecej(wzor) {
    const a = wzor.tagName === 'A' ? wzor : wzor.querySelector('a');
    const box = document.createElement('div');
    box.id = 'zk-wiecej';
    box.className = 'zk-wiecej';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = a.className;
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<span class="zk-wiecej-etykieta">Więcej</span><span class="zk-wiecej-strzalka" aria-hidden="true"></span>';
    const lista = document.createElement('div');
    lista.className = 'zk-wiecej-menu';
    lista.setAttribute('role', 'menu');
    lista.hidden = true;
    for (const z of ZAKLADKI) {
      const poz = document.createElement('a');
      poz.href = z.path;
      poz.className = 'zk-wiecej-poz';
      poz.setAttribute('role', 'menuitem');
      poz.dataset.path = z.path;
      poz.textContent = z.tekst;
      poz.addEventListener('click', (e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        zamknij();
        idzDo(z.path);
      });
      lista.appendChild(poz);
    }
    const zamknij = () => {
      lista.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    btn.addEventListener('click', () => {
      lista.hidden = !lista.hidden;
      btn.setAttribute('aria-expanded', String(!lista.hidden));
      if (!lista.hidden) lista.querySelector('a')?.focus();
    });
    document.addEventListener('click', (e) => { if (!box.contains(e.target)) zamknij(); });
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { zamknij(); btn.focus(); }
    });
    box.append(btn, lista);
    return box;
  }

  /**
   * Menu mobilne (hamburger, < 768 px) to osobna lista pozycji renderowana
   * dopiero po otwarciu — tam tez dopisujemy zakladki, za "Analytics".
   */
  function dodajLinkiMobilne() {
    const pozycje = [...document.querySelectorAll('[role="menuitem"]')];
    const premium = pozycje.find((p) => p.textContent.trim() === 'Premium');
    const analytics = pozycje.find((p) => p.textContent.trim().startsWith('Analytics'));
    if (!premium || !analytics || analytics.parentElement !== premium.parentElement) return;
    let po = analytics;
    for (const z of ZAKLADKI) {
      const id = `${z.id}-mobilny`;
      const jest = document.getElementById(id);
      if (jest) { po = jest; continue; }
      const item = premium.cloneNode(true);
      item.id = id;
      item.textContent = z.tekst;
      item.style.cursor = 'pointer';
      item.addEventListener('click', () => {
        // Zamknij menu tak, jak zamyka je panel (Escape), potem przejdz.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        idzDo(z.path);
      });
      po.insertAdjacentElement('afterend', item);
      po = item;
    }
  }

  function ustawAktywne(biezaca) {
    for (const z of ZAKLADKI) {
      const item = document.getElementById(z.id);
      const a = item && (item.tagName === 'A' ? item : item.querySelector('a'));
      if (!a) continue;
      const on = biezaca === z;
      for (const k of NIEAKTYWNY) a.classList.toggle(k, !on);
      for (const k of AKTYWNY) a.classList.toggle(k, on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    const wiecej = document.querySelector('#zk-wiecej > button');
    if (wiecej) {
      for (const k of NIEAKTYWNY) wiecej.classList.toggle(k, !biezaca);
      for (const k of AKTYWNY) wiecej.classList.toggle(k, !!biezaca);
      const etykieta = biezaca ? biezaca.tekst : 'Więcej';
      const el = wiecej.querySelector('.zk-wiecej-etykieta');
      if (el.textContent !== etykieta) el.textContent = etykieta;
      for (const poz of document.querySelectorAll('#zk-wiecej .zk-wiecej-poz')) {
        if (biezaca && poz.dataset.path === biezaca.path) poz.setAttribute('aria-current', 'page');
        else poz.removeAttribute('aria-current');
      }
    }
  }

  function wepnij() {
    dodajLinki();
    dodajLinkiMobilne();
    const z = ZAKLADKI.find((x) => location.pathname === x.path) ?? null;
    ustawAktywne(z);
    const html = document.documentElement;

    if (!z) {
      if (strona) strona.remove();
      strona = null;
      if (narysowana) document.title = TYTUL_PANELU;
      narysowana = null;
      html.classList.remove('zk-on');
      return;
    }
    const main = document.querySelector('main');
    if (!main) return;
    html.classList.add('zk-on');
    // Wszystko, co narysowal panel ("Page not found"), chowamy.
    for (const c of main.children) {
      if (c.id !== 'zk-strona' && !c.hasAttribute('data-zk-ukryj')) c.setAttribute('data-zk-ukryj', '');
    }
    if (strona && narysowana === z.path && strona.parentElement !== main) {
      // Panel podmienil <main> (np. po doladowaniu strony "not found") —
      // przenosimy gotowa strone ze stanem, zamiast rysowac ja od nowa.
      main.appendChild(strona);
    } else if (!strona || narysowana !== z.path) {
      strona?.remove();
      strona = document.createElement('div');
      strona.id = 'zk-strona';
      main.appendChild(strona);
      narysowana = z.path;
      document.title = `${z.tytul} · FreeLLMAPI`;
      // Skrypty stron laduja sie rownolegle z panelem — poczekaj na nie.
      const gotowe = () => window.zkBudzet && window.zkKreator && window.zkProjekty && window.zkEndpointy;
      const cel = strona;
      const start = () => (gotowe() ? z.render(cel) : setTimeout(start, 50));
      start();
    }
  }

  let zaplanowane = false;
  function zaplanuj() {
    if (zaplanowane) return;
    zaplanowane = true;
    requestAnimationFrame(() => { zaplanowane = false; wepnij(); });
  }

  window.zkIdzDo = idzDo;
  new MutationObserver(zaplanuj).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener('popstate', zaplanuj);
  document.addEventListener('DOMContentLoaded', zaplanuj);
})();
