'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const moduleHtml = fs.readFileSync(new URL('../Moduli/tende-da-sole.html', `file://${__dirname}/`), 'utf8');
const makePdfSource = moduleHtml.match(/async function makePDF\(\) \{[\s\S]*?\n\}/)?.[0];

test('Tende da sole: il PDF appiattisce il testo in una sola immagine senza campi PDF duplicati', async () => {
  assert.ok(makePdfSource, 'Il modulo deve esporre la funzione makePDF.');
  const drawnImages = [];
  const pageAnnotationWrites = [];
  const catalogWrites = [];
  const metadata = {};
  const page = {
    getWidth: () => 841.89,
    getHeight: () => 595.28,
    drawImage: (...args) => drawnImages.push(args),
    node: { set: (...args) => pageAnnotationWrites.push(args) },
    ref: 'page-ref'
  };
  const document = {
    getPages: () => [page],
    setTitle: value => { metadata.title = value; },
    setAuthor: value => { metadata.author = value; },
    setCreator: value => { metadata.creator = value; },
    context: {
      obj: value => value,
      register: value => value,
      flateStream: value => value
    },
    catalog: { set: (...args) => catalogWrites.push(args) },
    embedFont: async () => ({ ref: 'font-ref' }),
    embedPng: async bytes => ({ bytes }),
    save: async () => new Uint8Array([37, 80, 68, 70])
  };
  const sandbox = {
    PDFLib: {
      PDFDocument: { load: async () => document },
      PDFName: { of: value => value },
      PDFString: { of: value => value },
      PDFHexString: { fromText: value => value },
      StandardFonts: { Helvetica: 'Helvetica' }
    },
    document: { createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/png;base64,AA==' }) },
    get: () => ({ textContent: 'source-pdf' }),
    model: { width: 1245, height: 872 },
    fields: [],
    paint: () => ({ toDataURL: () => 'data:image/png;base64,AA==' })
  };
  const makePDF = vm.runInNewContext(`(${makePdfSource})`, sandbox);

  await makePDF();

  assert.equal(metadata.author, undefined);
  assert.equal(metadata.creator, undefined);
  assert.equal(drawnImages.length, 1, 'L’immagine con testo e segni deve essere disegnata una volta sola.');
  assert.equal(pageAnnotationWrites.length, 0, 'Il modulo PDF statico non deve aggiungere widget testuali.');
  assert.equal(catalogWrites.length, 0, 'Il modulo PDF statico non deve aggiungere un AcroForm parallelo.');
  assert.equal(drawnImages[0][1].x, 0);
  assert.equal(drawnImages[0][1].y, 0);
  assert.equal(drawnImages[0][1].width, 841.89);
  assert.equal(drawnImages[0][1].height, 595.28);
});
