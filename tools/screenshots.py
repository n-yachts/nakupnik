"""
Vytvoří náhledy obrazovek pro nápovědu (help/img/*.png) proti napodobenému Googlu
(tools/fakegoogle.py) s ukázkovými daty. Slouží zároveň jako rychlý smoke test.

    pip install playwright && playwright install chromium
    python tools/screenshots.py
"""
import functools, http.server, os, socketserver, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
from fakegoogle import FakeGoogle  # noqa: E402

OUT = os.path.join(ROOT, 'help', 'img')
PORT = 8081  # stejná adresa jako start.cmd, ať průvodce ukazuje správný origin
CLIENT = '123456789012-ukazka0example0abcdefghijkl.apps.googleusercontent.com'
KEY = 'AIzaSyUKAZKA0123456789abcdefghijklmnopq'
FIXED_NOW = '2026-11-09T17:00:00+01:00'
ITEMS = ['2 l mléko', 'rohlíky 10', 'banány', '1 kg brambory', 'máslo', 'kuřecí prsa 500 g', '3x jogurt',
         'těstoviny', 'minerálka 6 l', 'zubní pasta', 'prášek na praní', 'čokoláda']


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass


def main():
    os.makedirs(OUT, exist_ok=True)
    socketserver.TCPServer.allow_reuse_address = True
    srv = socketserver.TCPServer(('127.0.0.1', PORT), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://localhost:{PORT}/'
    g = FakeGoogle()

    with sync_playwright() as p:
        b = p.chromium.launch()

        def new(user='a', w=420, h=860, scheme='light'):
            ctx = b.new_context(viewport={'width': w, 'height': h}, locale='cs-CZ', timezone_id='Europe/Prague',
                                color_scheme=scheme, service_workers='block')
            pg = ctx.new_page()
            pg.clock.set_fixed_time(FIXED_NOW)
            g.install(pg)
            pg.add_init_script(f"window.__fakeUser = '{user}';")
            return ctx, pg

        def shot(pg, name, top=True, **kw):
            pg.mouse.move(1, 1)
            # bez oznámení, kurzoru v poli a posunu stránky – ať jsou snímky čisté
            pg.evaluate("(top) => { try { document.querySelector('#toast').hidePopover(); } catch {} "
                        "if (!document.querySelector('dialog[open]')) document.activeElement?.blur(); if (top) scrollTo(0, 0); }", top)
            pg.wait_for_timeout(200)
            pg.screenshot(path=os.path.join(OUT, name + '.png'), **kw)
            print('  ', name)

        def synced(pg):
            pg.wait_for_function("document.querySelector('#sync').textContent.includes('Uloženo')")

        # --- Průvodce (počítač) ---
        ctx, pg = new(w=1000, h=820)
        pg.goto(base)
        pg.evaluate(f"localStorage.setItem('nakupnik.clientId', '{CLIENT}')")
        pg.reload()
        shot(pg, 'pruvodce-uvod')
        for _ in range(2): pg.click('#setup-next')
        shot(pg, 'pruvodce-api')
        for _ in range(3): pg.click('#setup-next')
        pg.fill('#key-input', KEY)
        shot(pg, 'pruvodce-klic', full_page=True)
        pg.click('#setup-next')
        pg.click('#setup-next')                       # přihlášení
        pg.wait_for_selector('#view-lists:not([hidden])')
        ctx.close()

        # --- Telefon: seznamy a nákup ---
        ctx, pg = new()
        pg.goto(base)
        pg.evaluate(f"localStorage.setItem('nakupnik.clientId','{CLIENT}'); localStorage.setItem('nakupnik.apiKey','{KEY}')")
        pg.reload()
        pg.click('#btn-signin')
        pg.wait_for_selector('#view-lists:not([hidden])')
        shot(pg, 'seznamy-prazdne')
        pg.click('#btn-new-list')
        shot(pg, 'novy-seznam')
        pg.fill('#form-list [name=name]', 'Potraviny'); pg.click('#btn-list-save')
        pg.wait_for_selector('#view-list:not([hidden])')
        for t in ITEMS:
            pg.fill('#add-input', t); pg.press('#add-input', 'Enter')
        synced(pg)
        # druhý seznam a historie pro „Často kupujete“
        for t in ['Banány', 'Čokoláda']:
            pg.click(f'.item:has-text("{t}") .check')
        synced(pg)
        pg.click('#btn-clear'); synced(pg)
        for t in ['banány', 'pivo']:
            pg.fill('#add-input', t); pg.press('#add-input', 'Enter')
        pg.click('.item:has-text("Pivo") .check')
        synced(pg)
        pg.fill('#add-input', '')
        shot(pg, 'seznam')
        pg.click('.item:has-text("Rohlíky") .check'); pg.click('.item:has-text("Máslo") .check')
        synced(pg)
        shot(pg, 'seznam-nakup', full_page=True)
        pg.click('[data-edit]:has-text("Kuřecí prsa")')
        pg.fill('#form-item [name=note]', 'bio, z pultu')
        shot(pg, 'uprava-polozky')
        pg.click('#form-item [type=submit]'); synced(pg)
        pg.click('#btn-share')
        pg.fill('#form-share [name=email]', 'jana@example.com'); pg.click('#form-share [type=submit]')
        pg.wait_for_selector('#people li:has-text("Jana")')
        shot(pg, 'sdileni')
        link = pg.inner_text('#share-link')
        pg.click('#dlg-share [data-close]')
        pg.click('#btn-list-menu'); shot(pg, 'menu'); pg.keyboard.press('Escape')
        pg.click('#btn-back')
        pg.click('#btn-new-list'); pg.fill('#form-list [name=name]', 'Loď'); pg.click('#btn-list-save')
        pg.wait_for_selector('#view-list:not([hidden])')
        for t in ['2 bal kávy', 'voda 12 l', 'baterie AA', 'opalovací krém']:
            pg.fill('#add-input', t); pg.press('#add-input', 'Enter')
        synced(pg)
        pg.click('#btn-back'); pg.wait_for_timeout(300)
        shot(pg, 'seznamy')
        pg.click('#btn-settings'); shot(pg, 'nastaveni'); pg.keyboard.press('Escape')

        # --- Druhý uživatel: odkaz → zpřístupnění ---
        ctx2, pb = new('b')
        pb.goto(base)
        pb.evaluate(f"localStorage.setItem('nakupnik.clientId','{CLIENT}'); localStorage.setItem('nakupnik.apiKey','{KEY}'); window.__pickId='sheet1'")
        pb.goto(link)
        pb.click('#btn-signin')
        pb.wait_for_selector('#view-grant:not([hidden])')
        shot(pb, 'zpristupneni')
        pb.evaluate("window.__pickId='sheet1'")
        pb.click('#btn-grant')
        pb.wait_for_selector('#view-list:not([hidden])')
        pb.fill('#add-input', 'chleba'); pb.press('#add-input', 'Enter'); synced(pb)
        g.offline.add('b'); ctx2.set_offline(True)
        pb.fill('#add-input', 'vejce 10'); pb.press('#add-input', 'Enter')
        pb.wait_for_function("document.querySelector('#sync').textContent.includes('Offline')")
        shot(pb, 'offline')
        g.offline.discard('b'); ctx2.set_offline(False)

        # --- Tmavý režim a počítač ---
        ctx3, pd = new(w=1000, h=820, scheme='dark')
        pd.goto(base)
        pd.evaluate(f"localStorage.setItem('nakupnik.clientId','{CLIENT}'); localStorage.setItem('nakupnik.apiKey','{KEY}')")
        pd.reload(); pd.click('#btn-signin')
        pd.wait_for_selector('#view-lists:not([hidden])')
        pd.click('.list-card:has-text("Potraviny")')
        synced(pd)
        shot(pd, 'pocitac-tmavy')
        b.close()
    srv.shutdown()
    print('Hotovo:', OUT)


if __name__ == '__main__':
    main()
