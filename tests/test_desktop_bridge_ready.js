'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const waitForDesktopBridge = source.match(/async function waitForDesktopBridge\(\) \{[\s\S]*?\n\}/)?.[0];

test('attende pywebviewready prima di restituire l’API desktop', async () => {
  const listeners = {};
  const api = {};
  const sandbox = {
    window: {
      pywebview: { api },
      addEventListener: (name, listener) => { listeners[name] = listener; }
    },
    setTimeout: () => 1,
    clearTimeout: () => {}
  };
  assert.ok(waitForDesktopBridge, 'La funzione reale di attesa deve essere presente.');
  vm.runInNewContext(`${waitForDesktopBridge}; this.waitForDesktopBridge = waitForDesktopBridge;`, sandbox);

  let settled = false;
  const pending = sandbox.waitForDesktopBridge().then(value => {
    settled = true;
    return value;
  });
  await Promise.resolve();

  assert.equal(settled, false, 'Un oggetto API vuoto non indica che pywebview sia pronto.');
  api.load_initial_data = async () => ({ state: {} });
  listeners.pywebviewready();
  assert.equal(await pending, api);
});
