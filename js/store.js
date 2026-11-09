// Stav jednoho seznamu: data z tabulky + fronta změn, které ještě nedošly do Googlu.
// Změny se ukazují hned (optimisticky) a odesílají se postupně; bez signálu čekají
// v localStorage a odešlou se po připojení. Při souběžné úpravě vyhrává poslední zápis.
import * as G from './google.js?v=20261109-1930';

const KEY = { cache: id => `nakupnik.cache.${id}`, pending: id => `nakupnik.pending.${id}` };
const load = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const nowIso = () => new Date().toISOString().slice(0, 19);
export const todayIso = () => new Date().toISOString().slice(0, 10);

export class ListStore {
  constructor(listId, { onChange } = {}) {
    this.id = listId;
    this.onChange = onChange || (() => {});
    const c = load(KEY.cache(listId), {});
    this.server = c.items || [];
    this.history = c.history || [];
    this.syncedAt = c.syncedAt || '';
    this.pending = load(KEY.pending(listId), []);
    this.status = 'idle';     // idle | syncing | offline | error
    this.error = '';
    this.busy = false;
  }

  /** Položky tak, jak je vidí uživatel: data z Googlu + neodeslané změny. */
  get items() {
    let list = this.server.map(i => ({ ...i }));
    for (const op of this.pending) list = applyOp(list, op);
    return list;
  }

  persist() {
    save(KEY.cache(this.id), { items: this.server, history: this.history, syncedAt: this.syncedAt });
    save(KEY.pending(this.id), this.pending);
  }

  queue(op) {
    this.pending.push(op);
    if (op.op === 'add') bumpLocalHistory(this.history, op.item);
    if (op.op === 'hist') {
      const h = this.history.find(x => x.name.trim().toLowerCase() === op.name.trim().toLowerCase());
      if (h) h.cat = op.cat;
    }
    this.persist();
    this.onChange();
    this.sync();
  }

  add(item) { this.queue({ op: 'add', item }); }
  update(item) { this.queue({ op: 'set', item: { ...item, changed: nowIso() } }); }
  remove(ids) { this.queue({ op: 'del', ids }); }
  /** Zapamatuje si oddělení položky pro příští přidání. */
  rememberCategory(name, cat) { this.queue({ op: 'hist', name, cat }); }

  /** Odešle frontu a načte aktuální stav. Bezpečné volat kdykoli (souběh se ignoruje). */
  async sync() {
    if (this.busy) { this.again = true; return; }
    this.busy = true;
    this.status = 'syncing'; this.onChange();
    try {
      do {
        this.again = false;
        await this.flush();
        const data = await G.readList(this.id);
        this.server = data.items;
        this.history = data.history;
        this.syncedAt = nowIso();
        this.persist();
      } while (this.again);
      this.status = 'idle'; this.error = '';
    } catch (e) {
      if (e instanceof G.AuthError || e instanceof G.NoAccessError) { this.status = 'error'; this.error = e.message; this.busy = false; this.onChange(); throw e; }
      this.status = e.offline || !navigator.onLine ? 'offline' : 'error';
      this.error = e.message;
    } finally {
      this.busy = false;
      this.onChange();
    }
  }

  async flush() {
    while (this.pending.length) {
      const op = this.pending[0];
      if (op.op === 'add') {
        await G.appendItem(this.id, op.item);
        try { await G.bumpHistory(this.id, op.item, todayIso()); } catch (e) { if (e.offline) throw e; }
      } else if (op.op === 'set') {
        await G.updateItem(this.id, op.item);   // položku mezitím někdo smazal → nic se neděje
      } else if (op.op === 'del') {
        await G.deleteItems(this.id, op.ids);
      } else if (op.op === 'hist') {
        try { await G.setHistoryCategory(this.id, op.name, op.cat); } catch (e) { if (e.offline) throw e; }
      }
      this.pending.shift();
      this.persist();
    }
  }
}

function applyOp(list, op) {
  if (op.op === 'add') return list.some(i => i.id === op.item.id) ? list : [...list, { ...op.item }];
  if (op.op === 'set') return list.map(i => (i.id === op.item.id ? { ...op.item } : i));
  if (op.op === 'del') return list.filter(i => !op.ids.includes(i.id));
  return list;
}

function bumpLocalHistory(history, item) {
  const key = item.name.trim().toLowerCase();
  const h = history.find(x => x.name.trim().toLowerCase() === key);
  if (h) { h.count += 1; h.last = todayIso(); h.cat = item.cat; if (item.unit) h.unit = item.unit; }
  else history.push({ name: item.name, cat: item.cat, unit: item.unit || '', count: 1, last: todayIso() });
}

/** Smaže uložená data seznamu z prohlížeče (např. když se seznam odebere). */
export function forgetList(id) {
  try { localStorage.removeItem(KEY.cache(id)); localStorage.removeItem(KEY.pending(id)); } catch {}
}
