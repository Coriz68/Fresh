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

function makeSandbox(pdfResult, recipient = '+39 333 123 4567') {
  const calls = [];
  const quote = { number: 'PREV-42', sentCustomerAt: null, sentSupplierAt: null };
  const client = { name: 'Cliente Demo', phone: '+393331234567' };
  const sandbox = {
    getQuote: () => quote,
    activeClient: () => client,
    normalizePhoneNumber: undefined,
    window: { prompt: () => recipient },
    generateQuotePdf: async kind => {
      calls.push(`generate:${kind}`);
      return pdfResult;
    },
    desktopBridge: {
      open_whatsapp: async (...args) => calls.push(`open:${JSON.stringify(args)}`)
    },
    showToast: message => calls.push(`toast:${message}`),
    calls
  };
  vm.runInNewContext(`${phoneSource};\n${shareSource};\nthis.share = shareQuotePdfViaWhatsApp;`, sandbox);
  return { sandbox, calls, quote };
}

test('genera e salva il PDF corretto prima di aprire WhatsApp senza testo', async () => {
  const { sandbox, calls } = makeSandbox({ path: '/pdf/preventivo_PREV-42_cliente.pdf' });

  await sandbox.share('customer');

  assert.equal(calls[0], 'generate:customer');
  assert.equal(calls[1], 'open:["+393331234567"]');
  assert.match(calls[2], /PDF cliente salvato/);

  calls.length = 0;
  await sandbox.share('supplier');
  assert.equal(calls[0], 'generate:supplier');
  assert.equal(calls[1], 'open:["+393331234567"]');
  assert.match(calls[2], /PDF fornitore salvato/);
});

test('se il PDF non viene salvato WhatsApp non viene aperto', async () => {
  const { sandbox, calls } = makeSandbox(null);

  await sandbox.share('supplier');

  assert.deepEqual(calls, ['generate:supplier']);
});

test('annullare la scelta del destinatario non genera PDF e non apre WhatsApp', async () => {
  const { sandbox, calls } = makeSandbox({ path: '/pdf/quote.pdf' }, null);

  await sandbox.share('supplier');

  assert.deepEqual(calls, []);
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
