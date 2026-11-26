'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const extractFunction = name => source.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];
const phoneSource = extractFunction('normalizePhoneNumber');
const shareSource = extractFunction('shareQuotePdfViaWhatsApp');
const quotePdfSource = extractFunction('generateQuotePdf');

function makeSandbox(pdfResult, recipient = '+39 333 123 4567', phoneOptions = {}) {
  const calls = [];
  const quote = { number: 'PREV-42', clientId: 'client-1', sentCustomerAt: null, sentSupplierAt: null };
  const client = { name: 'Cliente Demo', phone: phoneOptions.snapshotPhone || '+390000000000' };
  const currentClient = { name: 'Cliente Demo', phone: phoneOptions.currentPhone ?? '+393331234567' };
  const promptDefaults = [];
  const sandbox = {
    getQuote: () => quote,
    activeClient: () => client,
    getClient: () => currentClient,
    normalizePhoneNumber: undefined,
    window: {
      prompt: (_message, defaultValue) => { promptDefaults.push(defaultValue); return recipient; },
      confirm: message => {
        calls.push(`confirm:${message}`);
        return phoneOptions.confirmResult ?? true;
      }
    },
    generateQuotePdf: async kind => {
      calls.push(`generate:${kind}`);
      return pdfResult;
    },
    desktopBridge: {
      open_whatsapp: async (...args) => calls.push(`open:${JSON.stringify(args)}`),
      attach_whatsapp_pdf: async (...args) => calls.push(`attach:${JSON.stringify(args)}`)
    },
    showToast: message => calls.push(`toast:${message}`),
    calls
  };
  vm.runInNewContext(`${phoneSource};\n${shareSource};\nthis.share = shareQuotePdfViaWhatsApp;`, sandbox);
  return { sandbox, calls, quote, promptDefaults };
}

test('genera il PDF corretto, apre la chat, chiede conferma e allega il file senza inviarlo', async () => {
  const { sandbox, calls } = makeSandbox({ path: '/pdf/preventivo_PREV-42_cliente.pdf' });

  await sandbox.share('customer');

  assert.equal(calls[0], 'generate:customer');
  assert.equal(calls[1], 'open:["+393331234567"]');
  assert.match(calls[2], /confirm:.*393331234567.*preventivo_PREV-42_cliente\.pdf/);
  assert.equal(calls[3], 'attach:["customer","/pdf/preventivo_PREV-42_cliente.pdf",true]');
  assert.match(calls[4], /PDF cliente allegato/);

  calls.length = 0;
  await sandbox.share('supplier');
  assert.equal(calls[0], 'generate:supplier');
  assert.equal(calls[1], 'open:["+393331234567"]');
  assert.match(calls[2], /confirm:.*preventivo_PREV-42_cliente\.pdf/);
  assert.equal(calls[3], 'attach:["supplier","/pdf/preventivo_PREV-42_cliente.pdf",true]');
  assert.match(calls[4], /PDF fornitore allegato/);
});

test('se il PDF non viene salvato WhatsApp non viene aperto', async () => {
  const { sandbox, calls } = makeSandbox(null);

  await sandbox.share('supplier');

  assert.deepEqual(calls, ['generate:supplier']);
});

test('annullare la conferma della chat lascia il PDF salvato e non prova ad allegarlo', async () => {
  const { sandbox, calls } = makeSandbox(
    { path: '/pdf/preventivo_PREV-42_fornitore.pdf' },
    '+39 333 123 4567',
    { confirmResult: false }
  );

  await sandbox.share('supplier');

  assert.equal(calls[0], 'generate:supplier');
  assert.equal(calls[1], 'open:["+393331234567"]');
  assert.match(calls[2], /confirm:/);
  assert.equal(calls.some(call => call.startsWith('attach:')), false);
  assert.match(calls[3], /[Aa]llegato non preparato/);
});

test('un errore durante l’allegato non dichiara il PDF inviato né nasconde il percorso', async () => {
  const { sandbox, calls, quote } = makeSandbox({ path: '/pdf/preventivo_PREV-42_cliente.pdf' });
  sandbox.desktopBridge.attach_whatsapp_pdf = async () => { throw new Error('Controllo UI non disponibile'); };

  await sandbox.share('customer');

  assert.equal(quote.sentCustomerAt, null);
  assert.equal(quote.sentSupplierAt, null);
  assert.match(calls.at(-1), /Allegalo manualmente nella chat/);
  assert.match(calls.at(-1), /preventivo_PREV-42_cliente\.pdf/);
});

test('annullare la scelta del destinatario non genera PDF e non apre WhatsApp', async () => {
  const { sandbox, calls } = makeSandbox({ path: '/pdf/quote.pdf' }, null);

  await sandbox.share('supplier');

  assert.deepEqual(calls, []);
});

test('il destinatario cliente suggerito usa il numero attuale in anagrafica e non la fotografia del preventivo', async () => {
  const { sandbox, promptDefaults } = makeSandbox(
    { path: '/pdf/quote.pdf' },
    '+39 333 765 4321',
    { snapshotPhone: '+390000000000', currentPhone: '+393337654321' }
  );

  await sandbox.share('customer');

  assert.equal(promptDefaults[0], '+393337654321');
});

test('la pagina preventivo mostra due pulsanti e registra separatamente l’invio manuale', () => {
  assert.match(source, /data-action="share-pdf-whatsapp" data-kind="customer"/);
  assert.match(source, /data-action="share-pdf-whatsapp" data-kind="supplier"/);
  assert.match(source, /data-action="mark-quote-sent" data-kind="customer"/);
  assert.match(source, /data-action="mark-quote-sent" data-kind="supplier"/);
  assert.match(source, /Allegalo manualmente nella chat/);
  assert.doesNotMatch(source, /buildWhatsAppMessage|wa\.me|https:\/\/api\.whatsapp/);
  assert.match(source, /action === 'share-pdf-whatsapp'/);
  assert.match(source, /action === 'mark-quote-sent'/);

  const writePosition = quotePdfSource.indexOf('await desktopBridge.write_pdf');
  const savedPosition = quotePdfSource.indexOf('savedPdfPath = saved.path');
  const returnPosition = quotePdfSource.indexOf('return savedPdfPath');
  assert.ok(writePosition >= 0 && writePosition < savedPosition && savedPosition < returnPosition);
});
