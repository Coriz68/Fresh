'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const extract = name => source.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`))?.[0];

function makeSandbox(items) {
  const calls = [];
  const toasts = [];
  const quote = { id: 'q1', items };
  const sandbox = {
    quote,
    calls,
    toasts,
    getQuote: () => quote,
    getQuoteNow: () => quote,
    modules: [],
    showToast: (message, isError) => toasts.push({ message, isError }),
    generateQuotePdf: async (kind, recipient, ids) => { calls.push({ kind, recipient, ids: [...ids] }); return null; },
    setPdfShareInstructions: () => {},
    quoteRevision: async () => 'x',
    storagePaths: { customer_pdf_dir: 'c', supplier_pdf_dir: 's' },
    desktopBridge: { copy_whatsapp_pdf_clipboard: () => {} },
    whatsappShareActive: false,
    pdfGenerationActive: false,
    document: { querySelectorAll: () => [] },
    window: { prompt: () => { throw new Error('Non deve chiedere quali moduli includere.'); } },
    JSON
  };
  const functions = ['allSupplierItemIds', 'generateSupplierPdfPreview', 'shareQuotePdfViaWhatsApp'].map(extract);
  assert.ok(functions.every(Boolean), 'Le funzioni reali devono essere presenti.');
  vm.runInNewContext(functions.join('\n'), sandbox);
  return sandbox;
}

test('PDF fornitore per WhatsApp: include tutti i moduli senza chiedere la selezione', async () => {
  const sandbox = makeSandbox([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  await sandbox.shareQuotePdfViaWhatsApp('supplier');
  assert.equal(sandbox.calls.length, 1);
  assert.deepEqual(sandbox.calls[0], { kind: 'supplier', recipient: '', ids: ['a', 'b', 'c'] });
});

test('anteprima PDF fornitore: include tutti i moduli senza chiedere la selezione', async () => {
  const sandbox = makeSandbox([{ id: 'a' }, { id: 'b' }]);
  await sandbox.generateSupplierPdfPreview();
  assert.deepEqual(sandbox.calls.map(call => call.ids), [['a', 'b']]);
});

test('preventivo senza moduli: nessun PDF fornitore e messaggio chiaro', async () => {
  const sandbox = makeSandbox([]);
  await sandbox.generateSupplierPdfPreview();
  assert.equal(sandbox.calls.length, 0);
  assert.match(sandbox.toasts[0].message, /almeno un modulo/);
});

test('il gestionale non contiene più la richiesta di selezione dei moduli fornitore', () => {
  assert.doesNotMatch(source, /Seleziona i moduli pertinenti/);
});
