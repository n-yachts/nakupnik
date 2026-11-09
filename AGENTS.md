# AGENTS.md – Nákupník

Informace pro AI agenty (a lidi): **co** aplikace dělá, **jak** a **proč** je to udělané takto.
Pravidla pro každou úpravu jsou v [`CLAUDE.md`](CLAUDE.md). Sesterský projekt se stejnou
architekturou je [Lhůtník](https://github.com/n-yachts/lhutnik) – při nejasnostech se inspiruj tam.

- Web: https://n-yachts.github.io/nakupnik/ (GitHub Pages z `main`), nápověda `help.html`
- Jazyk rozhraní, nápovědy i dokumentace: **čeština**
- Pracovní kopie u uživatele: `C:\Users\jnovacek\source\repos\nakupnik` (Windows)

---

## 1. Co aplikace dělá

Sdílené nákupní seznamy. Uživatel (majitel repozitáře, mj. majitel lodi) má více seznamů
(potraviny, drogerie, loď…) a sdílí je s rodinou nebo posádkou; všichni mají Google účet.
Kdo je v obchodě, odškrtává; ostatní změnu uvidí do ~15 s.

Obrazovky: průvodce nastavením → přihlášení → **Moje seznamy** → **seznam**
(přidávání, oddělení, „Často kupujete“, „V košíku“) + dialogy úpravy položky, nového seznamu,
možností (⋯), sdílení a nastavení; obrazovka **Zpřístupnit seznam** pro odkaz ze sdílení.

## 2. Architektura a proč

| Rozhodnutí | Proč |
|---|---|
| Statické HTML + ES moduly, bez buildu a závislostí, GitHub Pages | stejně jako Lhůtník: zdarma, jednoduchá údržba |
| **Úložiště = Google Tabulka** (1 seznam = 1 tabulka v Disku uživatele) | uživatel zvolil variantu „ve stejném duchu“: žádná další služba (zvažovaný Firebase by dal okamžitou synchronizaci, ale přidal databázi, pravidla a knihovnu); data má uživatel ve svém Disku, seznam jde v nouzi upravit v Tabulkách |
| Sdílení přes **sdílení souboru v Google Disku** (role writer, e-mail s odkazem) | standardní mechanismus Googlu, žádná vlastní správa uživatelů |
| Oprávnění jen **`drive.file`** (uživatel zvolil „úzké oprávnění“) | necitlivé oprávnění: aplikace vidí jen soubory, které vytvořila nebo které jí uživatel ukázal. Daň: příjemce sdíleného seznamu ho musí **jednou vybrat v Google Pickeru**, a Picker potřebuje **API klíč** |
| Google Tasks / Keep zamítnuty | Úkoly nejdou sdílet s dalšími lidmi, Keep nemá API pro běžné účty |
| Synchronizace **dotazováním** (15 s, při návratu do aplikace, po připojení) | Sheets API nemá push notifikace pro klienta bez serveru; pro nákup stačí |
| **Optimistické změny + fronta** v `localStorage` | v obchodě (sklep, slabý signál) musí odškrtávání fungovat hned i offline |
| Pro uživatele samostatná aplikace | v průvodci, nápovědě ani README se Lhůtník nezmiňuje (Nákupník používají i lidé bez Lhůtníku); Client ID se z Lhůtníku nepřebírá. Technicky může běžet ve stejném Google Cloud projektu. |
| Předpona `nakupnik.` v `localStorage` | obě aplikace sdílí origin → oddělené klíče (u Lhůtníku jsme kvůli tomu přejmenovávali `jn.*`) |
| Port 8081 lokálně | 8080 používá Lhůtník; port je součástí OAuth originu a referreru API klíče |

### Moduly (`js/`)

```
app.js ── UI: průvodce, seznamy, seznam, dialogy, sdílení, nastavení, PWA instalace
 ├─ store.js   ListStore: data z tabulky + fronta změn (add/set/del/hist), sync(), mezipaměť
 │   └─ google.js
 ├─ google.js  Drive v3 (soubory, appProperties, sdílení, about), Sheets v4 (hodnoty), Picker
 │   └─ auth.js   GIS token model (kopie z Lhůtníku, jen jiné SCOPES a klíč tokenu)
 └─ parse.js   parseItem (množství a jednotka z textu), guessCategory (oddělení), CATEGORIES
```

Importy mají `?v=verze` (doplňuje `tools/stamp.py`). Moduly s různým query stringem jsou různé
instance – všechny importy stejného modulu musí mít stejnou verzi, jinak by vznikly dva stavy přihlášení.

## 3. Data

### Soubor seznamu
- Google Tabulka s názvem **`Nákupník – <název>`** (`TITLE_PREFIX`), Drive `appProperties: { nakupnik: '1' }`.
  Seznamy se hledají dotazem `appProperties has { key='nakupnik' and value='1' }` – s `drive.file` vrátí
  jen soubory, ke kterým má aplikace přístup (vlastní + vybrané v Pickeru).
- Vlastní seznamy leží ve složce **Nákupník** (`appFolder()`): složka s `appProperties: { nakupnik: 'folder' }`,
  hledá se podle značky (přejmenování/přesun nevadí), chybí-li (nebo je v koši), založí se nová.
  Nové seznamy dostanou `parents: [složka]` a `appProperties.nakupnikFolder = '1'`. Seznamy bez této značky
  (ze starších verzí, v kořeni Disku) `listLists()` jednou za běh na pozadí přesune (`addParents/removeParents`)
  a označí – seznam, který si uživatel pak přesune jinam, už aplikace nevrací. Cizí seznamy se nepřesouvají.
  Selže-li složka, seznam vznikne v kořeni (není to kritické).
- List **`Položky`** (řádek 1 záhlaví): `id | položka | množství | jednotka | kategorie | koupeno | poznámka | přidal | změněno`
  (`ITEM_COLUMNS`). `koupeno` = `TRUE/FALSE`, `kategorie` = id z `CATEGORIES`, `přidal` = křestní jméno, `změněno` = ISO čas.
- List **`Historie`**: `položka | kategorie | jednotka | počet | naposledy` – pro „Často kupujete“,
  našeptávač a zapamatované oddělení. Počet se zvyšuje při každém přidání.

**Neměnit** názvy listů, pořadí sloupců, `appProperties` ani prefix názvu – existující seznamy by se ztratily.

### Zápisy (vždy podle `id`, ne podle čísla řádku)
Řádek položky se hledá čtením sloupce A těsně před zápisem (`updateItem`, `deleteItems`), protože
ostatní mezitím mohli přidat/smazat řádky. Mazání jde odspodu. Souběžná změna: vyhrává poslední zápis.

### Chyby API (`call()` v `google.js`)
- nepovolené API (`SERVICE_DISABLED`/`accessNotConfigured`) → česká hláška s názvem API a číslem projektu, nic se nemaže,
- 429 / rateLimit / quota → chová se jako výpadek sítě (změny čekají ve frontě),
- ostatní 403/404 → `NoAccessError` (seznam smazaný nebo přestal být sdílený → odebere se z přehledu).
Pozor: 403 neznamená vždy „bez přístupu“ – nerozlišené 403 by omylem odebíralo seznamy.

### V prohlížeči (`localStorage`)
`nakupnik.clientId`, `nakupnik.apiKey`, `nakupnik.lastList`, `nakupnik.lists` (přehled),
`nakupnik.hidden` (odebrané cizí seznamy), `nakupnik.me`, `nakupnik.cache.<id>` (položky + historie),
`nakupnik.pending.<id>` (neodeslané změny). Token v `sessionStorage` `nakupnik.token`.

## 4. Hlavní toky

- **Přihlášení:** GIS token model, ~1 h, obnovení jen z kliknutí (`ensureAuth()` na začátku obsluhy).
  Vypršení během nákupu nevadí: změny jdou do fronty, u názvu se ukáže „🔑 Obnovit přihlášení“.
- **Start bez tokenu:** pokud je v mezipaměti poslední seznam, otevře se rovnou (offline v obchodě).
- **Nový seznam:** `appFolder()` → Drive `files.create` (mimeType spreadsheet + appProperties + parents) → Sheets `batchUpdate`
  (přejmenovat list na Položky, přidat Historie, zmrazit záhlaví) → zápis záhlaví.
- **Přidání:** `parseItem` → existuje-li stejný název, jen se upraví/vrátí z košíku; jinak `add`
  s oddělením z Historie nebo `guessCategory`. Ve frontě: `values.append` + `bumpHistory`.
- **Synchronizace (`ListStore.sync`)**: odešle frontu (po jedné operaci, při chybě sítě se zastaví
  a čeká) → přečte tabulku → uloží mezipaměť. Zobrazení = data z tabulky + fronta (`items` getter).
- **Sdílení:** Drive `permissions.create` (writer, `sendNotificationEmail` s odkazem `?seznam=<id>`).
- **Otevření odkazu:** `getList(id)`; při 403/404 (`NoAccessError`) obrazovka „Zpřístupnit seznam“ →
  Picker s `DocsView.setFileIds(id)` a `setAppId(<číslo projektu>)` (číslo projektu = začátek Client ID).
  Výběr v Pickeru udělí `drive.file` přístup natrvalo.
- **Smazání:** vlastník → soubor do koše (zmizí všem); ostatní → jen skrýt (`nakupnik.hidden`).

## 5. Rozpoznání položek (`parse.js`)

- Množství před i za názvem, jednotky `ks kg dkg g l ml bal` (+ aliasy `x`, `litr`, `balení`…),
  desetinná čárka; číslo bez jednotky = ks.
- `guessCategory`: normalizace bez diakritiky, víceslovné výrazy (`PHRASES`) mají přednost, jinak
  nejdelší odpovídající začátek slova (`STEMS`). Rozšiřuj slovník a přidej test do `tests/parse.test.mjs`.
- `CATEGORIES` je v pořadí průchodu obchodem; pořadí určuje řazení seznamu.

## 6. PWA, mezipaměť, verze

Jako Lhůtník: `manifest.webmanifest`, `sw.js` („nejdřív síť“, cizí domény se neukládají, mezipaměť
`nakupnik-<VERSION>`), ikony z `tools/icons.py`. Před nasazením `python tools/stamp.py`.

## 7. Testy a nasazení

| Co | Jak |
|---|---|
| Rozpoznání položek | `node tests/parse.test.mjs` |
| Celá aplikace | `python tests/e2e.py` – Playwright proti `tools/fakegoogle.py` (Drive, Sheets, Picker, GIS; hlídá i pravidlo `drive.file`): dva uživatelé, složka Nákupník a přesun starých seznamů, založení, přidávání, kategorie, sdílení, Picker, synchronizace, offline fronta, mazání koupených |
| Náhledy | `python tools/screenshots.py` → `help/img/` (prohlédni je) |
| Skutečný Google | automaticky nejde; změny API/přihlášení ověř ručně s uživatelem |
| Lokálně | `start.cmd` (port 8081) nebo `python -m http.server 8081` |
| Nasazení | push do `main` → GitHub Pages; stav `gh api repos/n-yachts/nakupnik/deployments` |

## 8. Konvence

Česky, bez závislostí, žádné `alert/confirm` (mazání = druhé klepnutí), uživatelská data do HTML jen
přes `esc()`, velké dotykové plochy (používá se jednou rukou v obchodě), světlý i tmavý režim.

## 9. Omezení a nápady

- Zpoždění změn od ostatních až 15 s (dotazování). Souběžné úpravy: poslední zápis vyhrává.
- Příjemce sdíleného seznamu musí jednou projít Pickerem (daň za `drive.file`).
- Neověřená OAuth aplikace: varování při přihlášení, max. 100 uživatelů.
- Nápady: přetažení pořadí oddělení podle konkrétního obchodu, režim „nechat displej svítit“
  (Wake Lock) při nákupu, ceny a útrata, sdílení odkazem bez e-mailu.
