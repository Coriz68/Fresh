'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const extractFunction = name => source.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];

function runPhoneNormalizer(value) {
  const functionSource = extractFunction('normalizePhoneNumber');
  assert.ok(functionSource, 'Il normalizzatore puro deve esistere.');
  const sandbox = {};
  vm.runInNewContext(`${functionSource}\nthis.normalizePhoneNumber = normalizePhoneNumber;`, sandbox);
  return JSON.parse(JSON.stringify(sandbox.normalizePhoneNumber(value)));
}

test('normalizePhoneNumber adds the Italian prefix', () => {
  assert.deepEqual(runPhoneNormalizer('333 123 4567'), { value: '+393331234567', valid: true, empty: false });
});

test('normalizePhoneNumber accepts international numbers', () => {
  assert.deepEqual(runPhoneNormalizer('+33 (0)6 12 34 56 78'), { value: '+33612345678', valid: true, empty: false });
});

test('normalizePhoneNumber allows an empty optional value', () => {
  assert.deepEqual(runPhoneNormalizer('  '), { value: '', valid: true, empty: true });
});

test('normalizePhoneNumber rejects malformed lengths', () => {
  assert.equal(runPhoneNormalizer('123').valid, false);
  assert.equal(runPhoneNormalizer('+1234567890123456').valid, false);
});

test('invalid phone prevents client save', async () => {
  const functions = ['normalizePhoneNumber', 'updatePhoneValidation', 'clientFields', 'openFormDialog', 'openClientDialog']
    .map(extractFunction);
  assert.ok(functions.every(Boolean), 'Le funzioni reali del modulo clienti devono essere presenti.');
  let submit;
  const errors = [];
  const phoneListeners = [];
  const phoneInput = {
    value: '123',
    addEventListener: (_event, listener) => phoneListeners.push(listener),
    setAttribute() {},
    removeAttribute() {}
  };
  const feedback = { textContent: '', hidden: true };
  const formDialog = {
    innerHTML: '',
    showModal() {},
    close() {},
    querySelector(selector) {
      if (selector === '[data-dialog-close]') return { addEventListener() {} };
      if (selector === 'form') return { addEventListener: (_event, listener) => { submit = listener; } };
      if (selector === '[name="phone"]') return phoneInput;
      if (selector === '#phoneValidation') return feedback;
      throw new Error(`Selettore inatteso: ${selector}`);
    }
  };
  class FormDataStub {
    entries() { return [['name', 'Ada'], ['company', ''], ['phone', '123']][Symbol.iterator](); }
  }
  const sandbox = {
    normalizePhoneNumber: runPhoneNormalizer,
    formDialog,
    FormData: FormDataStub,
    state: { clients: [] },
    makeId: () => 'new-client',
    Date,
    esc: value => String(value ?? ''),
    showToast: (message, isError) => { if (isError) errors.push(message); },
    persistNow: async () => true,
    render() {}
  };
  vm.runInNewContext(functions.join('\n'), sandbox);

  sandbox.openClientDialog();
  phoneListeners[0]?.();
  await submit({ currentTarget: {}, preventDefault() {} });

  assert.deepEqual(sandbox.state.clients, []);
  assert.ok(errors.some(message => /telefono|numero/i.test(message)));
});
