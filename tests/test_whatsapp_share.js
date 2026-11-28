'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const shareSource = source.match(/async function shareQuotePdfViaWhatsApp\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
const instructionsSource = source.match(/function setPdfShareInstructions\([^)]*\) \{[\s\S]*?\n\}/)?.[0];

function makeSandbox(pdfByKind, revealError = null) {
  const calls = [];
  const quote = { id: 'quote-42', number: 'PREV-42', items: [{ id: 'item-1', moduleId: 'tenda' }], sentCustomerAt: null, sentSupplierAt: null };
  const shareInstructions = { textContent: '', hidden: true };
  const sandbox = {
    getQuote: () => quote,
    activeClient: () => ({ phone: '3331234567' }),
    normalizePhoneNumber: value => ({ value: `+39${value}`, valid: true }),
    quoteRevision: async () => 'a'.repeat(64),
    generateQuotePdf: async (kind, phone, supplierItemIds) => {
      calls.push(`generate:${kind}:${phone}`);
      if (kind === 'supplier') calls.push(`modules:${JSON.stringify(supplierItemIds)}`);
      const generated = pdfByKind?.[kind] ?? null;
      return generated && { ...generated, receipt: generated.receipt || { path: generated.path, sha256: 'a'.repeat(64) } };
    },
    desktopBridge: {
      open_whatsapp_chat: async phone => { calls.push(`open:${phone}`); },
      copy_whatsapp_pdf_clipboard: async (...args) => ({ clipboardReady: true, path: args[1] }),
      prepare_whatsapp_pdf: async (...args) => {
        calls.push(`attach:${JSON.stringify(args)}`);
        if (revealError) throw revealError;
        const filename = args[1].split('/').pop();
        return { attached: true, filename };
      }
    },
    window: { confirm: () => true, prompt: (() => { let count = 0; return () => ++count === 1 ? '3337654321' : '1'; })() },
    modules: [{ id: 'tenda', name: 'Tenda da sole' }],
    document: { querySelector: selector => selector === '#pdfShareInstructions' ? shareInstructions : null },
    showToast: message => calls.push(`toast:${message}`),
    calls
  };
  vm.runInNewContext(`${instructionsSource};\n${shareSource};\nthis.share = shareQuotePdfViaWhatsApp;`, sandbox);
  return { sandbox, calls, quote, shareInstructions };
}

test('genera PDF separati, apre la chat verificata e allega senza inviare', async () => {
  const { sandbox, calls, shareInstructions } = makeSandbox({
    customer: { path: '/pdf/preventivo_quote-42_rev_cliente.pdf', revision: 'a'.repeat(64) },
    supplier: { path: '/pdf/preventivo_quote-42_rev_fornitore.pdf', revision: 'a'.repeat(64), moduleIds: ['item-1'] }
  });

  await sandbox.share('customer');

  assert.equal(calls[0], 'generate:customer:393331234567');
  assert.equal(calls[1], 'open:393331234567');
  assert.match(calls[2], /attach:\["customer","\/pdf\/preventivo_quote-42_rev_cliente\.pdf"/);
  assert.equal(shareInstructions.hidden, false);
  assert.match(shareInstructions.textContent, /allegato in bozza/);
  assert.match(shareInstructions.textContent, /preventivo_quote-42_rev_cliente\.pdf/);

  calls.length = 0;
  await sandbox.share('supplier');
  assert.equal(calls[0], 'generate:supplier:393337654321');
  assert.equal(calls[1], 'modules:["item-1"]');
  assert.equal(calls[2], 'open:393337654321');
  assert.match(calls[3], /attach:\["supplier","\/pdf\/preventivo_quote-42_rev_fornitore\.pdf".*"item-1"/);
  assert.match(shareInstructions.textContent, /allegato in bozza/);
});

test('se la generazione non produce PDF non apre WhatsApp', async () => {
  const { sandbox, calls } = makeSandbox(null);
  sandbox.getQuote().items = [{ id: 'item-1', moduleId: 'tenda' }];
  sandbox.modules = [{ id: 'tenda', name: 'Tenda da sole' }];

  await sandbox.share('supplier');

  assert.deepEqual(calls, ['generate:supplier:393337654321', 'modules:["item-1"]']);
});

test('prepara fornitore e poi cliente mantenendo i due flussi distinti', async () => {
  const { sandbox, calls } = makeSandbox({
    customer: { path: '/pdf/customer.pdf', revision: 'a'.repeat(64) },
    supplier: { path: '/pdf/supplier.pdf', revision: 'a'.repeat(64), moduleIds: ['item-1'] }
  });
  await sandbox.share('supplier');
  await sandbox.share('customer');
  assert.ok(calls.some(call => call.includes('attach:["supplier","/pdf/supplier.pdf"')));
  assert.ok(calls.some(call => call.includes('attach:["customer","/pdf/customer.pdf"')));
});

test('interrompe se il preventivo cambia dopo la generazione e non prepara il PDF obsoleto', async () => {
  const { sandbox, calls, quote, shareInstructions } = makeSandbox({
    customer: { path: '/pdf/customer.pdf', revision: 'a'.repeat(64) }
  });
  sandbox.quoteRevision = async serialized => JSON.parse(serialized).notes ? 'b'.repeat(64) : 'a'.repeat(64);
  sandbox.desktopBridge.open_whatsapp_chat = async phone => { calls.push(`open:${phone}`); quote.notes = 'modificato'; };
  await sandbox.share('customer');
  assert.ok(!calls.some(call => call.startsWith('attach:')));
  assert.match(shareInstructions.textContent, /preventivo è cambiato/);
});

test('se l’allegato fallisce non marca inviato e mostra l’errore', async () => {
  const { sandbox, calls, quote, shareInstructions } = makeSandbox(
    { customer: { path: '/pdf/preventivo_quote-42_rev_cliente.pdf', revision: 'a'.repeat(64) } },
    new Error('WhatsApp non disponibile')
  );

  await sandbox.share('customer');

  assert.equal(quote.sentCustomerAt, null);
  assert.equal(quote.sentSupplierAt, null);
  assert.match(calls.at(-1), /WhatsApp non disponibile/);
  assert.equal(shareInstructions.hidden, false);
  assert.match(shareInstructions.textContent, /WhatsApp non disponibile/);
});

test('se WhatsApp non si apre copia solo il PDF verificato e mostra la stringa Ctrl+V esatta', async () => {
  const { sandbox, calls, shareInstructions } = makeSandbox({
    customer: { path: '/pdf/customer.pdf', revision: 'a'.repeat(64) }
  });
  sandbox.desktopBridge.open_whatsapp_chat = async () => { throw new Error('WhatsApp chiuso'); };
  await sandbox.share('customer');
  assert.ok(calls.some(call => call.startsWith('toast:PDF CLIENTE pronto. Premi Ctrl+V nella chat WhatsApp per allegarlo')));
  assert.equal(shareInstructions.textContent, 'PDF CLIENTE pronto. Premi Ctrl+V nella chat WhatsApp per allegarlo');
});

test('i pulsanti cliente e fornitore restano separati e l’invio resta manuale', () => {
  assert.match(source, /data-action="share-pdf-whatsapp" data-kind="customer"/);
  assert.match(source, /data-action="share-pdf-whatsapp" data-kind="supplier"/);
  assert.match(source, /data-action="mark-quote-sent" data-kind="customer"/);
  assert.match(source, /data-action="mark-quote-sent" data-kind="supplier"/);
  assert.match(source, /Premi Ctrl\+V nella chat WhatsApp per allegarlo/);
  assert.doesNotMatch(source, /WhatsApp Desktop apre la chat senza testo/);
  assert.match(source, /action === 'share-pdf-whatsapp'/);
  assert.match(source, /action === 'mark-quote-sent'/);
});
