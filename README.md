# NEURON

Aplikacja webowa do obsługi publicznych API EUIPO — **trademark-search 1.1.0** (znaki towarowe)
i **design-search 1.1.0** (wzory przemysłowe).

## Stos

- Node.js ≥ 20, Express 4, EJS (bez kroku budowania)
- Bootstrap 5.3 + Bootstrap Icons + Google Fonts (Inter, JetBrains Mono) z CDN
- Czysty CSS (`public/css/style.css`) — SCSS nie jest potrzebny
- SQLite (`better-sqlite3`) — log zapytań i zapisane wyszukiwania
- Autoryzacja OAuth2 *client credentials* z cache tokenu w pamięci procesu

## Struktura

```
src/
  server.js      – serwer Express, routing stron
  config.js      – konfiguracja z .env
  euipo.js       – klient EUIPO: token OAuth2, żądania, obsługa 401/429
  metadata.js    – pola RSQL, operatory, enumy i zasoby obu API (ze specyfikacji OpenAPI)
  db.js          – SQLite: request_log, saved_query
  routes/api.js  – lokalne proxy /api/* (JSON + strumieniowanie mediów)
views/           – szablony EJS
public/          – CSS + JS frontendu (moduły ES, bez bundlera)
docs/euipo/      – oryginalne specyfikacje OpenAPI
```

## Środowiska

Zmienna `ENV` w `.env` przełącza całą aplikację między systemem testowym a produkcyjnym —
podmienia serwer autoryzacji, host API oraz parę kluczy:

| `ENV`        | Autoryzacja                                              | API                                  | Klucze |
|--------------|----------------------------------------------------------|--------------------------------------|--------|
| `sandbox`    | `https://auth-sandbox.euipo.europa.eu/oidc/accessToken`   | `https://api-sandbox.euipo.europa.eu` | `EUIPO_SANDBOX_API_KEY` / `..._SECRET` |
| `production` | `https://euipo.europa.eu/cas-server-webapp/oidc/accessToken` | `https://api.euipo.europa.eu`      | `EUIPO_API_KEY` / `EUIPO_API_SECRET` |

W trybie sandbox interfejs pokazuje żółtą plakietkę **SANDBOX** w nagłówku, a każdy wpis
w historii zapytań jest oznaczony środowiskiem, w którym powstał. Aktywne środowisko
widać też w logu startowym oraz w `/healthz` i `/api/token`.

## Uruchomienie

```bash
npm install
cp .env.example .env      # ustaw ENV oraz klucze dla wybranego środowiska
npm start                 # produkcyjnie
npm run dev               # z automatycznym restartem
```

### PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

### NGINX (reverse proxy)

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Jeśli aplikacja ma stać pod podkatalogiem (np. `/neuron`), ustaw `BASE_PATH=/neuron` w `.env` —
wszystkie ścieżki (strony, `/static`, `/api`) przesuną się pod ten prefiks.

## Podstrony

| Ścieżka       | Zawartość |
|---------------|-----------|
| `/`           | Start, stan tokenu OAuth2 |
| `/trademarks` | Znaki towarowe: wyszukiwanie, szczegóły, zasoby |
| `/designs`    | Wzory przemysłowe: wyszukiwanie, szczegóły, widoki |
| `/alerts`     | Alerty: monitoring nowych zgłoszeń po elemencie słownym |
| `/history`    | Historia zapytań i statystyki z SQLite |
| `/healthz`    | Health check dla monitoringu |

Każda podstrona API to jeden widok pokrywający **wszystkie** operacje danego API:

1. **Wyszukiwanie** — kreator RSQL (pole / operator / wartość / and-or), pełna obsługa
   `query`, `fields`, `page`, `size`, `sort`, `Accept-Language`; wyniki jako tabela kart
   z miniaturami lub podświetlony JSON; paginacja; zapisywanie zapytań.
2. **Szczegóły rozwijane w tabeli wyników** — kliknięcie wiersza wywołuje `GET /{id}`
   (pełny rekord, `Accept-Language` z formularza) i rozwija panel pod wierszem.
   Rozwinięty jest jeden rekord naraz, co utrzymuje liczbę żądań o zasoby w limitach
   EUIPO. Panel zawiera:
   - **Zasoby** — wszystkie media rekordu pobierane automatycznie (dla znaków obraz,
     miniatura, dźwięk, wideo, model 3D; dla wzorów widoki 1–10, wideo, model 3D).
     Rekord sam deklaruje, co posiada, więc brakujące zasoby są oznaczane bez zbędnych
     żądań; kafelek pokazuje podgląd, rozmiar i link do pobrania.
   - **Rekord** — dane w czytelnej tabeli z polskimi etykietami: daty w formacie
     `dd.mm.rrrr`, wartości słownikowe tłumaczone (z oryginałem w nawiasie), a listy
     (zgłaszający, towary i usługi, publikacje, wpisy do rejestru…) jako osobne tabele.
   - **Surowa odpowiedź JSON** — domyślnie zwinięta, z kopiowaniem do schowka.

## Lokalne API (proxy)

Klucze EUIPO nigdy nie trafiają do przeglądarki — front-end rozmawia wyłącznie z lokalnym proxy:

```
GET /api/meta
GET /api/token
GET /api/trademarks?query&fields&page&size&sort&lang
GET /api/trademarks/:applicationNumber?fields&lang
GET /api/trademarks/:applicationNumber/{image|image/thumbnail|sound|video|model}
GET /api/designs?query&fields&page&size&sort&lang
GET /api/designs/:designNumber?fields&lang
GET /api/designs/:designNumber/views/:order[/thumbnail]
GET /api/designs/:designNumber/{model|video}
GET    /api/alerts                    lista alertów + liczniki nowych wpisów
GET    /api/alerts/summary            suma nowych (badge w nawigacji)
GET    /api/alerts/preview?api&pattern podgląd RSQL generowanego z wzorca
POST   /api/alerts                    { api, name, pattern } — tworzy alert + seed
GET    /api/alerts/:id                alert + rekordy + historia sprawdzeń
POST   /api/alerts/:id/check          ręczne sprawdzenie
POST   /api/alerts/:id/ack            oznacz nowe jako przeczytane
POST   /api/alerts/:id/toggle         wstrzymaj / wznów
DELETE /api/alerts/:id                usuń alert z historią
GET /api/history?limit
GET /api/stats
GET|POST|DELETE /api/saved/:api[/:id]
```

## Alerty (monitoring)

Alert monitoruje rejestr EUIPO po **elemencie słownym** z wildcard `*` (np. `*konop*`).
Działanie:

1. **Seed** — przy utworzeniu alert pobiera wszystkie pasujące rekordy (paginacja po 100,
   sortowanie malejąco po numerze, limit 1000 najnowszych) i zapisuje je w SQLite jako
   stan zastany.
2. **Harmonogram** — scheduler w procesie aplikacji (start razem z serwerem, PM2 utrzymuje
   proces) co 15 minut sprawdza, którym aktywnym alertom minęło `interval_hours`
   (domyślnie 24 h), i ponawia zapytanie; zaległości po restarcie są nadrabiane
   przy pierwszym ticku (~60 s po starcie).
3. **Wykrywanie** — rekordy nieobecne w stanie zapisanym dostają flagę **NOWY**:
   badge przy alercie, licznik przy pozycji „Alerty" w nawigacji, wpis w historii
   sprawdzeń. „Oznacz jako przeczytane" zeruje flagi.

Szczegóły alertu to akordeon rekordów (miniatura, status, data zgłoszenia); rozwinięcie
pokazuje pełną tabelę rekordu ze snapshotu. Alerty są rozdzielone per środowisko —
alert utworzony w sandboxie nie jest sprawdzany po przełączeniu na produkcję.
Dane: tabele `alert`, `alert_record`, `alert_check` (usunięcie alertu kasuje kaskadowo).

## Stan dostępu do API

**Sandbox — działa.** Oba API zwracają dane testowe: wyszukiwanie, szczegóły rekordów,
obrazy znaków, widoki wzorów i wideo znaków multimedialnych.

**Produkcja — brak subskrypcji.** Klucze produkcyjne poprawnie uzyskują token OAuth2,
ale API odpowiada `HTTP 403 Unauthorized request` — aplikacja w portalu
[developer.euipo.europa.eu](https://developer.euipo.europa.eu) nie ma jeszcze aktywnej
subskrypcji produktów *Trademark search API* i *Design search API* (zatwierdzane ręcznie
przez EUIPO). Po aktywacji wystarczy `ENV=production` i restart — kod nie wymaga zmian.

## Uwagi implementacyjne

Pliki z `public/` są linkowane z parametrem `?v=<znacznik>` liczonym przy starcie z czasu
modyfikacji plików, a serwowane z `Cache-Control: no-cache` (cache po rewalidacji, zwykle
`304`). Po zmianie CSS/JS wystarczy restart aplikacji (`pm2 restart neuron`) — przeglądarka
pobierze nową wersję bez czyszczenia cache.


`fetch` w Node.js dodaje domyślnie nagłówek `Accept-Language: *`, który API wzorów
odrzuca jako błąd walidacji (HTTP 400). Dlatego `src/euipo.js` **zawsze** ustawia ten
nagłówek jawnie — pusta wartość oznacza dla EUIPO brak filtra językowego.
