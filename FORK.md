# Fork c-airr/freellmapi

Fork [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi) z kilkoma
dodatkami. Reszta działa jak w oryginale.

## Co doszło

**Zakładki w górnym menu panelu.** Działają jak natywne zakładki: to samo menu, zmienia się
tylko treść. Przy szerokości 768–1239 px chowają się pod jedną rozwijaną pozycją, na telefonie
są w menu pod hamburgerem.

| Zakładka | Adres | Co robi |
|---|---|---|
| Budżet | `/budzet-modeli` | Modele od najmądrzejszego, tokeny na dzień i na miesiąc. Liczby z dokumentacji dostawcy są zwykłe, szacunki pomarańczowe z podanym źródłem. |
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
- `LOGIN_MAX_ATTEMPTS` w `.env`: liczba błędnych logowań przed 15-minutową blokadą
  (domyślnie 5, `0` wyłącza blokadę, tylko dla instalacji dostępnej z sieci prywatnej).

## Wdrożenie

Obraz buduje `.github/workflows/docker.yml` przy każdym pushu na `main`:
`ghcr.io/c-airr/freellmapi:latest`. `docker-compose.yml` w tym repo już go używa.

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
