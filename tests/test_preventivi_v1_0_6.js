'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const extractFunction = name => source.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];

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

test('customer and supplier send timestamps are independent', async () => {
  const mark = extractFunction('markQuoteSent');
  assert.ok(mark, 'La conferma di invio deve avere una funzione reale.');
  const quote = { sentCustomerAt: null, sentSupplierAt: null };
  const sandbox = {
    getQuote: () => quote,
    window: { confirm: () => true },
    Date: class extends Date { constructor() { super('2026-11-26T10:30:00.000Z'); } },
    persistNow: async () => true,
    render() {},
    showToast() {}
  };
  vm.runInNewContext(`${mark}\nthis.markQuoteSent = markQuoteSent;`, sandbox);

  await sandbox.markQuoteSent('customer');

  assert.equal(quote.sentCustomerAt, '2026-11-26T10:30:00.000Z');
  assert.equal(quote.sentSupplierAt, null);
});

test('opening WhatsApp does not mark a quote sent', async () => {
  const share = extractFunction('shareQuotePdfViaWhatsApp');
  assert.ok(share, 'Il flusso WhatsApp del preventivo deve esistere.');
  const quote = { sentCustomerAt: null, sentSupplierAt: null };
  const bridgeCalls = [];
  const sandbox = {
    desktopBridge: { open_whatsapp: async (...args) => { bridgeCalls.push(args); } },
    window: { prompt: () => '333 123 4567' },
    getQuote: () => quote,
    activeClient: () => ({ phone: '+393331234567' }),
    normalizePhoneNumber: runPhoneNormalizer,
    generateQuotePdf: async () => ({ path: 'C:/pdf/quote.pdf' }),
    showToast() {}
  };
  vm.runInNewContext(`${share}\nthis.shareQuotePdfViaWhatsApp = shareQuotePdfViaWhatsApp;`, sandbox);

  await sandbox.shareQuotePdfViaWhatsApp('customer');

  assert.deepEqual(bridgeCalls, [['+393331234567']]);
  assert.equal(quote.sentCustomerAt, null);
  assert.equal(quote.sentSupplierAt, null);
});

test('cancelled manual confirmation does not mark sent', async () => {
  const mark = extractFunction('markQuoteSent');
  assert.ok(mark, 'La conferma di invio deve avere una funzione reale.');
  const quote = { sentCustomerAt: null, sentSupplierAt: null };
  let saved = false;
  const sandbox = {
    getQuote: () => quote,
    window: { confirm: () => false },
    persistNow: async () => { saved = true; return true; },
    render() {},
    showToast() {}
  };
  vm.runInNewContext(`${mark}\nthis.markQuoteSent = markQuoteSent;`, sandbox);

  await sandbox.markQuoteSent('supplier');

  assert.equal(quote.sentSupplierAt, null);
  assert.equal(saved, false);
});

test('confirmed send stores an ISO timestamp', async () => {
  const mark = extractFunction('markQuoteSent');
  assert.ok(mark, 'La conferma di invio deve avere una funzione reale.');
  const quote = { sentCustomerAt: null, sentSupplierAt: null };
  const sandbox = {
    getQuote: () => quote,
    window: { confirm: () => true },
    Date: class extends Date { constructor() { super('2026-11-26T10:30:00.000Z'); } },
    persistNow: async () => true,
    render() {},
    showToast() {}
  };
  vm.runInNewContext(`${mark}\nthis.markQuoteSent = markQuoteSent;`, sandbox);

  await sandbox.markQuoteSent('supplier');

  assert.equal(quote.sentSupplierAt, '2026-11-26T10:30:00.000Z');
  assert.ok(Number.isFinite(Date.parse(quote.sentSupplierAt)));
});

test('quote list shows independent PDF send statuses', () => {
  const status = extractFunction('quoteSendStatusMarkup');
  assert.ok(status, 'Gli indicatori indipendenti devono avere un renderer.');
  const sandbox = {
    esc: value => String(value ?? ''),
    dateTimeLabel: value => value ? '26/11/2026 11:30' : '—'
  };
  vm.runInNewContext(`${status}\nthis.quoteSendStatusMarkup = quoteSendStatusMarkup;`, sandbox);

  const markup = sandbox.quoteSendStatusMarkup({ sentCustomerAt: '2026-11-26T10:30:00.000Z', sentSupplierAt: null });

  assert.match(markup, /PDF cliente/);
  assert.match(markup, /PDF fornitore/);
  assert.match(markup, /Inviato/);
  assert.match(markup, /Non inviato/);
});

test('supplier module data excludes client identity while customer data retains it', () => {
  const mapper = extractFunction('quoteModuleData');
  assert.ok(mapper, 'Il flusso di preparazione dei moduli deve separare i dati per destinazione PDF.');
  const sandbox = {
    structuredClone,
    quoteModuleData: undefined
  };
  vm.runInNewContext(`${mapper}\nthis.quoteModuleData = quoteModuleData;`, sandbox);
  const originalData = { larghezza: 300, cliente: 'Dato legacy' };
  const client = { name: 'Cliente Riservato', company: 'Riservata S.r.l.' };
  const quote = { number: 'PREV-2026-0001' };

  const supplier = sandbox.quoteModuleData('supplier', originalData, client, quote);
  const customer = sandbox.quoteModuleData('customer', originalData, client, quote);

  assert.equal(supplier.cliente, '');
  assert.equal(supplier.riferimento, quote.number);
  assert.equal(customer.cliente, 'Cliente Riservato');
  assert.deepEqual(JSON.parse(JSON.stringify(originalData)), { larghezza: 300, cliente: 'Dato legacy' });
});
