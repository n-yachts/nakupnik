# Nákupník

Sdílené nákupní seznamy pro rodinu i posádku. Seznamy se ukládají do **Google Tabulek**
ve vašem Disku; každý, s kým seznam sdílíte, se přihlásí svým Google účtem.

**Web:** https://n-yachts.github.io/nakupnik/ · 📖 **Nápověda s obrázky:**
[help.html](https://n-yachts.github.io/nakupnik/help.html)

## Co umí

- **Více seznamů** (potraviny, drogerie, loď…), přehled s počtem položek ke koupi.
- **Rychlé přidávání s množstvím:** `2 l mléko`, `rohlíky 10`, `3x jogurt`, `1,5 kg brambory`.
- **Řazení podle oddělení** v pořadí průchodu obchodem; oddělení se odhadne z názvu
  a změnu si aplikace zapamatuje.
- **Často kupujete** jedním klepnutím a našeptávač z historie.
- **Odškrtávání** do „V košíku“, úprava položky (množství, jednotka, oddělení, poznámka), smazání koupených.
- **Sdílení e-mailem** (přijde e-mail s odkazem), přehled a odebrání přístupu; u sdílených seznamů je vidět, kdo co přidal.
- **Bez signálu:** seznam je uložený v telefonu, změny počkají a odešlou se po připojení;
  změny ostatních se načítají každých 15 s.
- **Instalace do telefonu** jako aplikace (PWA), světlý i tmavý režim.

## Spuštění

- **Web:** https://n-yachts.github.io/nakupnik/
- **Lokálně (Windows):** dvojklik na `start.cmd` → `http://localhost:8081`

Při prvním spuštění provede **průvodce** nastavením Google Cloud. Pokud používáte
[Lhůtník](https://n-yachts.github.io/lhutnik/), použijte stejný projekt a Client ID (doplní se samo);
stačí povolit **Google Drive API, Google Sheets API a Google Picker API** a vytvořit **API klíč**
omezený na `https://n-yachts.github.io/*`, `http://localhost:8081/*` a Google Picker API.

## Oprávnění

Jen `https://www.googleapis.com/auth/drive.file` – aplikace vidí jen tabulky, které sama založila
nebo které jí uživatel ukázal v okně Google Disku (Picker). Ostatní soubory nevidí.

## Soubory

```
index.html, styles.css    aplikace
help.html, help/img/      nápověda s náhledy obrazovek
js/app.js                 rozhraní: průvodce, seznamy, položky, sdílení, nastavení, instalace
js/store.js               stav seznamu, fronta neodeslaných změn, synchronizace
js/google.js              Drive API, Sheets API, Google Picker
js/parse.js               rozpoznání množství a oddělení z textu
js/auth.js                přihlášení přes Google (stejné jako v Lhůtníku)
manifest.webmanifest, sw.js, icons/   instalace jako aplikace (PWA)
server.ps1, start.cmd     lokální server na portu 8081
tools/                    fakegoogle.py (napodobený Google), screenshots.py, stamp.py, icons.py
tests/                    parse.test.mjs (node), e2e.py (Playwright)
AGENTS.md                 pro AI agenty a vývojáře: co, jak a proč
CLAUDE.md                 pravidla pro každou úpravu
```

## Vývoj

```
node tests/parse.test.mjs     # rozpoznání množství a oddělení
python tests/e2e.py           # celá aplikace proti napodobenému Googlu (2 uživatelé, sdílení, offline)
python tools/screenshots.py   # náhledy do nápovědy
python tools/stamp.py         # nová verze souborů (mezipaměť)
```

Nasazení: push do `main` → GitHub Pages.
