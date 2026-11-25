'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const messageSource = source.match(/function buildWhatsAppMessage\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
const shareSource = source.match(/async function shareQuotePdfViaWhatsApp\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
const quotePdfSource = source.match(/async function generateQuotePdf\([^)]*\) \{[\s\S]*?\n\}/)?.[0];

function makeSandbox(pdfResult) {
  const calls = [];
  const quote = { number: 'PREV-42' };
  const client = { name: 'Cliente Demo' };
  const sandbox = {
    getQuote: () => quote,
    activeClient: () => client,
    generateQuotePdf: async kind => {
      calls.push(`generate:${kind}`);
      return pdfResult;
    },
    desktopBridge: {
      open_whatsapp: async message => calls.push(`open:${message}`)
    },
    showToast: message => calls.push(`toast:${message}`),
    calls
  };
  vm.runInNewContext(`${messageSource};\n${shareSource};\nthis.share = shareQuotePdfViaWhatsApp;`, sandbox);
  return { sandbox, calls };
}

test('condivide il PDF salvato solo dopo averlo generato e include riferimenti distinti', async () => {
  const { sandbox, calls } = makeSandbox({ path: '/pdf/preventivo_PREV-42_cliente.pdf' });

  await sandbox.share('customer');

  assert.equal(calls[0], 'generate:customer');
  assert.match(calls[1], /open:.*PREV-42.*Cliente Demo.*preventivo_PREV-42_cliente\.pdf/);

  calls.length = 0;
  await sandbox.share('supplier');
  assert.equal(calls[0], 'generate:supplier');
  assert.match(calls[1], /open:.*soli moduli.*PREV-42.*Cliente Demo/);
});

test('se il PDF non viene salvato WhatsApp non viene aperto', async () => {
  const { sandbox, calls } = makeSandbox(null);

  await sandbox.share('supplier');

  assert.deepEqual(calls, ['generate:supplier']);
});

test('la pagina preventivo offre due pulsanti desktop e salva il PDF prima del link', () => {
  assert.match(source, /data-action="share-pdf-whatsapp" data-kind="customer"/);
  assert.match(source, /data-action="share-pdf-whatsapp" data-kind="supplier"/);
  assert.match(source, /Scegli il contatto, allega il PDF salvato e conferma l’invio/);
  assert.match(source, /action === 'share-pdf-whatsapp'/);

  const writePosition = quotePdfSource.indexOf('await desktopBridge.write_pdf');
  const savedPosition = quotePdfSource.indexOf('savedPdfPath = saved.path');
  const returnPosition = quotePdfSource.indexOf('return savedPdfPath');
  assert.ok(writePosition >= 0 && writePosition < savedPosition && savedPosition < returnPosition);
});
