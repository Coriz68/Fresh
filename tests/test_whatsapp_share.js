'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const htmlSource = fs.readFileSync(new URL('../Gestione_preventivi.html', `file://${__dirname}/`), 'utf8');
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
      open_whatsapp_browser: async (...args) => { calls.push(`browser:${JSON.stringify(args)}`); return { browserOpened: true }; },
      share_whatsapp_pdf: async (...args) => {
        calls.push(`share:${JSON.stringify(args)}`);
        if (revealError) throw revealError;
        return { clipboardReady: true, path: args[1], desktopOpened: true, browserOpened: false };
      },
      prepare_whatsapp_pdf: async (...args) => {
        calls.push(`attach:${JSON.stringify(args)}`);
        if (revealError) throw revealError;
        const filename = args[1].split('/').pop();
        return { attached: true, filename };
      }
    },
    window: { confirm: () => true, alert: message => calls.push(`alert:${message}`), prompt: (() => { let count = 0; return () => ++count === 1 ? '3337654321' : '1'; })() },
    modules: [{ id: 'tenda', name: 'Tenda da sole' }],
    document: { querySelector: selector => selector === '#pdfShareInstructions' ? shareInstructions : null },
    showToast: message => calls.push(`toast:${message}`),
    whatsappShareActive: false,
    activeWhatsappPdf: null,
    storagePaths: { customer_pdf_dir: '/pdf', supplier_pdf_dir: '/pdf' },
    calls
  };
  vm.runInNewContext(`${instructionsSource};\n${shareSource};\nthis.share = shareQuotePdfViaWhatsApp;`, sandbox);
  return { sandbox, calls, quote, shareInstructions };
}

test('genera i PDF distinti, li prepara per l’invio e non simula Invio', async () => {
  const { sandbox, calls, shareInstructions } = makeSandbox({
    customer: { path: '/pdf/preventivo_quote-42_rev_cliente.pdf', revision: 'a'.repeat(64) },
    supplier: { path: '/pdf/preventivo_quote-42_rev_fornitore.pdf', revision: 'a'.repeat(64), moduleIds: ['item-1'] }
  });

  await sandbox.share('customer');

  assert.equal(calls[0], 'generate:customer:393331234567');
  assert.match(calls[1], /share:\["customer","\/pdf\/preventivo_quote-42_rev_cliente\.pdf","393331234567"/);
  assert.equal(shareInstructions.hidden, false);
  assert.match(shareInstructions.textContent, /pronto per l'invio/);
  assert.match(shareInstructions.textContent, /premi Ctrl\+V nella chat e poi Invio/);

  calls.length = 0;
  await sandbox.share('supplier');
  assert.equal(calls[0], 'generate:supplier:393337654321');
  assert.equal(calls[1], 'modules:["item-1"]');
  assert.match(calls[2], /share:\["supplier","\/pdf\/preventivo_quote-42_rev_fornitore\.pdf","393337654321".*"item-1"/);
  assert.match(shareInstructions.textContent, /pronto per l'invio/);
});

test('blocca prima del bridge un numero normalizzato ma non valido', async () => {
  const { sandbox, calls, shareInstructions } = makeSandbox({
    customer: { path: '/pdf/customer.pdf', revision: 'a'.repeat(64) }
  });
  sandbox.normalizePhoneNumber = () => ({ value: '+39abc', valid: false });

  await sandbox.share('customer');

  assert.ok(!calls.some(call => call.startsWith('generate:') || call.startsWith('share:') || call.startsWith('open:')));
  assert.match(shareInstructions.textContent, /numero.*non valido/i);
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
  assert.ok(calls.some(call => call.includes('share:["supplier","/pdf/supplier.pdf"')));
  assert.ok(calls.some(call => call.includes('share:["customer","/pdf/customer.pdf"')));
});

test('interrompe se il preventivo cambia dopo la generazione e non prepara il PDF obsoleto', async () => {
  const { sandbox, calls, quote, shareInstructions } = makeSandbox({
    customer: { path: '/pdf/customer.pdf', revision: 'a'.repeat(64) }
  });
  sandbox.quoteRevision = async serialized => JSON.parse(serialized).notes ? 'b'.repeat(64) : 'a'.repeat(64);
  sandbox.desktopBridge.share_whatsapp_pdf = async (...args) => { calls.push(`share:${JSON.stringify(args)}`); quote.notes = 'modificato'; return { clipboardReady: true, path: args[1], desktopOpened: true }; };
  await sandbox.share('customer');
  assert.ok(!shareInstructions.textContent.includes('pronto per l’invio'));
  assert.match(shareInstructions.textContent, /preventivo è cambiato/);
});

test('se l’identità del PDF non è verificabile non marca inviato e mostra l’errore', async () => {
  const { sandbox, calls, quote, shareInstructions } = makeSandbox(
    { customer: { path: '/pdf/preventivo_quote-42_rev_cliente.pdf', revision: 'a'.repeat(64) } },
    new Error('Documento non verificabile')
  );

  await sandbox.share('customer');

  assert.equal(quote.sentCustomerAt, null);
  assert.equal(quote.sentSupplierAt, null);
  assert.match(calls.at(-1), /Documento non verificabile/);
  assert.equal(shareInstructions.hidden, false);
  assert.match(shareInstructions.textContent, /Documento non verificabile/);
});

test('se WhatsApp Desktop non si apre il PDF resta pronto anche con fallback browser', async () => {
  const { sandbox, calls, shareInstructions } = makeSandbox({
    customer: { path: '/pdf/customer.pdf', revision: 'a'.repeat(64) }
  });
  sandbox.desktopBridge.share_whatsapp_pdf = async (...args) => {
    calls.push(`share:${JSON.stringify(args)}`);
    return { clipboardReady: true, path: args[1], desktopOpened: false, browserOpened: true };
  };
  await sandbox.share('customer');
  assert.match(shareInstructions.textContent, /PDF CLIENTE pronto per l'invio/);
  assert.match(shareInstructions.textContent, /PDF copiato: premi Ctrl\+V nella chat e poi Invio/);
});

test('i pulsanti cliente e fornitore restano separati e l’invio resta manuale', () => {
  assert.match(source, /data-action="share-pdf-whatsapp" data-kind="customer"/);
  assert.match(source, /data-action="share-pdf-whatsapp" data-kind="supplier"/);
  assert.match(source, /data-action="mark-quote-sent" data-kind="customer"/);
  assert.match(source, /data-action="mark-quote-sent" data-kind="supplier"/);
  assert.match(source, /premi Ctrl\+V nella chat e poi Invio/i);
  assert.match(htmlSource, /data-action="open-whatsapp"/);
  assert.match(htmlSource, /data-action="open-whatsapp-browser"/);
  assert.match(htmlSource, /data-action="open-pdf-folder"/);
  assert.doesNotMatch(source, /WhatsApp Desktop apre la chat senza testo/);
  assert.match(source, /action === 'share-pdf-whatsapp'/);
  assert.match(source, /action === 'mark-quote-sent'/);
});

test('il doppio clic non avvia due condivisioni contemporanee', async () => {
  const { sandbox, calls } = makeSandbox({ customer: { path: '/pdf/customer.pdf', revision: 'a'.repeat(64) } });
  const releases = [];
  sandbox.generateQuotePdf = async (kind, phone) => {
    calls.push(`generate:${kind}:${phone}`);
    await new Promise(resolve => { releases.push(resolve); });
    return { path: '/pdf/customer.pdf', revision: 'a'.repeat(64), receipt: { path: '/pdf/customer.pdf', sha256: 'a'.repeat(64) } };
  };
  const first = sandbox.share('customer');
  const second = sandbox.share('customer');
  releases.forEach(resolve => resolve());
  await Promise.all([first, second]);
  assert.equal(calls.filter(call => call.startsWith('generate:')).length, 1);
});
