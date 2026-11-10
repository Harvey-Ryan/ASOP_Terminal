// Tests for the game item catalog helpers. Run: `npm test -w @dem/shared`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CatalogIndex, parseCatalogRef, catalogRef, categoryLabel, toCatalogEntry, itemDetailFromRow, commodityDetailFromRow } from '../dist/catalog.js';

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const item = (n, name, category, extra = {}) => ({ kind: 'ITEM', uuid: U(n), name, category, size: null, is_ship_item: false, item_type: null, groups: null, raw: null, ...extra });
const com = (n, name, groups = [], raw = false) => ({ kind: 'COMMODITY', uuid: U(n), name, category: null, size: null, is_ship_item: null, item_type: null, groups, raw });

const idx = CatalogIndex.fromRows([
  item(1, 'P4-AR Rifle', 'FPS.Weapon.Medium', { item_type: 'Assault Rifle' }),
  item(2, 'P4-AR Magazine (40 cap)', 'FPS.WeaponAttachment.Magazine'),
  item(3, 'Quantity', 'Misc', { minor: true }),
  item(4, 'Mauler Quantum Drive', 'Ship.QuantumDrive', { size: 4, is_ship_item: true }),
  item(5, 'Stinger Black Widow Livery', 'Ship.Paints', { size: 1, is_ship_item: true }),
  com(10, 'Quantainium'),
  com(11, 'Quantainium (Raw)', ['Mineral', 'Raw_Minerals'], true),
  com(12, 'WiDoW', ['ProcessedGoods', 'Vice']),
]);

test('refs round-trip and reject junk', () => {
  assert.deepEqual(parseCatalogRef(catalogRef('ITEM', U(1))), { kind: 'ITEM', uuid: U(1) });
  assert.deepEqual(parseCatalogRef(`commodity:${U(2).toUpperCase()}`), { kind: 'COMMODITY', uuid: U(2) });
  assert.equal(parseCatalogRef('ITEM:123'), null);
  assert.equal(parseCatalogRef('Pembroke Helmet'), null);
  assert.equal(parseCatalogRef(undefined), null);
});

test('search ranks exact, prefix, word prefix, substring; minor entries last among equals', () => {
  assert.deepEqual(idx.search('quant').map((e) => e.name), ['Quantainium', 'Quantainium (Raw)', 'Quantity', 'Mauler Quantum Drive']);
  assert.deepEqual(idx.search('p4-ar rifle').map((e) => e.name), ['P4-AR Rifle']);
  assert.deepEqual(idx.search('widow').map((e) => e.name), ['WiDoW', 'Stinger Black Widow Livery']);
  assert.deepEqual(idx.search('').map((e) => e.name), []);
});

test('search can be limited to one kind and a count', () => {
  assert.deepEqual(idx.search('quant', { kinds: ['ITEM'] }).map((e) => e.name), ['Quantity', 'Mauler Quantum Drive']);
  assert.equal(idx.search('quant', { limit: 1 }).length, 1);
});

test('get by ref and find by name', () => {
  assert.equal(idx.get(`ITEM:${U(1)}`)?.name, 'P4-AR Rifle');
  assert.equal(idx.get(`COMMODITY:${U(1)}`), undefined);
  assert.equal(idx.findByName('  quantainium ')?.uuid, U(10));
  assert.equal(idx.findByName('nope'), undefined);
});

test('labels: item type, ship size only for parts, commodity flags', () => {
  const d = (name) => idx.search(name)[0].detail;
  assert.equal(d('P4-AR Rifle'), 'Assault Rifle');
  assert.equal(d('Mauler'), 'Quantum Drive · S4');
  assert.equal(d('Stinger'), 'Ship Paint');
  assert.equal(d('Quantainium (Raw)'), 'Commodity · Raw');
  assert.equal(d('WiDoW'), 'Commodity · Illegal');
  assert.equal(categoryLabel('FPS.Armor.Helmet'), 'Armour · Helmet');
  assert.equal(categoryLabel('Ship.Flair.Flair_Surface'), 'Ship Flair');
  assert.equal(categoryLabel('SomethingNew_Thing'), 'Something New Thing');
  assert.equal(toCatalogEntry(item(3, 'Quantity', 'Misc', { minor: true })).minor, true);
});

test('item detail keeps the in-game stat block, minus repeated fields', () => {
  const d = itemDetailFromRow({
    uuid: U(1), name: 'FR-66', category: 'Ship.Shield.Shield', size: 1, grade: 1, is_ship_item: true,
    manufacturer: 'Gorgon Defender Industries', description: 'A shield.\\nGood.', item_type: 'Shield Generator',
    stats: { Size: '1', Class: 'Military', Grade: 'A', 'Item Type': 'Shield Generator', Manufacturer: 'Gorgon' },
  });
  assert.equal(d.detail, 'Shield Generator · S1');
  assert.deepEqual(d.stats, [{ name: 'Class', value: 'Military' }, { name: 'Grade', value: 'A' }]);
  assert.equal(d.description, 'A shield.\nGood.');
  assert.equal('minor' in d, false);
});

test('commodity detail merges game flags with UEX prices', () => {
  const d = commodityDetailFromRow({
    uuid: U(11), name: 'Quantainium (Raw)', groups: ['Mineral', 'Raw_Minerals'], raw: true, refined_name: 'Quantainium',
    description: '<= PLACEHOLDER =>', avg_buy: null, avg_sell: 88, code: 'QUAR', uex_illegal: false,
  });
  assert.deepEqual(d.commodity, { raw: true, illegal: false, refinedName: 'Quantainium', avgBuy: null, avgSell: 88, code: 'QUAR' });
  assert.equal(d.description, null);
});
