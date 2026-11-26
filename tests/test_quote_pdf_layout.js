'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const pdfSource = fs.readFileSync(new URL('../gestionale-pdf.js', `file://${__dirname}/`), 'utf8');

function makePdfHarness() {
  const pages = [];
  const metadata = {};
  let textMeasureCalls = 0;
  const logoSize = { width: 2048, height: 2048 };
  const regular = {
    widthOfTextAtSize: (text, size) => {
      textMeasureCalls++;
      if (/[\u0000-\u001f\u007f-\u009f]/.test(text)) throw new Error('WinAnsi cannot encode control characters');
      return text.length * size * 0.5;
    }
  };
  const pdf = {
    setTitle(value) { metadata.title = value; },
    setSubject(value) { metadata.subject = value; },
    setAuthor(value) { metadata.author = value; },
    setCreator(value) { metadata.creator = value; },
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
    getPageCount: () => 1,
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
  return { window, pages, metadata, getTextMeasureCalls: () => textMeasureCalls };
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
  const { window, pages, metadata } = makePdfHarness();
  await window.buildQuotePdfDocument(payload, []);

  assert.equal(metadata.author, 'CorradoWEB 2026');
  assert.equal(metadata.creator, 'CorradoWEB 2026');
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

test('PDF cliente: accorcia note molto lunghe con un numero limitato di misurazioni', async () => {
  const harness = makePdfHarness();
  const longQuote = structuredClone(payload);
  longQuote.company.logo = '';
  longQuote.quote.notes = 'Nota '.repeat(2000);

  await harness.window.buildQuotePdfDocument(longQuote, []);

  assert.ok(harness.getTextMeasureCalls() < 100, `Le misurazioni del testo devono restare sotto 100, attuali: ${harness.getTextMeasureCalls()}.`);
});

test('PDF cliente: normalizza note multilinea e rimuove caratteri di controllo', async () => {
  const { window, pages } = makePdfHarness();
  const multilineQuote = structuredClone(payload);
  multilineQuote.company.logo = '';
  multilineQuote.quote.notes = 'Prima riga\r\nSeconda riga\ttabulato\u0085C1';

  await window.buildQuotePdfDocument(multilineQuote, []);

  assert.ok(pages[0].drawTextCalls.some(call => call.text === 'NOTE: Prima riga Seconda riga tabulatoC1'));
});

test('PDF cliente: una nota di un milione di caratteri viene accorciata rapidamente', async () => {
  const harness = makePdfHarness();
  const hugeQuote = structuredClone(payload);
  hugeQuote.company.logo = '';
  hugeQuote.quote.notes = 'X'.repeat(1_000_000);

  await harness.window.buildQuotePdfDocument(hugeQuote, []);

  assert.ok(harness.getTextMeasureCalls() < 100, `Le misurazioni devono restare sotto 100, attuali: ${harness.getTextMeasureCalls()}.`);
  assert.ok(harness.pages[0].drawTextCalls.some(call => call.text.startsWith('NOTE: X') && call.text.endsWith('...')));
});

test('PDF fornitore: conserva cliente e riferimento senza metadati commerciali', async () => {
  const harness = makePdfHarness();

  await harness.window.buildSupplierPdfDocument([], 'PREV-2026-0042', 'Cliente Riservato');

  assert.equal(harness.metadata.author, 'CorradoWEB 2026');
  assert.equal(harness.metadata.creator, 'CorradoWEB 2026');
  assert.match(harness.metadata.title, /Cliente Riservato/);
  assert.match(harness.metadata.subject, /Cliente Riservato/);
  assert.match(harness.metadata.subject, /PREV-2026-0042/);
  assert.doesNotMatch(harness.metadata.title + harness.metadata.subject, /\b(?:totale|prezzo|€)\b/i);
});
