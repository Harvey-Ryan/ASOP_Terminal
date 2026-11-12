import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseShipMatrix, shipsFromGameFiles, shipIndex, matchShip, searchShips, parseFleetImport, shipRoleGroup, fleetCheckDue,
} from '../dist/index.js';

const matrix = {
  success: 1,
  data: [
    { id: 1, name: 'Aurora Mk I ES', type: 'multi-role', focus: 'Starter / Pathfinder', size: 'small', min_crew: 1, max_crew: 1, cargocapacity: 3, production_status: 'flight-ready', url: '/pledge/ships/rsi-aurora/Aurora-Mk-I-ES',
      manufacturer: { name: 'Roberts Space Industries', code: 'RSI' },
      media: [{ source_url: 'https://media.robertsspaceindustries.com/e1/source.jpg', images: { store_small: 'https://media.robertsspaceindustries.com/e1/store_small.jpg', slideshow: 'https://media.robertsspaceindustries.com/e1/slideshow.jpg' } }] },
    { id: 2, name: 'Carrack', type: 'Exploration', focus: 'Expedition', size: 'large', min_crew: 4, max_crew: 6, cargocapacity: 456, manufacturer: { name: 'Anvil Aerospace', code: 'ANVL' }, media: [] },
    { id: 3, name: 'Carrack Expedition', type: 'Exploration', manufacturer: { name: 'Anvil Aerospace', code: 'ANVL' } },
    { id: 4, name: 'Cutlass Black', type: 'Multi-Role', manufacturer: { name: 'Drake Interplanetary', code: 'DRAK' } },
    { id: 5, name: 'Cutlass Red', type: 'Support', manufacturer: { name: 'Drake Interplanetary', code: 'DRAK' } },
    { id: 6, name: 'Mercury Star Runner', type: 'Transport', manufacturer: { name: 'Crusader Industries', code: 'CRSD' } },
    { id: 7, name: 'Prospector', type: 'Industrial', focus: 'Mining', manufacturer: { name: 'MISC', code: 'MISC' } },
    { id: 8, name: '600i Explorer', type: 'Exploration', manufacturer: { name: 'Origin Jumpworks', code: 'ORIG' } },
    { id: 9, name: 'C2 Hercules Starlifter', type: 'Transport', manufacturer: { name: 'Crusader Industries', code: 'CRSD' } },
    { name: 'no id' },
  ],
};
const ships = parseShipMatrix(matrix);
const idx = shipIndex(ships);
const m = (s, hint) => { const r = matchShip(s, idx, hint); return r.status === 'matched' ? r.ship.name : `${r.status}:${r.suggestions.map((x) => x.name).join('|')}`; };

test('reads RSI ship data', () => {
  assert.equal(ships.length, 9);
  assert.deepEqual(ships[0], {
    id: 'rsi-1', name: 'Aurora Mk I ES', manufacturer: 'Roberts Space Industries', manufacturerCode: 'RSI', type: 'Multi-Role', focus: 'Starter / Pathfinder',
    size: 'Small', minCrew: 1, maxCrew: 1, cargo: 3, status: 'flight-ready',
    imageUrl: 'https://media.robertsspaceindustries.com/e1/slideshow.jpg', thumbUrl: 'https://media.robertsspaceindustries.com/e1/store_small.jpg',
    storeUrl: 'https://robertsspaceindustries.com/pledge/ships/rsi-aurora/Aurora-Mk-I-ES',
  });
  assert.equal(shipRoleGroup(ships[1]), 'Exploration');
  assert.equal(shipRoleGroup({ type: 'Racing' }), 'Other');
  assert.deepEqual(parseShipMatrix({ nope: 1 }), []);
});

test('the game files are the fallback, without the maker in the name', () => {
  const g = shipsFromGameFiles([
    { uuid: 'u1', name: 'Anvil Carrack', manufacturer_name: 'Anvil Aerospace', manufacturer_code: 'ANVL', role: 'Expedition', career: 'Exploration', crew: 6, is_vehicle: false },
    { uuid: 'u2', name: '<= PLACEHOLDER =>', manufacturer_name: null, manufacturer_code: null, role: null, career: null, crew: null, is_vehicle: false },
  ]);
  assert.deepEqual(g.map((s) => [s.id, s.name, s.type]), [['game-u1', 'Carrack', 'Exploration']]);
});

test('matching names as people type or export them', () => {
  assert.equal(m('Carrack'), 'Carrack');
  assert.equal(m('anvil carrack'), 'Carrack');
  assert.equal(m('ANVL Carrack'), 'Carrack');
  assert.equal(m('Carrack Expedition'), 'Carrack Expedition');
  assert.equal(m('Anvil Carrack Expedition LTI'), 'Carrack Expedition'); // the longest name that fits
  assert.equal(m('Cutlass Black - Warbond Edition'), 'Cutlass Black');
  assert.equal(m("Drake Cutlass 'Black'"), 'Cutlass Black');
  assert.equal(m('MSR'), 'Mercury Star Runner');
  assert.equal(m('Mercury'), 'Mercury Star Runner');
  assert.equal(m('prospector'), 'Prospector');
  assert.equal(m('600i'), '600i Explorer');
  assert.equal(m('C2'), 'C2 Hercules Starlifter');
  assert.equal(m('Cutlass'), 'ambiguous:Cutlass Black|Cutlass Red');
  assert.equal(m('Cutlass', 'Drake Interplanetary'), 'ambiguous:Cutlass Black|Cutlass Red');
  assert.match(m('Carrak'), /^none:/);
  assert.equal(m(''), 'none:');
});

test('search for the add box and autocomplete', () => {
  assert.deepEqual(searchShips('cut', ships).map((s) => s.name), ['Cutlass Black', 'Cutlass Red']);
  assert.deepEqual(searchShips('drake red', ships).map((s) => s.name), ['Cutlass Red']);
  assert.deepEqual(searchShips('carr', ships).map((s) => s.name), ['Carrack', 'Carrack Expedition']);
  assert.equal(searchShips('', ships, 3).length, 3);
});

test('importing plain text', () => {
  const r = parseFleetImport('Carrack\n2x Cutlass Black\nProspector, 3\n# a comment\n\n- Mercury x2\ncarrack');
  assert.equal(r.format, 'text');
  assert.deepEqual(r.lines.map((l) => [l.name, l.quantity]), [['Carrack', 2], ['Cutlass Black', 2], ['Prospector', 3], ['Mercury', 2]]);
});

test('importing a Hangar Export / hangar.link file: ships and vehicles only', () => {
  const file = JSON.stringify({
    type: 'hangarexport', version: 2, handle: 'someone',
    pledges: [
      { pledgeName: 'Package - Carrack', items: [
        { title: 'Carrack', kind: 'Ship', liner: 'Anvil Aerospace', itemCustomName: 'Wanderer' },
        { title: 'Pisces C8X', kind: 'Ship', liner: 'Anvil Aerospace', itemCustomName: '' },
        { title: 'Lifetime Insurance', kind: 'Insurance', liner: '' },
      ] },
      { pledgeName: 'Standalone Ship - Cutlass Black', items: [{ title: 'Cutlass Black', kind: 'Ship', liner: 'Drake Interplanetary' }] },
      { pledgeName: 'Standalone Ship - Cutlass Black', items: [{ title: 'Cutlass Black', kind: 'Ship', liner: 'Drake Interplanetary' }] },
      { pledgeName: 'Ursa', items: [{ title: 'Ursa Rover', kind: 'Vehicle', liner: 'Roberts Space Industries' }] },
    ],
  });
  const r = parseFleetImport(file);
  assert.equal(r.format, 'hangarexport');
  assert.deepEqual(r.lines.map((l) => [l.name, l.quantity, l.manufacturer, l.nickname]), [
    ['Carrack', 1, 'Anvil Aerospace', 'Wanderer'], ['Pisces C8X', 1, 'Anvil Aerospace', null], ['Cutlass Black', 2, 'Drake Interplanetary', null], ['Ursa Rover', 1, 'Roberts Space Industries', null],
  ]);
});

test('importing a FleetYards-style or plain JSON list', () => {
  const fy = parseFleetImport(JSON.stringify([
    { name: 'Big Red', model: { name: 'Carrack', slug: 'carrack', manufacturer: { name: 'Anvil Aerospace' } } },
    { model: { name: 'Prospector' } },
    { slug: 'mercury-star-runner' },
  ]));
  assert.equal(fy.format, 'json');
  assert.deepEqual(fy.lines.map((l) => [l.name, l.nickname ?? null, l.manufacturer ?? null]), [['Carrack', 'Big Red', 'Anvil Aerospace'], ['Prospector', null, null], ['mercury star runner', null, null]]);
  assert.deepEqual(parseFleetImport('{"ships":["Carrack","Carrack"]}').lines, [{ name: 'Carrack', quantity: 2 }]);
  assert.equal(parseFleetImport('{broken').format, 'text');
});

test('when to ask "still flying these?"', () => {
  const day = 86_400_000; const now = new Date('2026-11-12T12:00:00Z');
  const ago = (d) => new Date(now.getTime() - d * day);
  const owner = { checkedAt: ago(100), lastNudgeAt: null, nudges: true, createdAt: ago(200) };
  assert.equal(fleetCheckDue(owner, 3, now), true);
  assert.equal(fleetCheckDue(owner, 0, now), false);
  assert.equal(fleetCheckDue({ ...owner, nudges: false }, 3, now), false);
  assert.equal(fleetCheckDue({ ...owner, checkedAt: ago(10) }, 3, now), false);
  assert.equal(fleetCheckDue({ ...owner, lastNudgeAt: ago(5) }, 3, now), false); // asked recently, no answer: wait
  assert.equal(fleetCheckDue({ ...owner, checkedAt: null, createdAt: ago(30) }, 3, now), false);
});
