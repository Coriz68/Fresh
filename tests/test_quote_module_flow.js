'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const extractFunction = name => source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];

test('aggiungendo più moduli chiude prima la selezione e apre l’editor di ciascuna riga', async () => {
  const formDialog = {
    open: false,
    showModal() { this.open = true; },
    close() { this.open = false; },
    querySelector(selector) {
      if (selector === '[data-dialog-close]') return { addEventListener() {} };
      if (selector === 'form') return { addEventListener: (_type, listener) => { this.submit = listener; } };
      throw new Error(`Selettore inatteso: ${selector}`);
    }
  };
  let selectedModuleId = '';
  const quote = { items: [{ id: 'existing-item', moduleId: 'first' }] };
  const openedEditors = [];
  const selectionDialogWasOpen = [];
  let submit;
  const sandbox = {
    formDialog,
    state: { prices: { second: 75, third: 125 } },
    modules: [{ id: 'second', name: 'Secondo modulo' }, { id: 'third', name: 'Terzo modulo' }],
    getQuote: () => quote,
    makeId: () => `item-${quote.items.length + 1}`,
    esc: value => String(value),
    persistNow: async () => {},
    renderQuote: () => {},
    openModuleEditor: async id => {
      selectionDialogWasOpen.push(formDialog.open);
      openedEditors.push(id);
    },
    FormData: class {
      entries() { return [['moduleId', selectedModuleId]][Symbol.iterator](); }
    },
    Object,
    Number,
    Date
  };
  const originalQuerySelector = formDialog.querySelector.bind(formDialog);
  formDialog.querySelector = selector => {
    const result = originalQuerySelector(selector);
    if (selector === 'form') return { addEventListener: (_type, listener) => { submit = listener; } };
    return result;
  };
  const functions = [extractFunction('openFormDialog'), extractFunction('openAddModuleDialog')];
  assert.ok(functions.every(Boolean), 'I flussi reali dei dialog devono essere presenti.');
  vm.runInNewContext(functions.join('\n'), sandbox);

  for (const moduleId of ['second', 'third']) {
    selectedModuleId = moduleId;
    sandbox.openAddModuleDialog();
    await submit({ currentTarget: {}, preventDefault() {} });
  }

  assert.equal(quote.items.length, 3, 'Il preventivo iniziale può ricevere altri due moduli.');
  assert.deepEqual(quote.items.map(item => item.moduleId), ['first', 'second', 'third']);
  assert.deepEqual(openedEditors, ['item-2', 'item-3']);
  assert.deepEqual(selectionDialogWasOpen, [false, false], 'La selezione deve chiudersi prima di aprire ogni editor.');
});
