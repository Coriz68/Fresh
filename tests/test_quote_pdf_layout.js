'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const pdfSource = fs.readFileSync(new URL('../gestionale-pdf.js', `file://${__dirname}/`), 'utf8');

function makePdfHarness() {
  const pages = [];
  const logoSize = { width: 2048, height: 2048 };
  const regular = { widthOfTextAtSize: (text, size) => text.length * size * 0.5 };
  const pdf = {
    setTitle() {},
    setAuthor() {},
    embedFont: async () => regular,
    embedPng: async () => logoSize,
    embedJpg: async () => logoSize,
    addPage: () => {
      const page = {
        drawTextCalls: [], drawImageCalls: [], rectangleCalls: [], lineCalls: [],
        drawText(text, options) { this.drawTextCalls.push({ text, ...options }); },
        drawImage(image, options) { this.drawImageCalls.push({ image, ...options }); },
        drawRectangle(options) { this.rectangleCalls.push(options); },
        drawLine(options) { this.lineCalls.push(options); }
      };
      pages.push(page);
      return page;
    },
    copyPages: async () => [],
    getPageIndices: () => [],
    save: async () => new Uint8Array([37, 80, 68, 70])
  };
  const window = {
    PDFLib: {
      PDFDocument: { create: async () => pdf, load: async () => pdf },
      StandardFonts: { Helvetica: 'Helvetica', HelveticaBold: 'HelveticaBold' },
      rgb: (r, g, b) => ({ r, g, b })
    }
  };
  const sandbox = {
    window,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    Uint8Array,
    Intl,
    Date,
    Math,
    Number,
    String
  };
  vm.runInNewContext(pdfSource, sandbox);
  return { window, pages };
}

const payload = {
  company: {
    name: 'Fresh', address: 'Via Roma 1', postalCode: '60025', city: 'Loreto', province: 'AN',
    vatNumber: 'IT01234567890', taxCode: '', phone: '071 000000', email: 'info@example.it',
    website: 'fresh.example', footerNotes: 'Preventivo valido 30 giorni', logo: 'data:image/png;base64,AA=='
  },
  client: { name: 'Cliente Demo', company: 'Cliente S.r.l.', address: 'Via Verdi 5', postalCode: '60025', city: 'Loreto', province: 'AN', email: 'cliente@example.it', phone: '' },
  quote: {
    number: 'PREV-2026-0042', createdAt: '2026-11-12', validityDays: 30, vatRate: 22, notes: 'Installazione inclusa.',
    items: [{ moduleId: 'tenda', quantity: 2, price: 1250, discount: 10 }]
  },
  models: [{ id: 'tenda', name: 'Tenda da sole' }]
};

test('PDF cliente: il logo Fresh è più grande e il riepilogo usa una gerarchia grafica professionale', async () => {
  const { window, pages } = makePdfHarness();
  await window.buildQuotePdfDocument(payload, []);

  const [page] = pages;
  const [logo] = page.drawImageCalls;
  assert.ok(logo.height >= 100, `Il logo deve avere un’altezza di almeno 100 pt (attuale: ${logo.height}).`);
  assert.ok(page.rectangleCalls.some(rect => rect.color.r < 0.2 && rect.color.g > 0.35), 'Il numero preventivo deve avere un riquadro di evidenza verde petrolio.');
  assert.ok(page.rectangleCalls.some(rect => rect.color.r > 0.9 && rect.color.g > 0.93), 'Il riepilogo deve distinguere le righe con fondi leggeri.');
  assert.ok(page.drawTextCalls.some(call => call.text === 'PREV-2026-0042'), 'Il riferimento preventivo deve rimanere ben visibile.');
  assert.ok(page.drawTextCalls.some(call => call.text === 'TOTALE: 2.745,00 €' || call.text === 'TOTALE: 2745,00 €'), 'Il totale IVA inclusa deve rimanere presente.');
});

test('PDF cliente: riepiloghi lunghi proseguono su più pagine mantenendo riferimento e totale', async () => {
  const { window, pages } = makePdfHarness();
  const longQuote = structuredClone(payload);
  longQuote.company.logo = '';
  longQuote.quote.items = Array.from({ length: 10 }, (_, index) => ({
    moduleId: 'tenda', quantity: 1, price: 100 + index, discount: 0
  }));

  await window.buildQuotePdfDocument(longQuote, []);

  assert.equal(pages.length, 2, 'Dieci righe devono essere distribuite su due pagine di riepilogo.');
  assert.ok(pages[1].drawTextCalls.some(call => call.text === 'CLIENTE: Cliente Demo'));
  assert.ok(pages[1].drawTextCalls.some(call => call.text === 'PREV-2026-0042'));
  assert.ok(pages[1].drawTextCalls.some(call => call.text.startsWith('TOTALE:')));
});

test('PDF cliente: note e piè di pagina su più righe non bloccano la generazione', async () => {
  const { window, pages } = makePdfHarness();
  // Come le font standard di pdf-lib (WinAnsi), che non codificano i caratteri di controllo.
  const strictFont = {
    widthOfTextAtSize(text, size) {
      if (/[\u0000-\u001f]/.test(text)) throw new Error(`WinAnsi cannot encode ${JSON.stringify(text)}`);
      return text.length * size * 0.5;
    }
  };
  const created = await window.PDFLib.PDFDocument.create();
  created.embedFont = async () => strictFont;
  const multiline = structuredClone(payload);
  multiline.company.footerNotes = 'IBAN IT00 X000 0000 0000\nPagamento 30 gg';
  multiline.quote.notes = 'Prima riga delle note.\r\nSeconda riga\tcon tabulazione.\n\nTerza riga.';

  await window.buildQuotePdfDocument(multiline, []);

  const texts = pages[0].drawTextCalls.map(call => call.text);
  assert.ok(texts.every(text => !/[\u0000-\u001f]/.test(text)), 'Nessun testo del PDF può contenere caratteri di controllo.');
  assert.ok(texts.includes('NOTE: Prima riga delle note.'), 'Ogni riga delle note va su una riga del PDF.');
  assert.ok(texts.includes('Seconda riga con tabulazione.'));
  assert.ok(texts.includes('Terza riga.'));
  assert.ok(texts.includes('IBAN IT00 X000 0000 0000 · Pagamento 30 gg'), 'Il piè di pagina resta su una riga.');
});
