// Rozpoznání množství a kategorie z textu položky („2 l mléko“, „rohlíky 10“, „3x jogurt“).

export const UNITS = ['ks', 'kg', 'dkg', 'g', 'l', 'ml', 'bal'];
const UNIT_ALIASES = {
  x: 'ks', '×': 'ks', ks: 'ks', kus: 'ks', kusy: 'ks', kusů: 'ks',
  kg: 'kg', dkg: 'dkg', deka: 'dkg', g: 'g', gr: 'g',
  l: 'l', litr: 'l', litry: 'l', litrů: 'l', ml: 'ml',
  bal: 'bal', 'bal.': 'bal', balení: 'bal',
};
const NUM = '(\\d+(?:[.,]\\d+)?)';
const UNIT = '(x|×|ks|kusy|kusů|kus|kg|dkg|deka|gr|g|litry|litrů|litr|l|ml|bal\\.?|balení)';

/** Rozloží text na { name, qty, unit }. qty je řetězec („1,5“), prázdný, když chybí. */
export function parseItem(text) {
  const t = String(text || '').trim().replace(/\s+/g, ' ');
  if (!t) return { name: '', qty: '', unit: '' };
  let m = t.match(new RegExp(`^${NUM}\\s*${UNIT}?\\s+(.+)$`, 'i'));
  if (m) return finish(m[3], m[1], m[2]);
  m = t.match(new RegExp(`^(.+?)\\s+${NUM}\\s*${UNIT}?$`, 'i'));
  if (m) return finish(m[1], m[2], m[3]);
  return finish(t, '', '');
}

function finish(name, qty, unit) {
  const n = name.trim();
  return {
    name: n.charAt(0).toUpperCase() + n.slice(1),
    qty: qty ? qty.replace('.', ',') : '',
    unit: unit ? UNIT_ALIASES[unit.toLowerCase()] || '' : (qty ? 'ks' : ''),
  };
}

/** „2 l“, „1,5 kg“, „3 ks“ – prázdné, když množství chybí. */
export function formatQty(qty, unit) {
  if (!qty) return '';
  return unit ? `${qty} ${unit}` : qty;
}

// Oddělení v pořadí, v jakém je obvykle procházíte obchodem.
export const CATEGORIES = [
  { id: 'ovoce', label: 'Ovoce a zelenina', icon: '🥬' },
  { id: 'pecivo', label: 'Pečivo', icon: '🥖' },
  { id: 'mlecne', label: 'Mléčné a vejce', icon: '🧀' },
  { id: 'maso', label: 'Maso, uzeniny, ryby', icon: '🥩' },
  { id: 'trvanlive', label: 'Trvanlivé a vaření', icon: '🥫' },
  { id: 'mrazene', label: 'Mražené', icon: '❄️' },
  { id: 'sladke', label: 'Sladkosti a pochutiny', icon: '🍫' },
  { id: 'napoje', label: 'Nápoje', icon: '🥤' },
  { id: 'drogerie', label: 'Drogerie', icon: '🧴' },
  { id: 'domacnost', label: 'Domácnost', icon: '🧽' },
  { id: 'zvirata', label: 'Zvířata', icon: '🐾' },
  { id: 'ostatni', label: 'Ostatní', icon: '📦' },
];
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c, i) => [c.id, { ...c, order: i }]));

// Začátky slov (bez diakritiky) → oddělení. Víceslovné výrazy mají přednost.
const PHRASES = [
  ['zubni pasta', 'drogerie'], ['toaletni papir', 'drogerie'], ['kuchynske utěrky', 'domacnost'],
  ['kuchynske uterky', 'domacnost'], ['prasek na prani', 'domacnost'], ['gel na prani', 'domacnost'],
  ['bramborove lupinky', 'sladke'], ['mrazena zelenina', 'mrazene'], ['mrazene', 'mrazene'],
  ['kokosove mleko', 'trvanlive'], ['tuna', 'trvanlive'], ['tunak', 'trvanlive'],
];
const STEMS = {
  ovoce: ['jabl', 'banan', 'hrusk', 'pomeran', 'citron', 'limet', 'mandarin', 'hrozn', 'jahod', 'boruvk', 'malin',
    'svestk', 'merunk', 'broskv', 'kiwi', 'ananas', 'meloun', 'rajc', 'rajce', 'okurk', 'paprik', 'cibul', 'cesnek',
    'brambor', 'mrkev', 'mrkv', 'salat', 'zeli', 'kvetak', 'brokolic', 'avokad', 'zampion', 'houb', 'petrzel',
    'kopr', 'pazitk', 'bylink', 'cuket', 'lilek', 'dyn', 'redkvick', 'celer', 'porek', 'spenat', 'ovoce', 'zelenin', 'zazvor'],
  pecivo: ['rohlik', 'chleb', 'chleba', 'housk', 'baget', 'pecivo', 'kolac', 'koblih', 'croissant', 'loupak', 'vanock',
    'toust', 'bulk', 'dalamank', 'kaiserk', 'tortill'],
  mlecne: ['mlek', 'mleko', 'jogurt', 'syr', 'tvaroh', 'maslo', 'masl', 'smetan', 'vejc', 'vajic', 'vejce', 'kefir',
    'podmasl', 'zakys', 'mozzarel', 'eidam', 'gouda', 'hermelin', 'parmaz', 'cottage', 'ricott', 'mascarpon', 'pudink', 'lucin', 'termix'],
  maso: ['maso', 'kure', 'kuret', 'kuraci', 'krut', 'vepr', 'hovez', 'mlet', 'salam', 'sunk', 'klobas', 'parek', 'park',
    'slanin', 'spek', 'ryb', 'losos', 'pstruh', 'treska', 'kreve', 'steak', 'rizk', 'kotlet', 'jatr', 'pasteta', 'uzen'],
  trvanlive: ['testovin', 'spaget', 'penne', 'ryz', 'mouk', 'cukr', 'sul', 'olej', 'ocet', 'kecup', 'horcic', 'majonez',
    'konzerv', 'fazol', 'cocka', 'cizrn', 'kava', 'kavu', 'caj', 'kakao', 'musli', 'vlock', 'cerealie', 'med', 'dzem',
    'marmelad', 'nutell', 'koreni', 'pepr', 'paprika mleta', 'kmin', 'oregano', 'bujon', 'polevk', 'omack', 'pyre',
    'kuskus', 'bulgur', 'kroupy', 'strouhank', 'drozd', 'prasek do peciva', 'kypric', 'vanilk', 'olivy', 'kukurice', 'hrasek', 'protlak'],
  mrazene: ['zmrzlin', 'nanuk', 'pizz', 'hranolk', 'mrazen', 'led'],
  sladke: ['cokolad', 'susenk', 'oplatk', 'bonbon', 'lizatk', 'zvykack', 'chips', 'lupink', 'tycink', 'oris', 'burak',
    'arasid', 'mandl', 'kesu', 'pistac', 'rozink', 'gumov', 'bebe', 'sladkost', 'dort', 'popcorn', 'krekr'],
  napoje: ['voda', 'vody', 'mineralk', 'dzus', 'stav', 'pivo', 'piv', 'vino', 'vina', 'limonad', 'sirup', 'cola', 'kofol',
    'tonic', 'sodov', 'energetick', 'rum', 'vodk', 'slivovic', 'prosecco', 'sekt'],
  drogerie: ['mydl', 'sampon', 'kondicion', 'sprchov', 'zubni', 'kartacek', 'toaletni', 'kapesnik', 'plenk', 'deodorant',
    'krem', 'vlozk', 'tampon', 'holic', 'zilet', 'vatov', 'tycinky do usi', 'opalovac', 'parfem', 'lak na', 'naplast'],
  domacnost: ['prasek', 'prac', 'avivaz', 'jar', 'saponat', 'myci', 'houbick', 'hadr', 'utěrk', 'uterk', 'ubrous',
    'pytl', 'sacky', 'folie', 'alobal', 'pecici papir', 'svick', 'baterie', 'zarovk', 'tablety do mycky', 'sul do mycky',
    'leštěn', 'lesten', 'cistic', 'savo', 'domestos', 'wc', 'osvezovac', 'zapalovac', 'sirky'],
  zvirata: ['granul', 'kapsick', 'stelivo', 'psi', 'kocici', 'pamlsk', 'krmivo', 'konzerva pro'],
};

export const strip = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Odhadne oddělení podle názvu položky. */
export function guessCategory(name) {
  const n = strip(name).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return 'ostatni';
  for (const [phrase, cat] of PHRASES) if (n.includes(strip(phrase))) return cat;
  const words = n.split(' ');
  // Delší kmeny mají přednost (např. „kokosove“ vs „ko…“).
  let best = null;
  for (const [cat, stems] of Object.entries(STEMS)) {
    for (const stem of stems) {
      const st = strip(stem);
      const hit = st.includes(' ') ? n.includes(st) : words.some(w => w.startsWith(st));
      if (hit && (!best || st.length > best.len)) best = { cat, len: st.length };
    }
  }
  return best ? best.cat : 'ostatni';
}
