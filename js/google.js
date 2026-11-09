// Volání Google Drive API v3, Sheets API v4 a Google Pickeru.
// Oprávnění je jen drive.file: aplikace vidí jen tabulky, které sama založila,
// nebo které jí uživatel ukázal v okně Google Disku (Picker).
import { getStoredToken, clearToken } from './auth.js?v=20261109-2045';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
export const APP_PROP = 'nakupnik';          // značka v appProperties souboru
export const TITLE_PREFIX = 'Nákupník – ';
export const ITEMS_SHEET = 'Položky';
export const HISTORY_SHEET = 'Historie';
export const ITEM_COLUMNS = ['id', 'položka', 'množství', 'jednotka', 'kategorie', 'koupeno', 'poznámka', 'přidal', 'změněno'];
export const HISTORY_COLUMNS = ['položka', 'kategorie', 'jednotka', 'počet', 'naposledy'];

export class AuthError extends Error {}
export class NoAccessError extends Error {}   // soubor existuje, ale aplikace k němu nemá přístup

async function call(url, { method = 'GET', body, query } = {}) {
  const token = getStoredToken();
  if (!token) throw new AuthError('Přihlášení vypršelo.');
  const u = new URL(url);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) u.searchParams.set(k, v);
  let res;
  try {
    res = await fetch(u, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const e = new Error('Bez připojení k internetu.');
    e.offline = true;
    throw e;
  }
  if (res.status === 401) { clearToken(); throw new AuthError('Přihlášení vypršelo.'); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || res.statusText;
    const reasons = [
      ...(data?.error?.errors || []).map(e => e.reason),
      ...(data?.error?.details || []).map(d => d.reason),
    ].filter(Boolean);
    // API není v Google Cloud povolené – nastavení, ne chybějící přístup k seznamu.
    if (reasons.includes('SERVICE_DISABLED') || reasons.includes('accessNotConfigured') || /has not been used in project|is disabled/i.test(msg)) {
      const api = /sheets/i.test(msg) ? 'Google Sheets API' : /picker/i.test(msg) ? 'Google Picker API' : 'Google Drive API';
      const project = (msg.match(/project (\d+)/) || [])[1];
      const err = new Error(`V Google Cloud není povolené ${api}${project ? ` (projekt ${project})` : ''}. Povolte ho a za pár minut to zkuste znovu – viz Nápověda, krok 2.`);
      err.status = res.status; err.setup = true;
      throw err;
    }
    // Překročené limity – zkusit později, nic se nemaže.
    if (res.status === 429 || reasons.some(r => /rateLimit|quota/i.test(r))) {
      const err = new Error('Google teď hlásí příliš mnoho požadavků. Zkuste to za chvíli.');
      err.status = res.status; err.offline = true;   // chovat se jako výpadek: změny počkají
      throw err;
    }
    if (res.status === 404 || res.status === 403) throw new NoAccessError(msg);
    const err = new Error(`Google: ${msg}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const q = name => `'${name.replace(/'/g, "''")}'`;   // název listu v A1 zápisu

// ---------- Seznamy (soubory) ----------

const FOLDER_NAME = 'Nákupník';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
let folderId = null;   // složka „Nákupník“ v Můj disk (hledá se jednou za běh aplikace)

/** Najde (případně založí) složku Nákupník. Hledá se podle značky, takže přejmenování nevadí. */
export async function appFolder() {
  if (folderId) return folderId;
  const res = await call(`${DRIVE}/files`, {
    query: {
      q: `appProperties has { key='${APP_PROP}' and value='folder' } and mimeType='${FOLDER_MIME}' and trashed=false`,
      fields: 'files(id)', pageSize: 10,
    },
  });
  folderId = res.files?.[0]?.id || (await call(`${DRIVE}/files`, {
    method: 'POST', query: { fields: 'id' },
    body: { name: FOLDER_NAME, mimeType: FOLDER_MIME, appProperties: { [APP_PROP]: 'folder' } },
  })).id;
  return folderId;
}

export async function listLists() {
  const res = await call(`${DRIVE}/files`, {
    query: {
      q: `appProperties has { key='${APP_PROP}' and value='1' } and trashed=false`,
      fields: 'files(id,name,ownedByMe,shared,modifiedTime,owners(displayName,emailAddress),parents,appProperties)',
      orderBy: 'name', pageSize: 200,
    },
  });
  const files = res.files || [];
  moveOldLists(files).catch(e => console.warn('Přesun do složky Nákupník:', e));
  return files.map(fileToList);
}

let moveTried = false;
/** Vlastní seznamy z dřívějších verzí (založené v kořeni Disku) jednou přesune do složky Nákupník.
 *  Přesunuté se označí (appProperties.nakupnikFolder), takže seznam, který si uživatel
 *  později sám přesune jinam, už aplikace nechá být. Cizí (sdílené) seznamy přesouvat nelze. */
async function moveOldLists(files) {
  const todo = files.filter(f => f.ownedByMe !== false && !f.appProperties?.nakupnikFolder);
  if (moveTried || !todo.length) return;
  moveTried = true;
  const folder = await appFolder();
  for (const f of todo) {
    const from = (f.parents || []).filter(p => p !== folder).join(',');
    await call(`${DRIVE}/files/${encodeURIComponent(f.id)}`, {
      method: 'PATCH',
      query: { addParents: folder, ...(from ? { removeParents: from } : {}), fields: 'id' },
      body: { appProperties: { nakupnikFolder: '1' } },
    });
  }
}

export async function getList(id) {
  const f = await call(`${DRIVE}/files/${encodeURIComponent(id)}`, {
    query: { fields: 'id,name,ownedByMe,shared,modifiedTime,owners(displayName,emailAddress),appProperties,trashed' },
  });
  return fileToList(f);
}

function fileToList(f) {
  return {
    id: f.id,
    name: f.name.startsWith(TITLE_PREFIX) ? f.name.slice(TITLE_PREFIX.length) : f.name,
    ownedByMe: f.ownedByMe !== false,
    shared: !!f.shared,
    owner: f.owners?.[0]?.displayName || '',
    modified: f.modifiedTime || '',
  };
}

/** Založí novou tabulku se dvěma listy a záhlavím. */
export async function createList(name) {
  let folder = null;
  try { folder = await appFolder(); } catch (e) {
    if (e instanceof AuthError || e.offline || e.setup) throw e;
    console.warn('Složka Nákupník:', e);   // když se nepovede, seznam vznikne v kořeni Disku
  }
  const file = await call(`${DRIVE}/files`, {
    method: 'POST',
    query: { fields: 'id,name,ownedByMe,shared,modifiedTime,owners(displayName,emailAddress)' },
    body: {
      name: TITLE_PREFIX + name, mimeType: 'application/vnd.google-apps.spreadsheet',
      appProperties: { [APP_PROP]: '1', nakupnikFolder: '1' },
      ...(folder ? { parents: [folder] } : {}),
    },
  });
  const meta = await call(`${SHEETS}/${file.id}`, { query: { fields: 'sheets.properties(sheetId,title)' } });
  const firstId = meta.sheets[0].properties.sheetId;
  await call(`${SHEETS}/${file.id}:batchUpdate`, {
    method: 'POST',
    body: {
      requests: [
        { updateSheetProperties: { properties: { sheetId: firstId, title: ITEMS_SHEET, gridProperties: { frozenRowCount: 1 } }, fields: 'title,gridProperties.frozenRowCount' } },
        { addSheet: { properties: { title: HISTORY_SHEET, gridProperties: { frozenRowCount: 1 } } } },
        { repeatCell: { range: { sheetId: firstId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat.bold' } },
      ],
    },
  });
  await call(`${SHEETS}/${file.id}/values:batchUpdate`, {
    method: 'POST',
    body: {
      valueInputOption: 'RAW',
      data: [
        { range: `${q(ITEMS_SHEET)}!A1`, values: [ITEM_COLUMNS] },
        { range: `${q(HISTORY_SHEET)}!A1`, values: [HISTORY_COLUMNS] },
      ],
    },
  });
  return fileToList(file);
}

export async function renameList(id, name) {
  await call(`${DRIVE}/files/${encodeURIComponent(id)}`, { method: 'PATCH', body: { name: TITLE_PREFIX + name } });
}

/** Vlastník seznam smaže (do koše Disku); ostatní se musí jen odebrat ze svého přehledu. */
export async function trashList(id) {
  await call(`${DRIVE}/files/${encodeURIComponent(id)}`, { method: 'PATCH', body: { trashed: true } });
}

// ---------- Sdílení ----------

export async function listPeople(id) {
  const res = await call(`${DRIVE}/files/${encodeURIComponent(id)}/permissions`, {
    query: { fields: 'permissions(id,type,role,emailAddress,displayName)' },
  });
  return (res.permissions || []).filter(p => p.type === 'user');
}

export async function shareList(id, email, appUrl, listName) {
  const message = `Sdílím s tebou nákupní seznam „${listName}“. Otevři ho v aplikaci Nákupník: ${appUrl}`;
  await call(`${DRIVE}/files/${encodeURIComponent(id)}/permissions`, {
    method: 'POST',
    query: { sendNotificationEmail: 'true', emailMessage: message },
    body: { type: 'user', role: 'writer', emailAddress: email },
  });
}

export async function unshare(id, permissionId) {
  await call(`${DRIVE}/files/${encodeURIComponent(id)}/permissions/${encodeURIComponent(permissionId)}`, { method: 'DELETE' });
}

export async function whoAmI() {
  const res = await call(`${DRIVE}/about`, { query: { fields: 'user(displayName,emailAddress)' } });
  return res.user || {};
}

// ---------- Obsah seznamu ----------

const rowToItem = r => ({
  id: r[0] || '', name: r[1] || '', qty: r[2] || '', unit: r[3] || '', cat: r[4] || 'ostatni',
  done: String(r[5]).toUpperCase() === 'TRUE', note: r[6] || '', by: r[7] || '', changed: r[8] || '',
});
export const itemToRow = i => [i.id, i.name, i.qty || '', i.unit || '', i.cat || 'ostatni', i.done ? 'TRUE' : 'FALSE', i.note || '', i.by || '', i.changed || ''];
const rowToHistory = r => ({ name: r[0] || '', cat: r[1] || 'ostatni', unit: r[2] || '', count: Number(r[3]) || 0, last: r[4] || '' });

export async function readList(id) {
  const res = await call(`${SHEETS}/${encodeURIComponent(id)}/values:batchGet`, {
    query: { ranges: `${q(ITEMS_SHEET)}!A2:I`, valueRenderOption: 'UNFORMATTED_VALUE' },
  });
  // Historii čteme zvlášť, aby starší/ručně upravené tabulky bez listu Historie nespadly.
  let history = [];
  try {
    const h = await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(HISTORY_SHEET)}!A2:E`)}`);
    history = (h.values || []).filter(r => r[0]).map(rowToHistory);
  } catch (e) { if (e instanceof AuthError) throw e; }
  const rows = res.valueRanges?.[0]?.values || [];
  return { items: rows.filter(r => r[0] && r[1]).map(rowToItem), history };
}

async function readIds(id, sheet) {
  const res = await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(sheet)}!A2:A`)}`);
  return (res.values || []).map(r => String(r[0] || ''));
}

async function sheetIdOf(id, title) {
  const meta = await call(`${SHEETS}/${encodeURIComponent(id)}`, { query: { fields: 'sheets.properties(sheetId,title)' } });
  const s = meta.sheets.find(x => x.properties.title === title);
  if (!s) throw new Error(`V tabulce chybí list „${title}“.`);
  return s.properties.sheetId;
}

export async function appendItem(id, item) {
  await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(ITEMS_SHEET)}!A:I`)}:append`, {
    method: 'POST',
    query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
    body: { values: [itemToRow(item)] },
  });
}

/** Přepíše řádek položky (hledá se podle ID těsně před zápisem). Vrací false, když položka už neexistuje. */
export async function updateItem(id, item) {
  const ids = await readIds(id, ITEMS_SHEET);
  const idx = ids.indexOf(item.id);
  if (idx < 0) return false;
  const row = idx + 2;
  await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(ITEMS_SHEET)}!A${row}:I${row}`)}`, {
    method: 'PUT', query: { valueInputOption: 'RAW' }, body: { values: [itemToRow(item)] },
  });
  return true;
}

/** Smaže řádky s danými ID (odspodu, aby se indexy neposunuly). */
export async function deleteItems(id, itemIds) {
  const ids = await readIds(id, ITEMS_SHEET);
  const rows = itemIds.map(x => ids.indexOf(x)).filter(i => i >= 0).sort((a, b) => b - a);
  if (!rows.length) return;
  const sheetId = await sheetIdOf(id, ITEMS_SHEET);
  await call(`${SHEETS}/${encodeURIComponent(id)}:batchUpdate`, {
    method: 'POST',
    body: { requests: rows.map(i => ({ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: i + 1, endIndex: i + 2 } } })) },
  });
}

/** Zapíše do Historie, že se položka přidala (pro „Často kupujete“). */
export async function bumpHistory(id, item, today) {
  const res = await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(HISTORY_SHEET)}!A2:E`)}`);
  const rows = res.values || [];
  const key = item.name.trim().toLowerCase();
  const idx = rows.findIndex(r => String(r[0] || '').trim().toLowerCase() === key);
  if (idx >= 0) {
    const row = idx + 2;
    const count = (Number(rows[idx][3]) || 0) + 1;
    await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(HISTORY_SHEET)}!A${row}:E${row}`)}`, {
      method: 'PUT', query: { valueInputOption: 'RAW' },
      body: { values: [[rows[idx][0], item.cat, item.unit || rows[idx][2] || '', count, today]] },
    });
  } else {
    await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(HISTORY_SHEET)}!A:E`)}:append`, {
      method: 'POST', query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' },
      body: { values: [[item.name, item.cat, item.unit || '', 1, today]] },
    });
  }
}

/** Uloží do Historie nové oddělení položky (aby se příště odhadlo správně). */
export async function setHistoryCategory(id, name, cat) {
  const res = await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(HISTORY_SHEET)}!A2:B`)}`);
  const rows = res.values || [];
  const idx = rows.findIndex(r => String(r[0] || '').trim().toLowerCase() === name.trim().toLowerCase());
  if (idx < 0) return;
  const row = idx + 2;
  await call(`${SHEETS}/${encodeURIComponent(id)}/values/${encodeURIComponent(`${q(HISTORY_SHEET)}!B${row}`)}`, {
    method: 'PUT', query: { valueInputOption: 'RAW' }, body: { values: [[cat]] },
  });
}

// ---------- Google Picker (zpřístupnění sdíleného seznamu) ----------

let pickerReady = null;
function loadPicker() {
  if (pickerReady) return pickerReady;
  pickerReady = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.onload = () => window.gapi.load('picker', { callback: resolve, onerror: reject });
    s.onerror = () => { pickerReady = null; reject(new Error('Nepodařilo se načíst okno Google Disku.')); };
    document.head.appendChild(s);
  });
  return pickerReady;
}

/**
 * Otevře okno Google Disku. Když uživatel vybere tabulku, aplikace k ní získá přístup.
 * fileId: předvybraný soubor (z odkazu); jinak se ukážou tabulky Nákupníku sdílené s uživatelem.
 * Vrací pole vybraných ID (prázdné při zrušení).
 */
export async function pickLists({ apiKey, appId, fileId }) {
  await loadPicker();
  const token = getStoredToken();
  if (!token) throw new AuthError('Přihlášení vypršelo.');
  const { picker } = window.google;
  return new Promise(resolve => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS).setMode(picker.DocsViewMode.LIST);
    if (fileId && typeof view.setFileIds === 'function') view.setFileIds(fileId);
    else view.setQuery(TITLE_PREFIX.trim().replace(/ –$/, ''));
    const p = new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setLocale('cs')
      .setTitle('Vyberte sdílený nákupní seznam')
      .setCallback(data => {
        if (data.action === picker.Action.PICKED) resolve((data.docs || []).map(d => d.id));
        else if (data.action === picker.Action.CANCEL) resolve([]);
      })
      .build();
    p.setVisible(true);
  });
}
