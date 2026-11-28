'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const htmlSource = fs.readFileSync(new URL('../Gestione_preventivi.html', `file://${__dirname}/`), 'utf8');
const actionSource = source.match(/async function handleWhatsappPdfAction\([^)]*\) \{[\s\S]*?\n\}/)?.[0];
const macPlatformSource = source.match(/function isMacPlatform\(\) \{[\s\S]*?\n\}/)?.[0];

function makeSandbox({ kind = 'customer', platform = 'Win32', targetOverrides = {}, phone = '3331234567' } = {}) {
  const calls = [];
  const quote = { id: 'quote-42', number: 'PREV-42', items: [{ id: 'item-1', moduleId: 'tenda' }], sentCustomerAt: null, sentSupplierAt: null };
  const instructions = { textContent: '', hidden: true };
  const copyButton = { disabled: false };
  const sandbox = {
    getQuote: () => quote,
    activeClient: () => ({ phone }),
    normalizePhoneNumber: value => {
      const clean = String(value || '').trim().replace(/[\s().-]/g, '').replace(/^00/, '+');
      const normalized = clean.startsWith('+') ? clean : `+39${clean}`;
      return { value: normalized, valid: /^\+[1-9]\d{7,14}$/.test(normalized), empty: !clean };
    },
    quoteRevision: async () => 'a'.repeat(64),
    desktopBridge: {
      copy_whatsapp_pdf_clipboard: async (...args) => { calls.push(['copy', ...args]); return { clipboardReady: true, path: args[1], filename: args[1].split(/[\\/]/).pop() }; },
      open_whatsapp_chat: async (...args) => { calls.push(['chat', ...args]); return { ok: true, method: 'protocol' }; },
      open_whatsapp_browser: async (...args) => { calls.push(['browser', ...args]); return { browserOpened: true }; },
      reveal_pdf_in_explorer: async (...args) => { calls.push(['folder', ...args]); return { ok: true }; }
    },
    window: { navigator: { platform }, prompt: () => '0039 333 7654321' },
    document: { querySelector: selector => selector === '#pdfShareInstructions' ? instructions : selector === '#copyPdfButton' ? copyButton : null },
    showToast: message => calls.push(['toast', message]),
    setPdfShareInstructions: message => { instructions.textContent = message; instructions.hidden = false; },
    whatsappShareActive: false,
    pdfGenerationActive: false,
    activeWhatsappPdf: {
      kind,
      path: `/pdf/preventivo_quote-42_${'a'.repeat(12)}_${kind === 'customer' ? 'cliente' : 'fornitore'}.pdf`,
      quoteId: 'quote-42',
      revision: 'a'.repeat(64),
      moduleIds: kind === 'supplier' ? ['item-1'] : [],
      receipt: { path: `/pdf/preventivo_quote-42_${'a'.repeat(12)}_${kind === 'customer' ? 'cliente' : 'fornitore'}.pdf`, sha256: 'b'.repeat(64) },
      recipient: '',
      ...targetOverrides
    },
    calls
  };
  vm.runInNewContext(`${macPlatformSource};\n${actionSource};\nthis.handle = handleWhatsappPdfAction;`, sandbox);
  return { sandbox, calls, instructions, quote, copyButton };
}

test('anteprima espone le tre azioni con etichetta Copia PDF dipendente dal tipo', () => {
  assert.match(htmlSource, /id="copyPdfButton"[^>]*data-action="copy-pdf"/);
  assert.match(htmlSource, /Copia PDF cliente/);
  assert.match(source, /kind === 'customer' \? 'Copia PDF cliente' : 'Copia PDF fornitore'/);
  assert.match(htmlSource, /data-action="open-whatsapp"[^>]*>Apri chat WhatsApp/);
  assert.match(htmlSource, /data-action="open-pdf-folder"[^>]*>Apri cartella/);
  assert.doesNotMatch(htmlSource, /open-whatsapp-browser/);
});

test('Copia PDF usa il documento corrente, verifica il percorso e dà istruzioni Ctrl+V', async () => {
  const { sandbox, calls, instructions } = makeSandbox();
  await sandbox.handle('copy-pdf');
  assert.equal(calls[0][0], 'copy');
  assert.equal(calls[0][1], 'customer');
  assert.match(instructions.textContent, /PDF copiato: preventivo_quote-42/);
  assert.match(instructions.textContent, /Apri la chat e premi Ctrl\+V/);
  assert.equal(calls.some(call => call[0] === 'chat'), false);
});

test('Apri chat valida +39 e 00 prima del bridge e non modifica gli appunti', async () => {
  const { sandbox, calls, instructions } = makeSandbox();
  await sandbox.handle('open-whatsapp');
  const chat = calls.find(call => call[0] === 'chat');
  assert.deepEqual(chat.slice(1), ['393331234567', 'Buongiorno, condivido il PDF del preventivo PREV-42.']);
  assert.equal(calls.some(call => call[0] === 'copy'), false);
  assert.match(instructions.textContent, /Chat WhatsApp aperta/i);

  calls.length = 0;
  sandbox.window.prompt = () => '+39 333 765 4321';
  sandbox.activeWhatsappPdf.kind = 'supplier';
  await sandbox.handle('open-whatsapp');
  assert.equal(calls.find(call => call[0] === 'chat')[1], '393337654321');
  assert.equal(calls.some(call => call[0] === 'copy'), false);
});

test('numero non valido blocca l’apertura prima del bridge', async () => {
  const { sandbox, calls, instructions } = makeSandbox({ phone: '123' });
  await sandbox.handle('open-whatsapp');
  assert.equal(calls.some(call => call[0] === 'chat' || call[0] === 'browser'), false);
  assert.match(instructions.textContent, /numero WhatsApp.*non valido/i);
});

test('cartella PDF è un’azione indipendente', async () => {
  const { sandbox, calls } = makeSandbox();
  await sandbox.handle('open-pdf-folder');
  assert.equal(calls[0][0], 'folder');
  assert.equal(calls.some(call => call[0] === 'copy' || call[0] === 'chat'), false);
});

test('copia non verificata mostra un errore e suggerisce Apri cartella', async () => {
  const { sandbox, calls, instructions } = makeSandbox();
  sandbox.desktopBridge.copy_whatsapp_pdf_clipboard = async (...args) => {
    calls.push(['copy', ...args]);
    return { clipboardReady: false, path: '/pdf/altro.pdf' };
  };
  await sandbox.handle('copy-pdf');
  assert.match(instructions.textContent, /Copia PDF non riuscita/);
  assert.match(instructions.textContent, /Usa Apri cartella/);
  assert.equal(calls.some(call => call[0] === 'chat'), false);
});

test('doppio clic su copia è serializzato e non sovrascrive l’azione', async () => {
  const { sandbox, calls } = makeSandbox();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  sandbox.desktopBridge.copy_whatsapp_pdf_clipboard = async (...args) => {
    calls.push(['copy', ...args]);
    await gate;
    return { clipboardReady: true, path: args[1], filename: args[1].split('/').pop() };
  };
  const first = sandbox.handle('copy-pdf');
  const second = sandbox.handle('copy-pdf');
  for (let index = 0; index < 10 && !calls.some(call => call[0] === 'copy'); index++) await Promise.resolve();
  release();
  await Promise.all([first, second]);
  assert.equal(calls.filter(call => call[0] === 'copy').length, 1);
});

test('l’anteprima non confonde copia, apertura chat e invio effettivo', () => {
  assert.doesNotMatch(actionSource, /markQuoteSent|sentCustomerAt|sentSupplierAt/);
  assert.match(actionSource, /PDF copiato/);
  assert.match(actionSource, /Chat aperta/);
  assert.match(source, /data-action="mark-quote-sent" data-kind="customer"/);
  assert.match(source, /data-action="mark-quote-sent" data-kind="supplier"/);
  assert.match(source, /pdfGenerationActive = true/);
});
