import { initAuth, signIn, signOut, getStoredToken, SCOPES } from './auth.js?v=20261109-1930';
import * as G from './google.js?v=20261109-1930';
import { ListStore, newId, nowIso, forgetList } from './store.js?v=20261109-1930';
import { parseItem, formatQty, guessCategory, CATEGORIES, CATEGORY_BY_ID } from './parse.js?v=20261109-1930';

// ---------- Úložiště v prohlížeči ----------
const LS = {
  client: 'nakupnik.clientId', key: 'nakupnik.apiKey', step: 'nakupnik.setupStep',
  last: 'nakupnik.lastList', lists: 'nakupnik.lists', hidden: 'nakupnik.hidden', me: 'nakupnik.me',
};
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  del: k => { try { localStorage.removeItem(k); } catch {} },
  json: (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } },
  setJson: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
// Lhůtník běží na stejné doméně – jeho Client ID se dá použít znovu.
const LHUTNIK_CLIENT = store.get('lhutnik.clientId');

const PUBLIC_URL = 'https://n-yachts.github.io/nakupnik/';
const CONSOLE = 'https://console.cloud.google.com';
const POLL_MS = 15000;

const state = {
  lists: store.json(LS.lists, []),
  hidden: store.json(LS.hidden, []),
  me: store.json(LS.me, {}),
  list: null,          // aktuální seznam {id, name, …}
  data: null,          // ListStore
  editing: null,
  pendingOpen: null,   // ID seznamu z odkazu, ke kterému chybí přístup
};

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const firstName = n => String(n || '').split(/\s+/)[0];

// ---------- Pohledy ----------
const VIEWS = ['file', 'setup', 'signin', 'lists', 'grant', 'list'];
function show(view) {
  for (const v of VIEWS) $(`#view-${v}`).hidden = v !== view;
  $('#btn-settings').hidden = view === 'setup' || view === 'file';
  document.body.dataset.view = view;
}
const current = () => VIEWS.find(v => !$(`#view-${v}`).hidden);
function busy(on) { $('#loading').hidden = !on; }

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg; t.className = `toast ${kind}`;
  try { t.hidePopover(); t.showPopover(); } catch { t.hidden = false; }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { try { t.hidePopover(); } catch { t.hidden = true; } }, kind === 'error' ? 7000 : 2500);
}

// ---------- Průvodce prvním spuštěním ----------
const SETUP = [
  {
    title: 'Vítejte',
    html: () => `
      <h1>Vítejte v Nákupníku</h1>
      <a class="help-card" href="help.html" target="_blank" rel="noopener">
        <span class="hc-icon">📖</span>
        <span><b>Podrobná nápověda s obrázky</b><br>
        <span class="muted">Jak aplikaci nastavit a používat, krok za krokem. Otevře se v nové záložce.</span></span>
      </a>
      <ul class="features">
        <li>🛒 <b>Více nákupních seznamů</b> – potraviny, drogerie, loď…</li>
        <li>👥 <b>Sdílení</b> s rodinou nebo posádkou – každý svým Google účtem</li>
        <li>⚡ <b>Rychlé přidávání</b> i s množstvím: napište „2 l mléko“</li>
        <li>🥬 <b>Řazení podle oddělení</b> v obchodě a <b>často kupované</b> jedním klepnutím</li>
        <li>📶 Funguje i <b>bez signálu</b> – změny se odešlou po připojení</li>
      </ul>
      <p>Seznamy se ukládají do <b>Google Tabulek</b> ve vašem Disku. Aplikace vidí jen tabulky,
         které sama založila nebo které jí ukážete.</p>
      ${LHUTNIK_CLIENT ? `<div class="callout"><b>Máte nastavený Lhůtník.</b> Použijte stejný projekt v Google Cloud –
         stačí povolit tři API a vytvořit API klíč. Client ID se doplní samo.</div>` : ''}
      <p><button type="button" class="ghost small" data-goto="4">Už mám Client ID i API klíč, přeskočit →</button></p>`,
  },
  {
    title: 'Projekt',
    html: () => `
      <h2>1. Projekt v Google Cloud</h2>
      <p><b>Máte projekt z Lhůtníku?</b> Použijte ho – v konzoli ho nahoře vyberte a pokračujte dalším krokem.</p>
      <p>Jinak založte nový:</p>
      <ol>
        <li>Otevřete <a href="${CONSOLE}/projectcreate" target="_blank" rel="noopener">vytvoření projektu</a>.</li>
        <li>Název třeba <code>Nakupnik</code> → <b>Vytvořit</b> a projekt nahoře vyberte.</li>
      </ol>`,
  },
  {
    title: 'API',
    html: () => `
      <h2>2. Povolte tři API</h2>
      <p>U každého odkazu klikněte na <b>Povolit</b> (Enable):</p>
      <ol>
        <li><a href="${CONSOLE}/apis/library/drive.googleapis.com" target="_blank" rel="noopener">Google Drive API</a> – zakládání a sdílení seznamů</li>
        <li><a href="${CONSOLE}/apis/library/sheets.googleapis.com" target="_blank" rel="noopener">Google Sheets API</a> – položky v tabulce</li>
        <li><a href="${CONSOLE}/apis/library/picker.googleapis.com" target="_blank" rel="noopener">Google Picker API</a> – otevření seznamu, který vám někdo nasdílel</li>
      </ol>`,
  },
  {
    title: 'Souhlas',
    html: () => `
      <h2>3. Souhlasová obrazovka</h2>
      <p><b>Projekt z Lhůtníku:</b> tento krok už máte hotový. Volitelně v
         <a href="${CONSOLE}/auth/scopes" target="_blank" rel="noopener">Data access</a> přidejte oprávnění
         <code>${SCOPES[0]}</code>.</p>
      <p><b>Nový projekt:</b></p>
      <ol>
        <li>Otevřete <a href="${CONSOLE}/auth/overview" target="_blank" rel="noopener">Google Auth Platform</a> → <b>Začít</b>.</li>
        <li>Název aplikace <code>Nákupník</code>, e-mail podpory, cílová skupina <b>Externí</b>, dokončete.</li>
        <li>V <a href="${CONSOLE}/auth/audience" target="_blank" rel="noopener">Audience</a> klikněte na <b>Publikovat aplikaci</b>.</li>
      </ol>
      <div class="callout">Bez publikování Google po 7 dnech zruší přihlášení. Lidé, se kterými budete sdílet,
        se pak přihlásí svým účtem a potvrdí varování „Google tuto aplikaci neověřil“.</div>`,
  },
  {
    title: 'Client ID',
    html: () => `
      <h2>4. Client ID</h2>
      <p>${LHUTNIK_CLIENT ? 'Doplnil jsem Client ID z Lhůtníku. ' : ''}V
         <a href="${CONSOLE}/auth/clients" target="_blank" rel="noopener">Clients</a> otevřete svého klienta
         (nebo vytvořte nový typu <b>Webová aplikace</b>) a do <b>Authorized JavaScript origins</b> mějte:</p>
      <ul>
        <li><code>https://n-yachts.github.io</code> (už tam je, pokud používáte Lhůtník)</li>
        <li><code>http://localhost:8081</code> – jen pro spouštění na počítači přes <code>start.cmd</code></li>
      </ul>
      <p class="copyline">Tato stránka běží na <code id="origin-val">${esc(location.origin)}</code>
        <button type="button" class="ghost small" data-copy="#origin-val">Kopírovat</button></p>
      <input id="client-input" class="mono" placeholder="123456789-abc….apps.googleusercontent.com"
             value="${esc(store.get(LS.client) || LHUTNIK_CLIENT || '')}" spellcheck="false" autocomplete="off">
      <p id="client-err" class="error" hidden></p>`,
    validate: () => {
      const v = $('#client-input').value.trim();
      const ok = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(v);
      $('#client-err').hidden = ok;
      $('#client-err').textContent = 'Tohle nevypadá jako Client ID (123456789-xxxx.apps.googleusercontent.com).';
      if (ok) store.set(LS.client, v);
      return ok;
    },
  },
  {
    title: 'API klíč',
    html: () => `
      <h2>5. API klíč pro okno Google Disku</h2>
      <p>Když vám někdo nasdílí seznam, otevřete ho přes okno Google Disku. To potřebuje API klíč:</p>
      <ol>
        <li>Otevřete <a href="${CONSOLE}/apis/credentials" target="_blank" rel="noopener">Credentials</a> →
            <b>Create credentials</b> → <b>API key</b>.</li>
        <li>U klíče klikněte na <b>Edit API key</b> a omezte ho:
          <ul>
            <li><b>Application restrictions:</b> Websites → přidejte <code>https://n-yachts.github.io/*</code>
                a <code>http://localhost:8081/*</code></li>
            <li><b>API restrictions:</b> Restrict key → zaškrtněte <b>Google Picker API</b></li>
          </ul>
          a uložte.</li>
        <li>Zkopírujte klíč (začíná <code>AIza</code>) a vložte ho sem:</li>
      </ol>
      <input id="key-input" class="mono" placeholder="AIza…" value="${esc(store.get(LS.key) || '')}" spellcheck="false" autocomplete="off">
      <p id="key-err" class="error" hidden></p>
      <p class="hint">Klíč je díky omezení použitelný jen z adresy Nákupníku a jen pro okno Disku. Ukládá se jen ve vašem prohlížeči.</p>`,
    validate: () => {
      const v = $('#key-input').value.trim();
      const ok = /^AIza[0-9A-Za-z_\-]{30,}$/.test(v);
      $('#key-err').hidden = ok;
      $('#key-err').textContent = 'API klíč začíná „AIza“ a má 39 znaků.';
      if (ok) store.set(LS.key, v);
      return ok;
    },
  },
  {
    title: 'Hotovo',
    html: () => `
      <h2>6. Přihlaste se</h2>
      <p>Hotovo. Při prvním přihlášení:</p>
      <ol>
        <li>Pokud se objeví „Google tuto aplikaci neověřil“, klikněte na <b>Pokračovat</b>
            (případně <b>Rozšířené</b> → <b>Přejít na …</b>).</li>
        <li>Povolte přístup k souborům Disku, které aplikace používá.</li>
      </ol>`,
    nextLabel: 'Přihlásit se přes Google',
  },
];

let setupIdx = 0;
function renderSetup() {
  const step = SETUP[setupIdx];
  $('#setup-steps').innerHTML = SETUP.map((s, i) =>
    `<span class="step ${i < setupIdx ? 'done' : ''} ${i === setupIdx ? 'current' : ''}">${i < setupIdx ? '✓' : i + 1}<em>${s.title}</em></span>`).join('');
  $('#setup-body').innerHTML = step.html();
  $('#setup-back').style.visibility = setupIdx === 0 ? 'hidden' : 'visible';
  $('#setup-next').textContent = step.nextLabel || 'Pokračovat →';
  store.set(LS.step, String(setupIdx));
}
$('#setup-back').onclick = () => { if (setupIdx > 0) { setupIdx--; renderSetup(); } };
$('#setup-next').onclick = async () => {
  const step = SETUP[setupIdx];
  if (step.validate && !step.validate()) return;
  if (setupIdx < SETUP.length - 1) { setupIdx++; renderSetup(); return; }
  await doSignIn();
};
$('#setup-body').addEventListener('click', e => {
  const b = e.target.closest('[data-goto]');
  if (b) { setupIdx = Number(b.dataset.goto); renderSetup(); }
});
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const text = $(btn.dataset.copy).textContent;
  try { await navigator.clipboard.writeText(text); toast('Zkopírováno'); } catch { toast(text); }
});
document.addEventListener('click', e => {
  if (e.target.matches('[data-close]')) e.target.closest('dialog').close();
});

// ---------- Přihlášení ----------
async function ensureAuth() { if (!getStoredToken()) await signIn(); }

async function doSignIn() {
  try {
    await initAuth(store.get(LS.client));
    await signIn();
    store.del(LS.step);
    await afterSignIn();
  } catch (e) {
    busy(false);
    toast(e.message, 'error');
    if (current() !== 'setup') show('signin');
  }
}
$('#btn-signin').onclick = doSignIn;

async function afterSignIn() {
  G.whoAmI().then(u => { state.me = u; store.setJson(LS.me, u); }).catch(() => {});
  const link = new URLSearchParams(location.search).get('seznam');
  if (link) {
    history.replaceState(null, '', location.pathname);
    await openFromLink(link);
    return;
  }
  const last = store.get(LS.last);
  if (last && state.lists.some(l => l.id === last)) { openList(last); refreshLists(); return; }
  show('lists');
  renderLists();
  await refreshLists(true);
}

function handleError(e) {
  if (e instanceof G.AuthError) {
    toast('Přihlášení vypršelo. Klepněte na „Obnovit přihlášení“.');
    renderSync();
    return;
  }
  console.error(e);
  toast(e.message || String(e), 'error');
}

// ---------- Seznamy ----------
function saveLists() { store.setJson(LS.lists, state.lists); }

async function refreshLists(withBusy = false) {
  if (withBusy) busy(true);
  try {
    const found = await G.listLists();
    state.lists = found.filter(l => !state.hidden.includes(l.id));
    saveLists();
  } catch (e) {
    if (!(e.offline)) handleError(e);
  } finally {
    busy(false);
    if (current() === 'lists') renderLists();
  }
}

function listStats(id) {
  const c = store.json(`nakupnik.cache.${id}`, {});
  const p = store.json(`nakupnik.pending.${id}`, []);
  const tmp = new ListStore(id);
  const items = tmp.items;
  return { left: items.filter(i => !i.done).length, bought: items.filter(i => i.done).length, pending: p.length, known: !!c.syncedAt };
}

function renderLists() {
  if (!state.lists.length) {
    $('#lists').innerHTML = `<div class="empty">
      <p><b>Zatím nemáte žádný seznam.</b></p>
      <p class="muted">Založte první – třeba „Potraviny“. Pokud vám někdo seznam nasdílel, klikněte na
        „Otevřít sdílený“ nebo na odkaz z e-mailu.</p>
      <button class="primary" data-action="new-list">+ Založit první seznam</button></div>`;
    return;
  }
  $('#lists').innerHTML = state.lists.map(l => {
    const s = listStats(l.id);
    const who = l.ownedByMe ? (l.shared ? '👥 sdílený' : '') : `👥 od ${esc(firstName(l.owner) || 'někoho')}`;
    return `<button class="list-card" data-open="${esc(l.id)}">
      <span class="lc-name">${esc(l.name)}</span>
      <span class="lc-meta">${s.known ? (s.left ? `${s.left} ${s.left === 1 ? 'položka' : s.left < 5 ? 'položky' : 'položek'} ke koupi` : '✓ vše koupeno') : 'otevřete pro načtení'}
        ${who ? ` · ${who}` : ''}${s.pending ? ' · ⏳ neodesláno' : ''}</span>
    </button>`;
  }).join('');
}

$('#lists').onclick = e => {
  const b = e.target.closest('[data-open]');
  if (b) openList(b.dataset.open);
};
document.addEventListener('click', e => { if (e.target.closest('[data-action="new-list"]')) openListDialog(null); });
$('#btn-new-list').onclick = () => openListDialog(null);
$('#brand').onclick = e => {
  if (['lists', 'list', 'grant'].includes(current())) { e.preventDefault(); goLists(); }
};
$('#btn-back').onclick = () => goLists();

function goLists() {
  state.list = null; state.data = null;
  store.del(LS.last);
  show('lists');
  renderLists();
  refreshLists();
}

// Nový seznam / přejmenování
const LIST_SUGGEST = ['Potraviny', 'Drogerie', 'Loď', 'Chata', 'Na grilovačku', 'Lékárna'];
let listDlgMode = 'new';
function openListDialog(list) {
  listDlgMode = list ? 'rename' : 'new';
  const f = $('#form-list');
  f.reset();
  $('#list-dlg-title').textContent = list ? 'Přejmenovat seznam' : 'Nový seznam';
  $('#btn-list-save').textContent = list ? 'Uložit' : 'Vytvořit';
  f.name.value = list ? list.name : '';
  $('#list-suggest').innerHTML = list ? '' : LIST_SUGGEST.filter(n => !state.lists.some(l => l.name === n))
    .map(n => `<button type="button" class="chip" data-suggest="${esc(n)}">${esc(n)}</button>`).join('');
  $('#dlg-list').showModal();
  f.name.focus();
}
$('#list-suggest').onclick = e => {
  const b = e.target.closest('[data-suggest]');
  if (b) { $('#form-list').name.value = b.dataset.suggest; $('#form-list').name.focus(); }
};
$('#form-list').onsubmit = async e => {
  e.preventDefault();
  const name = e.target.name.value.trim();
  if (!name) return;
  try { await ensureAuth(); } catch (err) { return toast(err.message, 'error'); }
  busy(true);
  try {
    if (listDlgMode === 'new') {
      const l = await G.createList(name);
      state.lists.push(l);
      state.lists.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
      saveLists();
      $('#dlg-list').close();
      openList(l.id);
      toast('Seznam je připravený');
    } else {
      await G.renameList(state.list.id, name);
      state.list.name = name;
      const l = state.lists.find(x => x.id === state.list.id);
      if (l) l.name = name;
      saveLists();
      $('#dlg-list').close();
      renderList();
      toast('Přejmenováno');
    }
  } catch (err) { handleError(err); }
  finally { busy(false); }
};

// Otevření sdíleného seznamu (Google Picker)
async function pickShared(fileId) {
  const apiKey = store.get(LS.key);
  if (!apiKey) { toast('Chybí API klíč. Doplňte ho v průvodci (Nastavení → Znovu spustit průvodce).', 'error'); return []; }
  const appId = (store.get(LS.client) || '').split('-')[0];
  try { await ensureAuth(); } catch (err) { toast(err.message, 'error'); return []; }
  try {
    return await G.pickLists({ apiKey, appId, fileId });
  } catch (err) { handleError(err); return []; }
}

$('#btn-open-shared').onclick = async () => {
  const ids = await pickShared();
  if (!ids.length) return;
  state.hidden = state.hidden.filter(h => !ids.includes(h)); store.setJson(LS.hidden, state.hidden);
  await refreshLists(true);
  const added = state.lists.filter(l => ids.includes(l.id));
  if (!added.length) return toast('Vybraná tabulka není seznam Nákupníku.', 'error');
  if (added.length === 1) openList(added[0].id);
  else { renderLists(); toast(`Přidáno ${added.length} seznamů`); }
};

async function openFromLink(id) {
  busy(true);
  try {
    const l = await G.getList(id);
    if (!state.lists.some(x => x.id === l.id)) { state.lists.push(l); saveLists(); }
    state.hidden = state.hidden.filter(h => h !== id); store.setJson(LS.hidden, state.hidden);
    busy(false);
    openList(id);
  } catch (e) {
    busy(false);
    if (e instanceof G.NoAccessError) { state.pendingOpen = id; show('grant'); }
    else { handleError(e); show('lists'); renderLists(); }
  }
}
$('#btn-grant').onclick = async () => {
  const id = state.pendingOpen;
  const ids = await pickShared(id);
  if (!ids.length) return;
  state.pendingOpen = null;
  await openFromLink(ids[0]);
};
$('#btn-grant-cancel').onclick = () => { state.pendingOpen = null; goLists(); };

// ---------- Jeden seznam ----------
let pollTimer = null;
function openList(id) {
  const l = state.lists.find(x => x.id === id);
  if (!l) { goLists(); return; }
  state.list = l;
  state.data = new ListStore(id, { onChange: renderList });
  store.set(LS.last, id);
  show('list');
  renderList();
  syncNow();
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (current() === 'list' && document.visibilityState === 'visible' && navigator.onLine && getStoredToken()) syncNow();
  }, POLL_MS);
}

function syncNow() {
  if (!state.data) return;
  if (!getStoredToken()) { renderSync(); return; }
  state.data.sync().catch(e => {
    if (e instanceof G.NoAccessError) {
      toast('K seznamu už nemáte přístup (byl smazán nebo přestal být sdílený).', 'error');
      hideList(state.list.id);
      goLists();
    } else handleError(e);
  });
}

window.addEventListener('online', syncNow);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });

function relTime(iso) {
  if (!iso) return '';
  const s = Math.round((Date.now() - new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).getTime()) / 1000);
  if (s < 30) return 'právě teď';
  if (s < 90) return 'před minutou';
  if (s < 3600) return `před ${Math.round(s / 60)} min`;
  return new Date(iso + 'Z').toLocaleString('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderSync() {
  const d = state.data;
  if (!d) return;
  const n = d.pending.length;
  let html;
  if (!getStoredToken()) html = `<button class="link" id="btn-reauth">🔑 Obnovit přihlášení</button>${n ? ` · ⏳ ${n} neodesláno` : ''}`;
  else if (d.status === 'offline') html = `📶 Offline${n ? ` · ⏳ ${n} ${n === 1 ? 'změna čeká' : 'změn čeká'}` : ''}`;
  else if (d.status === 'syncing') html = '⟳ Ukládám…';
  else if (d.status === 'error') html = `⚠️ ${esc(d.error)}`;
  else html = `✓ Uloženo${d.syncedAt ? ` · ${relTime(d.syncedAt)}` : ''}`;
  $('#sync').innerHTML = html;
  $('#sync').dataset.status = getStoredToken() ? d.status : 'auth';
}
$('#sync').addEventListener('click', async e => {
  if (!e.target.closest('#btn-reauth')) return;
  try { await signIn(); syncNow(); } catch (err) { toast(err.message, 'error'); }
});

function renderList() {
  const d = state.data, l = state.list;
  if (!d || !l) return;
  $('#list-name').textContent = l.name;
  renderSync();

  const items = d.items;
  const open = items.filter(i => !i.done);
  const done = items.filter(i => i.done);
  const shared = l.shared || !l.ownedByMe;
  const me = firstName(state.me.displayName);

  // Našeptávač a často kupované
  const onList = new Set(open.map(i => i.name.toLowerCase()));
  const hist = [...d.history].sort((a, b) => b.count - a.count || String(b.last).localeCompare(String(a.last)));
  $('#history-list').innerHTML = hist.map(h => `<option value="${esc(h.name)}">`).join('');
  const freq = hist.filter(h => !onList.has(h.name.toLowerCase())).slice(0, 12);
  $('#frequent').innerHTML = freq.length
    ? `<span class="hint">Často kupujete:</span>` + freq.map(h => `<button class="chip small" data-quick="${esc(h.name)}">+ ${esc(h.name)}</button>`).join('')
    : '';

  // Položky podle oddělení (v pořadí průchodu obchodem)
  if (!items.length) {
    $('#items').innerHTML = `<div class="empty"><p><b>Seznam je prázdný.</b></p>
      <p class="muted">Napište nahoru, co chcete koupit – třeba „2 l mléko“ nebo „rohlíky 10“ – a stiskněte Enter.</p></div>`;
  } else if (!open.length) {
    $('#items').innerHTML = `<div class="empty done-all"><p>🎉 <b>Vše je v košíku.</b></p></div>`;
  } else {
    const groups = new Map();
    for (const i of open) {
      const c = CATEGORY_BY_ID[i.cat] ? i.cat : 'ostatni';
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c).push(i);
    }
    $('#items').innerHTML = [...groups.entries()]
      .sort(([a], [b]) => CATEGORY_BY_ID[a].order - CATEGORY_BY_ID[b].order)
      .map(([c, list]) => `
        <h3 class="cat">${CATEGORY_BY_ID[c].icon} ${CATEGORY_BY_ID[c].label}</h3>
        <ul class="item-list">${list.sort((a, b) => a.name.localeCompare(b.name, 'cs')).map(i => itemRow(i, shared, me)).join('')}</ul>`)
      .join('');
  }
  $('#bought').innerHTML = done.length ? `
    <details ${done.length <= 5 ? 'open' : ''}>
      <summary>🧺 V košíku (${done.length})</summary>
      <ul class="item-list">${done.sort((a, b) => a.name.localeCompare(b.name, 'cs')).map(i => itemRow(i, shared, me)).join('')}</ul>
      <button class="ghost small" id="btn-clear">Smazat koupené ze seznamu</button>
    </details>` : '';
}

function itemRow(i, shared, me) {
  const qty = formatQty(i.qty, i.unit);
  const by = shared && i.by && i.by !== me ? `<span class="by">${esc(i.by)}</span>` : '';
  return `<li class="item ${i.done ? 'done' : ''}" data-id="${esc(i.id)}">
    <button class="check" data-toggle="${esc(i.id)}" aria-pressed="${i.done}" aria-label="${i.done ? 'Vrátit do seznamu' : 'Koupeno'}: ${esc(i.name)}"></button>
    <button class="it-body" data-edit="${esc(i.id)}">
      <span class="it-name">${esc(i.name)}</span>
      ${qty ? `<span class="qty">${esc(qty)}</span>` : ''}
      ${i.note ? `<span class="it-note">${esc(i.note)}</span>` : ''}
      ${by}
    </button>
  </li>`;
}

// Přidávání
function addText(text) {
  const d = state.data;
  const p = parseItem(text);
  if (!p.name) return;
  const existing = d.items.find(i => i.name.toLowerCase() === p.name.toLowerCase());
  const hist = d.history.find(h => h.name.toLowerCase() === p.name.toLowerCase());
  if (existing) {
    // Stejná položka už je na seznamu – jen ji vrátíme / upravíme množství.
    d.update({ ...existing, done: false, qty: p.qty || existing.qty, unit: p.qty ? p.unit : existing.unit });
    toast(existing.done ? `${existing.name} – vráceno do seznamu` : `${existing.name} – už na seznamu je${p.qty ? ', množství upraveno' : ''}`);
    return;
  }
  d.add({
    id: newId(), name: p.name, qty: p.qty, unit: p.qty ? p.unit : (hist?.unit && p.qty ? hist.unit : ''),
    cat: hist?.cat || guessCategory(p.name), done: false, note: '',
    by: firstName(state.me.displayName), changed: nowIso(),
  });
}
$('#add-form').onsubmit = e => {
  e.preventDefault();
  const input = $('#add-input');
  addText(input.value);
  input.value = '';
  input.focus();
};
$('#frequent').onclick = e => {
  const b = e.target.closest('[data-quick]');
  if (b) addText(b.dataset.quick);
};

// Odškrtávání a úpravy
$('#view-list').addEventListener('click', e => {
  const t = e.target.closest('[data-toggle]');
  if (t) {
    const it = state.data.items.find(i => i.id === t.dataset.toggle);
    if (it) {
      if (navigator.vibrate) navigator.vibrate(15);
      state.data.update({ ...it, done: !it.done });
    }
    return;
  }
  const ed = e.target.closest('[data-edit]');
  if (ed) { openItem(ed.dataset.edit); return; }
  if (e.target.closest('#btn-clear')) clearBought();
});

function clearBought() {
  const ids = state.data.items.filter(i => i.done).map(i => i.id);
  if (!ids.length) return;
  state.data.remove(ids);
  toast(`Smazáno ${ids.length} koupených položek`);
}

$('#cat-select').innerHTML = CATEGORIES.map(c => `<option value="${c.id}">${c.icon} ${c.label}</option>`).join('');
function openItem(id) {
  const it = state.data.items.find(i => i.id === id);
  if (!it) return;
  state.editing = it;
  const f = $('#form-item');
  f.name.value = it.name; f.qty.value = it.qty; f.unit.value = it.unit || '';
  f.cat.value = CATEGORY_BY_ID[it.cat] ? it.cat : 'ostatni'; f.note.value = it.note || '';
  $('#item-meta').textContent = it.by ? `Přidal(a) ${it.by}${it.changed ? ` · změněno ${relTime(it.changed)}` : ''}` : '';
  delete $('#btn-item-delete').dataset.confirm; $('#btn-item-delete').textContent = 'Smazat';
  $('#dlg-item').showModal();
}
$('#form-item').onsubmit = e => {
  e.preventDefault();
  const f = e.target, it = state.editing;
  if (!it) return;
  const name = f.name.value.trim();
  if (!name) return;
  state.data.update({ ...it, name, qty: f.qty.value.trim().replace('.', ','), unit: f.qty.value.trim() ? f.unit.value || 'ks' : f.unit.value, cat: f.cat.value, note: f.note.value.trim() });
  if (f.cat.value !== it.cat) state.data.rememberCategory(name, f.cat.value);
  $('#dlg-item').close();
};
$('#btn-item-delete').onclick = () => {
  const b = $('#btn-item-delete');
  if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; b.textContent = 'Opravdu smazat?'; return; }
  state.data.remove([state.editing.id]);
  $('#dlg-item').close();
};

// Menu seznamu
$('#btn-list-menu').onclick = () => {
  const l = state.list;
  $('#menu-title').textContent = l.name;
  $('#m-delete').textContent = l.ownedByMe ? '🗑️ Smazat seznam' : '🙈 Odebrat z mých seznamů';
  delete $('#m-delete').dataset.confirm;
  $('#dlg-menu').showModal();
};
$('#m-rename').onclick = () => { $('#dlg-menu').close(); openListDialog(state.list); };
$('#m-sheet').onclick = () => window.open(`https://docs.google.com/spreadsheets/d/${state.list.id}/edit`, '_blank', 'noopener');
$('#m-clear').onclick = () => { $('#dlg-menu').close(); clearBought(); };
$('#m-delete').onclick = async () => {
  const b = $('#m-delete'), l = state.list;
  if (b.dataset.confirm !== '1') {
    b.dataset.confirm = '1';
    b.textContent = l.ownedByMe ? 'Opravdu smazat? (i pro ty, se kterými sdílíte)' : 'Opravdu odebrat?';
    return;
  }
  if (l.ownedByMe) {
    try { await ensureAuth(); } catch (err) { return toast(err.message, 'error'); }
    busy(true);
    try { await G.trashList(l.id); } catch (err) { busy(false); return handleError(err); }
    busy(false);
    toast('Seznam je v koši Google Disku');
  } else toast('Seznam odebrán z vašeho přehledu');
  $('#dlg-menu').close();
  hideList(l.id);
  goLists();
};
function hideList(id) {
  state.lists = state.lists.filter(x => x.id !== id); saveLists();
  if (!state.hidden.includes(id)) { state.hidden.push(id); store.setJson(LS.hidden, state.hidden); }
  forgetList(id);
}

// Sdílení
function shareLink(id) { return `${location.origin}${location.pathname}?seznam=${encodeURIComponent(id)}`; }
async function renderPeople() {
  $('#people').innerHTML = '<li class="muted">Načítám…</li>';
  try {
    const people = await G.listPeople(state.list.id);
    const canEdit = state.list.ownedByMe;
    $('#people').innerHTML = people.map(p => `<li>
      <span><b>${esc(p.displayName || p.emailAddress)}</b> <span class="muted">${esc(p.emailAddress || '')}</span></span>
      <span class="role">${p.role === 'owner' ? 'vlastník' : 'může upravovat'}</span>
      ${canEdit && p.role !== 'owner' ? `<button type="button" class="ghost small" data-unshare="${esc(p.id)}">Odebrat</button>` : ''}
    </li>`).join('') || '<li class="muted">Zatím jen vy.</li>';
  } catch (e) {
    $('#people').innerHTML = `<li class="muted">Seznam lidí se nepodařilo načíst${e.offline ? ' (offline)' : ''}.</li>`;
  }
}
$('#btn-share').onclick = async () => {
  $('#form-share').reset();
  $('#share-link').textContent = shareLink(state.list.id);
  $('#dlg-share').showModal();
  try { await ensureAuth(); } catch (err) { return toast(err.message, 'error'); }
  renderPeople();
};
$('#btn-copy-link').onclick = async () => {
  try { await navigator.clipboard.writeText($('#share-link').textContent); toast('Odkaz zkopírován'); } catch { toast($('#share-link').textContent); }
};
$('#form-share').onsubmit = async e => {
  e.preventDefault();
  const email = e.target.email.value.trim();
  if (!email) return;
  try { await ensureAuth(); } catch (err) { return toast(err.message, 'error'); }
  busy(true);
  try {
    await G.shareList(state.list.id, email, shareLink(state.list.id), state.list.name);
    state.list.shared = true; saveLists();
    e.target.reset();
    toast(`Sdíleno s ${email}. Přijde mu e-mail s odkazem.`);
    renderPeople();
  } catch (err) { handleError(err); }
  finally { busy(false); }
};
$('#people').onclick = async e => {
  const b = e.target.closest('[data-unshare]');
  if (!b) return;
  try { await ensureAuth(); } catch (err) { return toast(err.message, 'error'); }
  try { await G.unshare(state.list.id, b.dataset.unshare); toast('Přístup odebrán'); renderPeople(); }
  catch (err) { handleError(err); }
};

// ---------- Nastavení ----------
$('#btn-settings').onclick = () => {
  $('#set-user').textContent = state.me.displayName ? `${state.me.displayName} (${state.me.emailAddress || ''})` : '—';
  $('#set-client').textContent = store.get(LS.client) || '—';
  const k = store.get(LS.key);
  $('#set-key').textContent = k ? `${k.slice(0, 8)}…${k.slice(-4)}` : '—';
  $('#set-origin').textContent = location.origin;
  $('#set-ver').textContent = new URL(import.meta.url).searchParams.get('v') || 'vývojová';
  updateInstallUi();
  $('#dlg-settings').showModal();
};
$('#btn-signout').onclick = async () => {
  await signOut();
  $('#dlg-settings').close();
  show('signin');
  toast('Odhlášeno');
};
$('#btn-reset').onclick = async () => {
  await signOut();
  $('#dlg-settings').close();
  setupIdx = 0;
  show('setup'); renderSetup();
};

// ---------- Instalace jako aplikace (PWA) ----------
let installPrompt = null;
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
function updateInstallUi() {
  const can = !!installPrompt && !isStandalone();
  $('#btn-install').hidden = !can;
  $('#btn-install-top').hidden = !can;
  $('#install-info').innerHTML = isStandalone()
    ? '✓ Nákupník běží jako nainstalovaná aplikace.'
    : can ? 'Nainstalujte si Nákupník jako aplikaci: ikona na ploše, spuštění na celou obrazovku.'
      : isIOS() ? 'Na iPhonu: v Safari <b>Sdílet</b> → <b>Přidat na plochu</b>.'
        : 'V Chromu na Androidu: menu <b>⋮</b> → <b>Nainstalovat aplikaci</b>. Na počítači: ikona instalace v adresním řádku.';
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; updateInstallUi(); });
window.addEventListener('appinstalled', () => { installPrompt = null; updateInstallUi(); toast('Nákupník je nainstalovaný ✓'); });
async function doInstall() {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => null);
  installPrompt = null; updateInstallUi();
}
$('#btn-install').onclick = doInstall;
$('#btn-install-top').onclick = doInstall;
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Service worker:', err)));
}

// ---------- Start ----------
async function start() {
  if (location.protocol === 'file:') return show('file');
  const clientId = store.get(LS.client);
  if (!clientId || !store.get(LS.key)) {
    setupIdx = Math.min(Number(store.get(LS.step) || 0), SETUP.length - 1);
    show('setup'); renderSetup();
    return;
  }
  try { await initAuth(clientId); } catch (e) { toast(e.message, 'error'); }
  if (getStoredToken()) { await afterSignIn(); return; }
  // Bez přihlášení: když máme seznam v mezipaměti, ukážeme ho hned (offline, nákup v obchodě).
  const last = store.get(LS.last);
  if (last && state.lists.some(l => l.id === last) && !new URLSearchParams(location.search).get('seznam')) {
    openList(last);
    toast('Seznam z paměti telefonu. Pro uložení změn se přihlaste.');
  } else show('signin');
}
start();
