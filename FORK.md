# Fork c-airr/freellmapi

Fork [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi) z kilkoma
dodatkami. Reszta działa jak w oryginale.

## Co doszło

**Zakładki w górnym menu panelu.** Działają jak natywne zakładki: to samo menu, zmienia się
tylko treść. Przy szerokości 768–1239 px chowają się pod jedną rozwijaną pozycją, na telefonie
są w menu pod hamburgerem.

| Zakładka | Adres | Co robi |
|---|---|---|
| Budżet | `/budzet-modeli` | Modele od najmądrzejszego, tokeny na dzień i na miesiąc. Liczby z dokumentacji dostawcy są zwykłe, szacunki pomarańczowe z podanym źródłem, a żółte to realne limity nauczone z Twoich błędów 429. |
| Łańcuchy | `/lancuchy` | Kreator łańcuchów (profili): nazwa + zaznaczone modele. Program wywołuje łańcuch przez `"model": "auto:nazwa"`. |
| Projekty | `/projekty` | Projekt = łańcuchy jednego programu (np. bot Discorda, automatyzacje). Widać, ile ciągnie projekt, każdy łańcuch i które modele odpowiadały. |
| Endpointy | `/endpointy` | Lista endpointów z opisem po polsku, czytana na żywo z `/v1/openapi.json`. |

Pliki zakładek: `client/public/budzet/` (zwykły JS, bez kompilacji). `link.js` ładuje się
z `client/index.html` i wpina zakładki w menu.

**Serwer:**

- Każde zapytanie z `auto:<łańcuch>` albo zwykłym `auto` (aktywny łańcuch) zapisuje, który
  łańcuch je obsłużył: kolumny `requests.chain_profile_id` i `chain_name`, migracja
  `20261007_000001_request_chain`. Starsze zapytania nie mają tej informacji.
- Projekty: tabele `projects` i `project_chains` (migracja `20261007_000002_projects`),
  API `GET/POST /api/projects`, `PATCH/DELETE /api/projects/:id` i
  `GET /api/projects/usage?range=24h|7d|30d|90d` (statystyki per łańcuch i model).
- `GET /api/projects/learned-limits`: dzienny limit tokenów nauczony z ruchu. Dla każdego
  dnia (UTC), w którym model oddał 429, liczy tokeny udanych zapytań do ostatniego 429;
  wynik to maksimum z 30 dni (dolna granica limitu, dobija do prawdziwej, gdy limit się
  wyczerpie). 429 „per minute”, „concurrent” i przeciążenie Zhipu są pomijane. Zakładka
  Budżet pokazuje to na żółto zamiast pomarańczowego szacunku (oficjalne liczby wygrywają).
- `LOGIN_MAX_ATTEMPTS` w `.env`: liczba błędnych logowań przed 15-minutową blokadą
  (domyślnie 5, `0` wyłącza blokadę, tylko dla instalacji dostępnej z sieci prywatnej).

## Darmowe modele OpenCode (zen-proxy)

OpenCode udostępnia za darmo kilka modeli (teraz m.in. `deepseek-v4.1-flash-free`,
`glm-5.3-flash-free`, `mimo-v2.6-flash-free`, `big-pickle`). Od 2026-09 odpowiadają
jednak tylko klientowi OpenCode: każdy inny dostaje `403 FreeTierError`, dlatego
wbudowany dostawca „OpenCode Zen” ma te modele wyłączone. Projekty społeczności,
takie jak [12errh/zen-proxy](https://github.com/12errh/zen-proxy), udają przed
OpenCode sesję OpenCode i wystawiają te modele jako zwykłe API OpenAI. Fork
uruchamia takie proxy obok serwera i podpina je jako własny endpoint (Custom).

Włączenie (Docker):

```bash
echo 'OPENCODE_PROXY_URL=http://zen-proxy:8787/v1' >> .env
docker compose --profile opencode up -d --build
```

Przy starcie serwer sam dodaje endpoint „OpenCode Free (zen-proxy)” z kluczem `public`
i rejestruje wszystkie modele, które proxy zwraca z `/v1/models` (proxy pokazuje tylko
darmowe i co godzinę sprawdza, które z nich faktycznie działają). Jeśli proxy jeszcze
się uruchamia, serwer próbuje ponownie co 30 s, maksymalnie 10 razy. Nowe modele
dochodzą później przez codzienną synchronizację custom endpointów. Wyłączone w panelu
modele, usunięte modele i wyłączony klucz endpointu zostają tak, jak je ustawisz.
Modele wpisujesz do łańcucha jak każde inne.

Bez Dockera uruchom proxy samodzielnie (`node zen-proxy.mjs`, słucha na
`127.0.0.1:8787`) i ustaw `OPENCODE_PROXY_URL=http://127.0.0.1:8787/v1`. Pozostałe
zmienne (`OPENCODE_PROXY_KEY`, `OPENCODE_PROXY_LABEL`, `OPENCODE_ZEN_KEY`) są opisane
w `.env.example`. Kod: `server/src/services/opencode-free.ts`, obraz proxy:
`docker/zen-proxy/Dockerfile` (przypięty do konkretnego commita, aktualizacja przez
zmianę `ZEN_PROXY_REF`).

Uwagi:

- To obejście blokady OpenCode, a nie oficjalny dostęp. Regulamin OpenCode tego nie
  przewiduje. OpenCode może to w każdej chwili zablokować albo zmienić listę modeli.
  Prompty w darmowym planie mogą służyć do trenowania modeli. Nie wysyłaj tam niczego
  poufnego.
- Darmowy plan ma limity na IP i bywa przeciążony. Gdy model odpowie 429/5xx, proxy
  samo przełącza się na inny darmowy model (nagłówek `x-zen-served-by`), więc
  statystyki w panelu mogą przypisać odpowiedź do modelu, o który pytałeś.

## Wdrożenie

Obraz buduje `.github/workflows/docker.yml` przy każdym pushu na `main`:
`ghcr.io/c-airr/freellmapi:main` (tag `latest` workflow nadaje tylko przy tagach wydań
`v*`). `docker-compose.yml` w tym repo już go używa.

```bash
docker compose pull && docker compose up -d
```

Własne ustawienia zakładek (podział dobre/słabe, oficjalne źródła limitów) podmontuj na
`/app/client/dist/budzet/config.json`. Wzór jest w `client/public/budzet/config.json`,
przykład montowania jest zakomentowany w `docker-compose.yml`. Zmiana pliku = odświeżenie
strony, bez restartu.

Uwaga przy powrocie na oficjalny obraz: nowe kolumny i tabele zostają w bazie i nie
przeszkadzają, ale projekty przestaną być widoczne.

## Aktualizacja z upstreamu

```bash
git fetch upstream && git merge upstream/main   # albo "Sync fork" na GitHubie
git push                                          # Actions zbuduje nowy obraz
```

Jeśli upstream doda migrację z późniejszą datą, kolejność się zgadza. Przy konflikcie
w `server/src/db/migrate/defaults.ts` zostaw obie listy wpisów.
