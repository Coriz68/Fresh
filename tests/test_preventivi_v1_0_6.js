'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const extractFunction = name => source.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];

test('CorradoWEB identity remains in the app but is removed from order modules', () => {
  const appHtml = fs.readFileSync(new URL('../Gestione_preventivi.html', `file://${__dirname}/`), 'utf8');
  const catalogHtml = fs.readFileSync(new URL('../Apri_catalogo.html', `file://${__dirname}/`), 'utf8');
  const moduleDirectory = new URL('../Moduli/', `file://${__dirname}/`);
  const modules = fs.readdirSync(moduleDirectory).filter(file => file.endsWith('.html'));

  assert.match(appHtml, /CorradoWEB 2026/);
  assert.match(catalogHtml, /CorradoWEB 2026/);
  assert.equal(modules.length, 32);
  for (const moduleFile of modules) {
    const html = fs.readFileSync(new URL(moduleFile, moduleDirectory), 'utf8');
    assert.ok(!/CorradoWEB\s*2026/i.test(html), `${moduleFile} non deve mostrare la dicitura nei moduli o nei PDF`);
    const maskWidth = moduleFile === 'tende-da-sole.html' ? 490 : 340;
    const maskHeight = moduleFile === 'tende-da-sole.html' ? 112 : 84;
    assert.match(html, new RegExp(`width:${maskWidth}px;height:${maskHeight}px;background:#fff`), `${moduleFile} deve coprire tutta la vecchia intestazione`);
    assert.match(html, new RegExp(`ctx\\.fillRect\\(0,0,${maskWidth},${maskHeight}\\)`), `${moduleFile} deve coprire l'intestazione nel PDF`);
  }
});

test('legacy storage and installer identity identifiers stay stable', () => {
  const localStore = fs.readFileSync(new URL('../local_store.py', `file://${__dirname}/`), 'utf8');
  const installer = fs.readFileSync(new URL('../packaging/windows/GestionalePreventivi.iss', `file://${__dirname}/`), 'utf8');

  assert.match(localStore, /AreaTendaPreventivi/);
  assert.match(localStore, /preventivi\.json/);
  assert.match(source, /area-tenda-preventivi/);
  assert.match(source, /area-tenda-quote-manager/);
  assert.match(source, /AREA_TENDA_GESTIONALE_BACKUP/);
  assert.match(installer, /AppId=\{\{2A1F8B7C-0E51-48A1-965E-941B4C2376A0\}/);
  assert.match(installer, /DefaultDirName=\{autopf\}\\Gestionale Preventivi/);
});

test('upgrade configuration is consistently 1.0.7, preserves install paths, and documents WhatsApp checks', () => {
  const installer = fs.readFileSync(new URL('../packaging/windows/GestionalePreventivi.iss', `file://${__dirname}/`), 'utf8');
  const versionInfo = fs.readFileSync(new URL('../packaging/windows/version_info.txt', `file://${__dirname}/`), 'utf8');
  const workflow = fs.readFileSync(new URL('../.github/workflows/windows-installer.yml', `file://${__dirname}/`), 'utf8');
  const instructions = fs.readFileSync(new URL('../docs/INSTALLAZIONE_WINDOWS.md', `file://${__dirname}/`), 'utf8');
  const manuals = [
    fs.readFileSync(new URL('../README_WINDOWS_MAC.md', `file://${__dirname}/`), 'utf8'),
    fs.readFileSync(new URL('../Istruzioni_gestionale.txt', `file://${__dirname}/`), 'utf8')
  ];

  assert.match(installer, /AppVersion "1\.0\.7"/);
  assert.match(installer, /DefaultDirName=\{autopf\}\\Gestionale Preventivi/);
  assert.match(installer, /Flags: ignoreversion/);
  assert.match(versionInfo, /filevers=\(1, 0, 7, 0\)/);
  assert.match(versionInfo, /ProductVersion', '1\.0\.7'/);
  assert.match(workflow, /Gestionale-Preventivi-1\.0\.7-Windows-x64/);
  assert.match(workflow, /-Filter \*\.html\)\.Count -ne 32/);
  assert.match(instructions, /Gestionale Preventivi 1\.0\.7 Setup\.exe/);
  assert.match(instructions, /aggiornamento in-place dalla 1\.0\.5/i);
  assert.match(instructions, /non introduce un updater automatico/i);
  assert.match(instructions, /Windows 10\/11/);
  assert.ok(manuals.every(text => /1\.0\.7/.test(text)));
});

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
  assert.deepEqual(runPhoneNormalizer('+39 (0)2 1234 5678'), { value: '+390212345678', valid: true, empty: false });
});

test('invalid phone prevents client save', async () => {
  const functions = ['normalizePhoneNumber', 'updatePhoneValidation', 'clientFields', 'openFormDialog', 'openClientDialog']
    .map(extractFunction);
  assert.ok(functions.every(Boolean), 'Le funzioni reali del modulo clienti devono essere presenti.');
  let submit;
  let closeCalls = 0;
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
    close() { closeCalls++; },
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
  assert.equal(closeCalls, 0, 'Il dialogo deve restare aperto per correggere il numero e mantenere gli altri dati inseriti.');
});

test('newQuote initializes both send timestamps', () => {
  const newQuoteSource = extractFunction('newQuote');
  assert.ok(newQuoteSource, 'La creazione del preventivo deve restare una funzione osservabile.');
  const state = { quotes: [] };
  const sandbox = {
    state,
    makeId: () => 'new-quote',
    localDateString: () => '2026-11-26',
    Date,
    persistNow() {},
    render() {}
  };
  vm.runInNewContext(`${newQuoteSource}\nthis.newQuote = newQuote;`, sandbox);

  sandbox.newQuote();

  assert.equal(state.quotes[0].sentCustomerAt, null);
  assert.equal(state.quotes[0].sentSupplierAt, null);
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

test('preparing a WhatsApp PDF does not mark a quote sent', async () => {
  const share = extractFunction('shareQuotePdfViaWhatsApp');
  const instructions = extractFunction('setPdfShareInstructions');
  assert.ok(share, 'Il flusso WhatsApp del preventivo deve esistere.');
  const quote = { id: 'q1', sentCustomerAt: null, sentSupplierAt: null };
  const bridgeCalls = [];
  const toasts = [];
  const shareInstructions = { textContent: '', hidden: true };
  const sandbox = {
    desktopBridge: {
      open_whatsapp_chat: async (...args) => { bridgeCalls.push(['open', ...args]); },
      prepare_whatsapp_pdf: async (...args) => { bridgeCalls.push(['attach', ...args]); return { attached: true, filename: 'quote.pdf' }; }
    },
    document: { querySelector: selector => selector === '#pdfShareInstructions' ? shareInstructions : null },
    getQuote: () => quote,
    activeClient: () => ({ phone: '3331234567' }),
    normalizePhoneNumber: value => ({ value: `+39${value}`, valid: true }),
    quoteRevision: async () => 'a'.repeat(64),
    window: { confirm: () => true, prompt: () => '3337654321' },
    generateQuotePdf: async () => ({ path: 'C:/pdf/quote.pdf', revision: 'a'.repeat(64), receipt: { path: 'C:/pdf/quote.pdf', sha256: 'b'.repeat(64) } }),
    showToast: message => toasts.push(message)
  };
  vm.runInNewContext(`${instructions}\n${share}\nthis.shareQuotePdfViaWhatsApp = shareQuotePdfViaWhatsApp;`, sandbox);

  await sandbox.shareQuotePdfViaWhatsApp('customer');

  assert.equal(JSON.stringify(bridgeCalls), JSON.stringify([['open', '393331234567'], ['attach', 'customer', 'C:/pdf/quote.pdf', '393331234567', 'q1', 'a'.repeat(64), [], { path: 'C:/pdf/quote.pdf', sha256: 'b'.repeat(64) }]]));
  assert.match(toasts[0], /Non è stato inviato/);
  assert.equal(shareInstructions.hidden, false);
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

test('supplier module data keeps schema technical fields and removes identity, notes and installation fields', () => {
  const mapper = extractFunction('quoteModuleData');
  assert.ok(mapper, 'Il flusso di preparazione dei moduli deve separare i dati per destinazione PDF.');
  const sandbox = {
    structuredClone,
    quoteModuleData: undefined
  };
  vm.runInNewContext(`${mapper}\nthis.quoteModuleData = quoteModuleData;`, sandbox);
  const originalData = { larghezza: 300, cliente: 'Dato legacy', note: 'riservate', installazioneParete: 'si', prezzo: 1234, sceltaTecnica: 'RAL 9010' };
  const client = { name: 'Cliente Riservato', company: 'Riservata S.r.l.' };
  const quote = { number: 'PREV-2026-0001' };

  const schemaFields = [
    { id: 'larghezza', label: 'Larghezza' }, { id: 'cliente', label: 'Cliente' },
    { id: 'note', label: 'Note' }, { id: 'installazioneParete', label: 'Installazione parete' },
    { id: 'sceltaTecnica', label: 'Colore struttura' }
  ];
  const supplier = sandbox.quoteModuleData('supplier', originalData, client, quote, schemaFields);
  const customer = sandbox.quoteModuleData('customer', originalData, client, quote);

  assert.equal(supplier.cliente, undefined);
  assert.equal(supplier.note, undefined);
  assert.equal(supplier.installazioneParete, undefined);
  assert.equal(supplier.prezzo, undefined);
  assert.equal(supplier.larghezza, 300);
  assert.equal(supplier.sceltaTecnica, 'RAL 9010');
  assert.equal(supplier.riferimento, quote.number);
  assert.equal(customer.cliente, 'Cliente Riservato');
  assert.deepEqual(JSON.parse(JSON.stringify(originalData)), { larghezza: 300, cliente: 'Dato legacy', note: 'riservate', installazioneParete: 'si', prezzo: 1234, sceltaTecnica: 'RAL 9010' });
  assert.throws(() => sandbox.quoteModuleData('supplier', { riferimento: 'Cliente Riservato' }, client, quote, [{ id: 'riferimento' }]), /dati anagrafici del cliente/);
});

test('all 32 module schemas exclude private and installation data while retaining technical fields', () => {
  const mapper = extractFunction('quoteModuleData');
  const sandbox = { structuredClone, quoteModuleData: undefined };
  vm.runInNewContext(`${mapper}\nthis.quoteModuleData = quoteModuleData;`, sandbox);
  const directory = new URL('../Moduli/', `file://${__dirname}/`);
  const moduleFiles = fs.readdirSync(directory).filter(file => file.endsWith('.html'));
  assert.equal(moduleFiles.length, 32);
  const privateKey = /cliente|client|note|prezz|cost|scont|import|totale|installaz|commercial|email|telefono|indirizzo|ragione|vat|fiscal/i;
  for (const file of moduleFiles) {
    const html = fs.readFileSync(new URL(file, directory), 'utf8');
    const rawSchema = html.match(/<script[^>]*id="schema"[^>]*>(.*?)<\/script>/s)?.[1];
    assert.ok(rawSchema, `${file}: schema non disponibile`);
    const schema = JSON.parse(rawSchema);
    const technical = schema.fields.find(field => !privateKey.test(`${field.id} ${field.key || ''}`));
    assert.ok(technical, `${file}: nessun campo tecnico verificabile`);
    const technicalKey = technical.key || technical.id;
    const data = Object.fromEntries(schema.fields.flatMap(field => [[field.id, 'valore'], ...(field.key ? [[field.key, 'valore']] : [])]));
    data.cliente = 'Cliente Riservato';
    data.note = 'Nota riservata';
    const supplier = JSON.parse(JSON.stringify(sandbox.quoteModuleData('supplier', data, { name: 'Cliente Riservato' }, { number: 'PREV-42' }, schema.fields)));
    for (const key of Object.keys(supplier)) assert.ok(!privateKey.test(key), `${file}: campo riservato ${key}`);
    assert.equal(supplier[technicalKey], 'valore', `${file}: campo tecnico ${technicalKey} deve essere mantenuto`);
    assert.equal(supplier.cliente, undefined);
    assert.equal(supplier.note, undefined);
  }
});

test('duplicateQuote preserves quote data with a new identity', () => {
  const duplicate = extractFunction('duplicateQuote');
  assert.ok(duplicate, 'La copia del preventivo deve essere creata da una funzione dedicata.');
  const original = {
    id: 'quote-original', number: 'PREV-2026-0042', createdAt: '2026-01-01', updatedAt: '2026-01-02',
    status: 'inviato', clientId: 'client-1', clientSnapshot: { name: 'Cliente' }, validityDays: 30,
    vatRate: 22, notes: 'Note originali', items: [{ id: 'item-1', moduleId: 'tenda', data: { misura: { width: 300 } }, price: 1200 }],
    sentCustomerAt: '2026-11-25T10:00:00.000Z', sentSupplierAt: '2026-11-25T11:00:00.000Z'
  };
  const sandbox = {
    state: { quotes: [original] },
    structuredClone,
    makeId: () => 'quote-copy',
    localDateString: () => '2026-11-26',
    Date
  };
  vm.runInNewContext(`${duplicate}\nthis.duplicateQuote = duplicateQuote;`, sandbox);

  const copy = sandbox.duplicateQuote(original);

  assert.equal(copy.id, 'quote-copy');
  assert.equal(copy.number, 'PREV-2026-0042-COPIA-001');
  assert.equal(copy.status, 'bozza');
  assert.equal(copy.notes, original.notes);
  assert.deepEqual(JSON.parse(JSON.stringify(copy.items)), JSON.parse(JSON.stringify(original.items)));
  assert.equal(copy.createdAt, '2026-11-26');
  assert.equal(copy.updatedAt, '2026-11-26');
  assert.equal(original.number, 'PREV-2026-0042');
  assert.equal(original.status, 'inviato');
});

test('duplicateQuote clears both send timestamps', () => {
  const duplicate = extractFunction('duplicateQuote');
  assert.ok(duplicate, 'La copia del preventivo deve essere creata da una funzione dedicata.');
  const original = { id: 'q1', number: 'PREV-2026-0001', sentCustomerAt: '2026-01-01', sentSupplierAt: '2026-01-02', items: [] };
  const sandbox = { state: { quotes: [original] }, structuredClone, makeId: () => 'q2', localDateString: () => '2026-11-26', Date };
  vm.runInNewContext(`${duplicate}\nthis.duplicateQuote = duplicateQuote;`, sandbox);

  const copy = sandbox.duplicateQuote(original);

  assert.equal(copy.sentCustomerAt, null);
  assert.equal(copy.sentSupplierAt, null);
});

test('duplicateQuote copies nested module data independently', () => {
  const duplicate = extractFunction('duplicateQuote');
  assert.ok(duplicate, 'La copia del preventivo deve essere creata da una funzione dedicata.');
  const original = { id: 'q1', number: 'PREV-2026-0001', items: [{ id: 'i1', data: { misura: { width: 300 } } }] };
  const sandbox = { state: { quotes: [original] }, structuredClone, makeId: () => 'q2', localDateString: () => '2026-11-26', Date };
  vm.runInNewContext(`${duplicate}\nthis.duplicateQuote = duplicateQuote;`, sandbox);

  const copy = sandbox.duplicateQuote(original);
  copy.items[0].data.misura.width = 999;

  assert.equal(original.items[0].data.misura.width, 300);
});

test('duplicateQuote generates a unique number across the archive', () => {
  const duplicate = extractFunction('duplicateQuote');
  assert.ok(duplicate, 'La copia del preventivo deve essere creata da una funzione dedicata.');
  const original = { id: 'q1', number: 'PREV-2026-0001', items: [] };
  const sandbox = {
    state: { quotes: [original, { number: 'PREV-2026-0001-COPIA-001' }] },
    structuredClone,
    makeId: () => 'q3',
    localDateString: () => '2026-11-26',
    Date
  };
  vm.runInNewContext(`${duplicate}\nthis.duplicateQuote = duplicateQuote;`, sandbox);

  const copy = sandbox.duplicateQuote(original);

  assert.equal(copy.number, 'PREV-2026-0001-COPIA-002');
});

test('quote editor exposes a duplicate action wired separately from save', () => {
  assert.match(source, /data-action="duplicate-quote"/);
  assert.match(source, /action === 'duplicate-quote'/);
  assert.match(source, /data-action="save-quote"/);
});
