'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const html = fs.readFileSync(new URL('../Gestione_preventivi.html', `file://${__dirname}/`), 'utf8');
const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');

test('la finestra desktop mostra il comando di uscita che richiama la chiusura sicura', () => {
  assert.match(html, /id="closeAppButton"/);
  assert.match(source, /closeAppButton/);
  assert.match(source, /desktopBridge\.request_close\(\)/);
});
