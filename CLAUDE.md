# Nákupník – pokyny pro úpravy

Statická webová aplikace (HTML + JS moduly, bez buildu) nad Google Drive a Sheets API.
Nasazuje se přes GitHub Pages z větve `main`: https://n-yachts.github.io/nakupnik/

**Podrobný popis – co aplikace dělá, jak a proč (architektura, data v tabulce, toky, omezení):
[`AGENTS.md`](AGENTS.md).** Přečti ho před větší změnou.

## Při každé změně aplikace

1. **Aktualizuj nápovědu `help.html`** – nápověda musí odpovídat tomu, co aplikace skutečně dělá.
2. **Testy:** `node tests/parse.test.mjs` a `python tests/e2e.py`. Nová funkce → doplň test
   (a když sahá na Google API, i napodobeninu v `tools/fakegoogle.py`).
3. **Náhledy:** `python tools/screenshots.py` → `help/img/`; nová obrazovka = nový snímek i v `help.html`.
   Snímky si prohlédni.
4. **README.md** drž v souladu s nápovědou.
5. **Verze:** `python tools/stamp.py` (`?v=…` u CSS, modulů, obrázků nápovědy a `VERSION` v `sw.js`).
6. Texty pro uživatele česky a **bez zmínek o Lhůtníku** (aplikaci používají i lidé bez něj). Struktura tabulky (listy `Položky`/`Historie`, sloupce, `appProperties`,
   prefix názvu „Nákupník – “) se nesmí měnit bez migrace – existující seznamy by se ztratily.
7. Klíče v `localStorage` mají předponu `nakupnik.` (Lhůtník na stejné doméně používá `lhutnik.`).

## Struktura

- `index.html`, `styles.css`, `help.html` (+ `help/img/`)
- `js/app.js` UI · `js/store.js` stav a fronta změn · `js/google.js` Drive/Sheets/Picker ·
  `js/parse.js` množství a oddělení · `js/auth.js` přihlášení (oprávnění `drive.file`)
- `manifest.webmanifest`, `sw.js`, `icons/` (PWA; ikony z `tools/icons.py`)
- `server.ps1` + `start.cmd` – lokální server na `http://localhost:8081`
- `tools/` – `fakegoogle.py`, `screenshots.py`, `stamp.py`, `icons.py`; `tests/` – `parse.test.mjs`, `e2e.py`
