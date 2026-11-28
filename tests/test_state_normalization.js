'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const extract = pattern => source.match(pattern)?.[0];

function loadNormalizeState() {
  const emptyState = extract(/const emptyState = \(\) => \(\{[\s\S]*?\n\}\);/);
  const normalizeState = extract(/function normalizeState\([^)]*\) \{[\s\S]*?\n\}/);
  assert.ok(emptyState && normalizeState, 'Le funzioni reali devono essere presenti.');
  let counter = 0;
  const sandbox = { makeId: () => `id-${++counter}`, Object, Array, String };
  vm.runInNewContext(`${emptyState}\n${normalizeState}\nthis.normalizeState = normalizeState;`, sandbox);
  return sandbox.normalizeState;
}

test('un backup incompleto viene completato prima di essere usato', () => {
  const normalizeState = loadNormalizeState();
  const state = normalizeState({
    clients: [{ name: 'Mario' }, null],
    quotes: [{ number: 'PREV-2025-0001', createdAt: '2025-01-10' }, { number: 'PREV-2025-0002', items: [{ moduleId: 'x' }] }],
    prices: { x: 10 },
    company: { name: 'Fresh', logo: null }
  });

  assert.equal(state.clients.length, 1);
  assert.ok(state.clients[0].id);
  assert.equal(state.company.name, 'Fresh');
  assert.equal(state.company.logo, '');
  assert.equal(state.company.footerNotes, '');
  assert.equal(state.quotes[0].updatedAt, '2025-01-10', 'Serve per ordinare i preventivi senza errori.');
  assert.deepEqual([...state.quotes[0].items], []);
  assert.equal(state.quotes[1].status, 'bozza');
  assert.ok(state.quotes[1].items[0].id);
  assert.deepEqual({ ...state.quotes[1].items[0].data }, {});
  assert.doesNotThrow(() => [...state.quotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  assert.doesNotThrow(() => state.company.name.trim());
});

test('uno stato vuoto o non valido diventa un archivio vuoto', () => {
  const normalizeState = loadNormalizeState();
  for (const value of [null, undefined, {}, { clients: 'x', quotes: {}, prices: [], company: 'x' }]) {
    const state = normalizeState(value);
    assert.equal(state.clients.length, 0);
    assert.equal(state.quotes.length, 0);
    assert.equal(Object.keys(state.prices).length, 0);
    assert.equal(state.company.name, '');
  }
});
