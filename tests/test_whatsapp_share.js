'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const shareSource = source.match(/async function shareQuotePdfViaWhatsApp\([^)]*\) \{[\s\S]*?\n\}/)?.[0];

function makeSandbox(pdfResult, revealError = null) {
  const calls = [];
  const quote = { number: 'PREV-42', sentCustomerAt: null, sentSupplierAt: null };
  const sandbox = {
    getQuote: () => quote,
    generateQuotePdf: async kind => {
      calls.push(`generate:${kind}`);
      return pdfResult;
    },
    desktopBridge: {
      reveal_pdf_in_explorer: async (...args) => {
        calls.push(`reveal:${JSON.stringify(args)}`);
        if (revealError) throw revealError;
        return { ok: true };
      }
    },
    showToast: message => calls.push(`toast:${message}`),
    calls
  };
  vm.runInNewContext(`${shareSource};\nthis.share = shareQuotePdfViaWhatsApp;`, sandbox);
  return { sandbox, calls, quote };
}

test('genera il PDF e apre Explorer sul file per Condividi → WhatsApp', async () => {
  const { sandbox, calls } = makeSandbox({ path: '/pdf/preventivo_PREV-42_cliente.pdf' });

  await sandbox.share('customer');

  assert.equal(calls[0], 'generate:customer');
  assert.equal(calls[1], 'reveal:["customer","/pdf/preventivo_PREV-42_cliente.pdf"]');
  assert.match(calls[2], /PDF cliente.*Esplora file.*Condividi.*WhatsApp/);

  calls.length = 0;
  await sandbox.share('supplier');
  assert.equal(calls[0], 'generate:supplier');
  assert.equal(calls[1], 'reveal:["supplier","/pdf/preventivo_PREV-42_cliente.pdf"]');
  assert.match(calls[2], /PDF fornitore.*Esplora file.*Condividi.*WhatsApp/);
});

test('se la generazione non produce un PDF non apre Explorer né WhatsApp', async () => {
  const { sandbox, calls } = makeSandbox(null);

  await sandbox.share('supplier');

  assert.deepEqual(calls, ['generate:supplier']);
});

test('se Explorer non si apre il PDF resta salvato e il toast mostra il nome', async () => {
  const { sandbox, calls, quote } = makeSandbox(
    { path: '/pdf/preventivo_PREV-42_cliente.pdf' },
    new Error('Esplora file non disponibile')
  );

  await sandbox.share('customer');

  assert.equal(quote.sentCustomerAt, null);
  assert.equal(quote.sentSupplierAt, null);
  assert.match(calls.at(-1), /Esplora file non disponibile/);
  assert.match(calls.at(-1), /preventivo_PREV-42_cliente\.pdf/);
});

test('i pulsanti cliente e fornitore restano separati e l’invio resta manuale', () => {
  assert.match(source, /data-action="share-pdf-whatsapp" data-kind="customer"/);
  assert.match(source, /data-action="share-pdf-whatsapp" data-kind="supplier"/);
  assert.match(source, /data-action="mark-quote-sent" data-kind="customer"/);
  assert.match(source, /data-action="mark-quote-sent" data-kind="supplier"/);
  assert.match(source, /action === 'share-pdf-whatsapp'/);
  assert.match(source, /action === 'mark-quote-sent'/);
});
