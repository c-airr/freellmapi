# Fork c-airr/freellmapi

Fork [tashfeenahmed/freellmapi](https://github.com/tashfeenahmed/freellmapi) z kilkoma
dodatkami. Reszta działa jak w oryginale.

## Co doszło

**Zakładki w górnym menu panelu.** Działają jak natywne zakładki: to samo menu, zmienia się
tylko treść. Przy szerokości 768–1239 px chowają się pod jedną rozwijaną pozycją, na telefonie
są w menu pod hamburgerem.

| Zakładka | Adres | Co robi |
|---|---|---|
| Budżet | `/budzet-modeli` | Modele od najmądrzejszego, tokeny na dzień i na miesiąc. Liczby z dokumentacji dostawcy są zwykłe, szacunki pomarańczowe z podanym źródłem, a żółte to realne limity nauczone z Twoich błędów 429. Na dole: suma budżetu każdego łańcucha (`auto:nazwa`). |
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
- `GET /v1/budzet[?lancuch=nazwa]` (klucz API jak `/v1`): ile tokenów i zapytań zostało dziś (od północy UTC)
  per model i per dostawca. Dzienny limit liczony jak w zakładce Budżet (kopia logiki z
  `budzet.js`, zmiana tam = zmiana w `server/src/routes/budzet.ts`). Czyta go OpenBot.
- `LOGIN_MAX_ATTEMPTS` w `.env`: liczba błędnych logowań przed 15-minutową blokadą
  (domyślnie 5, `0` wyłącza blokadę, tylko dla instalacji dostępnej z sieci prywatnej).

## Wdrożenie

Obraz buduje `.github/workflows/docker.yml` przy każdym pushu na `main`:
`ghcr.io/c-airr/freellmapi:main` (tag `latest` workflow nadaje tylko przy tagach wydań
`v*`). `docker-compose.yml` w tym repo już go używa.

```bash
docker compose pull && docker compose up -d
```

Własne ustawienia zakładek (podział dobre/słabe, oficjalne źródła limitów, kolejność
preferowanych modeli OpenRouter w łańcuchach — klucz `openrouterPrefer` w `config.json`)
podmontuj na
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

## Usunięte providery

**OpenCode Zen** — wyrejestrowany z `server/src/providers/index.ts`; migracja
`20261103_000001_remove_opencode_provider` kasuje klucze, modele, wpisy łańcuchów
i profile tej platformy. Sidecar `zen-proxy` (klucz Custom `http://zen-proxy:8787/v1`)
zniknął wcześniej razem z `docker/zen-proxy/`. OpenCode jako *klient* (CLI
`setup-opencode` w `cli/`) dalej działa i nie ma z tym nic wspólnego.

## Modele NVIDIA NIM spoza katalogu

Katalog freellmapi jest podpisany i kuratorowany, a NVIDIA jest „catalog-managed”,
więc modeli z `build.nvidia.com`, których katalog nie zna, nie da się dociągnąć
przyciskiem „Pobierz modele”. Dodaje się je jako wiersze operatorskie
(`models.source = 'user'`) — katalog ich nie usuwa przy synchronizacji, bo pruning
dotyczy tylko `source = 'catalog'`. Na masle dodane:

| model_id | stan |
|---|---|
| `mistralai/mistral-large-4-1t-a52b` | włączony, pierwszy w łańcuchu |
| `nvidia/nemotron-3.5-super-vl-120b-a12b` | włączony |
| `stepfun-ai/step-5-preview` | włączony |
| `z-ai/glm-5.3-flash` | włączony |
| `minimaxai/minimax-m3.1-flash` | włączony |
| `nvidia/nemotron-3.5-bolt-e4b` | włączony |
| `deepseek-ai/deepseek-v4.1-flash` | wyłączony — pierwsze wywołanie ~220 s |

Wszystkie na jednym kluczu `nvapi` (limit NIM: 40 RPM na model); `nvidia/nemotron-nano-3-30b-a3b`
pominięty, bo endpoint zwraca 404 na tym koncie. Świeża instalacja odtwarza je przez
panel **Klucze → Dodaj model** (platforma NVIDIA NIM) albo `POST /api/models`.
