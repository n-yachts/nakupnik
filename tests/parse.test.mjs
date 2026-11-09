// Unit testy rozpoznání množství a kategorií: node tests/parse.test.mjs
import assert from 'node:assert/strict';
import { parseItem, guessCategory, formatQty } from '../js/parse.js';

const p = t => { const r = parseItem(t); return `${r.name}|${r.qty}|${r.unit}`; };
assert.equal(p('2 l mléko'), 'Mléko|2|l');
assert.equal(p('mléko 2l'), 'Mléko|2|l');
assert.equal(p('3x jogurt'), 'Jogurt|3|ks');
assert.equal(p('rohlíky 10'), 'Rohlíky|10|ks');
assert.equal(p('1,5 kg brambory'), 'Brambory|1,5|kg');
assert.equal(p('brambory 1.5 kg'), 'Brambory|1,5|kg');
assert.equal(p('20 dkg šunky'), 'Šunky|20|dkg');
assert.equal(p('máslo'), 'Máslo||');
assert.equal(p('  2   balení  kávy '), 'Kávy|2|bal');
assert.equal(p('Coca cola 2 l'), 'Coca cola|2|l');
assert.equal(p('7up'), '7up||');
assert.equal(formatQty('2', 'l'), '2 l');
assert.equal(formatQty('', 'ks'), '');

const g = guessCategory;
assert.equal(g('Mléko'), 'mlecne');
assert.equal(g('Rohlíky'), 'pecivo');
assert.equal(g('Banány'), 'ovoce');
assert.equal(g('Kuřecí prsa'), 'maso');
assert.equal(g('Zubní pasta'), 'drogerie');
assert.equal(g('Toaletní papír'), 'drogerie');
assert.equal(g('Prášek na praní'), 'domacnost');
assert.equal(g('Těstoviny'), 'trvanlive');
assert.equal(g('Zmrzlina'), 'mrazene');
assert.equal(g('Pivo'), 'napoje');
assert.equal(g('Minerálka'), 'napoje');
assert.equal(g('Čokoláda'), 'sladke');
assert.equal(g('Granule pro psa'), 'zvirata');
assert.equal(g('Šroubky'), 'ostatni');
assert.equal(g('Vejce'), 'mlecne');
assert.equal(g('Tuňák v oleji'), 'trvanlive');
assert.equal(g('Brambory'), 'ovoce');
assert.equal(g('Bramborové lupínky'), 'sladke');
console.log('všechny testy prošly');
