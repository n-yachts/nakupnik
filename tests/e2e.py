"""
Smoke test celé aplikace proti napodobenému Googlu (tools/fakegoogle.py):
dva uživatelé, založení seznamu, přidávání s množstvím, kategorie, odškrtnutí,
sdílení, zpřístupnění přes Picker, synchronizace, offline fronta, mazání koupených.

    pip install playwright && playwright install chromium
    python tests/e2e.py
"""
import functools, http.server, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from fakegoogle import FakeGoogle  # noqa: E402

PORT = 8091
CLIENT = '123456789012-test.apps.googleusercontent.com'
KEY = 'AIzaSyTESTKEY0123456789abcdefghijklmnop'


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def main():
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://localhost:{PORT}/'
    g = FakeGoogle()
    errors = []
    with sync_playwright() as p:
        b = p.chromium.launch()

        def page_for(user):
            ctx = b.new_context(viewport={'width': 420, 'height': 860}, service_workers='block')
            pg = ctx.new_page()
            pg.on('pageerror', lambda e: errors.append(f'{user}: {e}'))
            g.install(pg)
            pg.add_init_script(f"window.__fakeUser = '{user}';")
            pg.goto(base)
            pg.evaluate(f"localStorage.setItem('nakupnik.clientId','{CLIENT}'); localStorage.setItem('nakupnik.apiKey','{KEY}')")
            pg.reload()
            pg.click('#btn-signin')
            return ctx, pg

        # --- Uživatel A založí seznam a přidá položky ---
        ctxA, a = page_for('a')
        a.wait_for_selector('#view-lists:not([hidden])')
        a.wait_for_selector('#lists .empty')
        a.click('#btn-new-list'); a.fill('#form-list [name=name]', 'Potraviny'); a.click('#btn-list-save')
        a.wait_for_selector('#view-list:not([hidden])')
        for t in ['2 l mléko', 'rohlíky 10', 'banány', 'zubní pasta', '3x jogurt']:
            a.fill('#add-input', t); a.press('#add-input', 'Enter')
        a.wait_for_function("document.querySelector('#sync').textContent.includes('Uloženo')")
        sheet = g.files['sheet1']['sheets']['Položky']
        assert len(sheet) == 6, sheet
        cats = [h.text_content() for h in a.query_selector_all('.cat')]
        assert cats[0].endswith('Ovoce a zelenina') and 'Drogerie' in cats[-1], cats
        assert '2 l' in a.inner_text('.item:has-text("Mléko")')
        # Stejná položka znovu → jen úprava množství, ne duplicita
        a.fill('#add-input', 'mléko 3 l'); a.press('#add-input', 'Enter')
        a.wait_for_timeout(500)
        assert a.locator('.it-name:text-is("Mléko")').count() == 1
        # Odškrtnutí
        a.click('.item:has-text("Banány") .check')
        a.wait_for_function("document.querySelector('#sync').textContent.includes('Uloženo')")
        assert any(r[1] == 'Banány' and r[5] == 'TRUE' for r in sheet[1:])

        # Změna oddělení se zapamatuje pro příště
        a.click('[data-edit]:has-text("Jogurt")'); a.select_option('#cat-select', 'ostatni'); a.click('#form-item [type=submit]')
        a.wait_for_function("document.querySelector('#sync').textContent.includes('Uloženo')")
        assert any(r[0] == 'Jogurt' and r[1] == 'ostatni' for r in g.files['sheet1']['sheets']['Historie'][1:])

        # --- Sdílení s B ---
        a.click('#btn-share'); a.fill('#form-share [name=email]', 'jana@example.com'); a.click('#form-share [type=submit]')
        a.wait_for_selector('#people li:has-text("Jana")')
        link = a.inner_text('#share-link')
        a.click('#dlg-share [data-close]')

        # --- Uživatel B otevře odkaz → Picker → seznam ---
        ctxB, bpg = page_for('b')
        bpg.wait_for_selector('#view-lists:not([hidden])')
        bpg.add_init_script("window.__pickId = 'sheet1';")
        bpg.evaluate("window.__pickId = 'sheet1'")
        bpg.goto(link.replace('http://localhost:8091', base.rstrip('/')))
        bpg.wait_for_selector('#view-grant:not([hidden])')   # token je ještě platný → rovnou výzva k zpřístupnění
        bpg.click('#btn-grant')
        bpg.wait_for_selector('#view-list:not([hidden])')
        assert bpg.locator('.it-name:text-is("Rohlíky")').count() == 1
        bpg.fill('#add-input', 'chleba'); bpg.press('#add-input', 'Enter')
        bpg.wait_for_function("document.querySelector('#sync').textContent.includes('Uloženo')")
        # A uvidí změnu po synchronizaci
        a.evaluate("document.dispatchEvent(new Event('visibilitychange'))")
        a.wait_for_selector('.it-name:text-is("Chleba")', timeout=5000)
        assert 'Jana' in a.inner_text('.item:has-text("Chleba")')

        # --- Offline: změna čeká a odešle se po připojení ---
        ctxB.set_offline(True); g.offline.add('b')
        bpg.fill('#add-input', 'máslo'); bpg.press('#add-input', 'Enter')
        bpg.wait_for_function("document.querySelector('#sync').textContent.includes('Offline')")
        assert not any(r[1] == 'Máslo' for r in sheet[1:])
        ctxB.set_offline(False); g.offline.discard('b')
        bpg.evaluate("window.dispatchEvent(new Event('online'))")
        bpg.wait_for_function("document.querySelector('#sync').textContent.includes('Uloženo')")
        assert any(r[1] == 'Máslo' for r in sheet[1:])

        # --- Smazat koupené, historie ---
        a.click('#btn-clear')
        a.wait_for_function("document.querySelector('#sync').textContent.includes('Uloženo')")
        assert not any(r[1] == 'Banány' for r in sheet[1:])
        hist = g.files['sheet1']['sheets']['Historie']
        assert any(r[0] == 'Mléko' and r[3] == 1 for r in hist[1:]), hist
        a.wait_for_selector('#frequent [data-quick="Banány"]')

        # --- Nové otevření aplikace: přehled seznamů se načte hned ---
        ctxC, c = page_for('a')
        c.wait_for_selector('.list-card:has-text("Potraviny")')
        b.close()
    srv.shutdown()
    if errors:
        print('CHYBY:', errors); sys.exit(1)
    print('e2e: všechno prošlo')


if __name__ == '__main__':
    main()
