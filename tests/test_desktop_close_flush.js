'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(new URL('../gestionale.js', `file://${__dirname}/`), 'utf8');
const flushSource = source.match(/window\.flushDesktopBeforeClose = async \(\) => \{[\s\S]*?\n\};/)?.[0];

function makeSandbox({ pullError = null, moduleOpen = true } = {}) {
  const calls = [];
  const toasts = [];
  const window = {};
  const sandbox = {
    window,
    DESKTOP_MODE: true,
    desktopBridge: {},
    state: { quotes: [] },
    storagePaths: { database_dir: '/local/db' },
    databaseError: '',
    moduleDialog: { open: moduleOpen },
    activeModuleItemId: moduleOpen ? 'item-1' : null,
    modulePullTimer: 5,
    saveTimer: 6,
    clearTimeout: id => calls.push(`clear:${id}`),
    hasMeaningfulState: () => true,
    showToast: message => toasts.push(message),
    pullActiveModule: async () => {
      calls.push('pull');
      if (pullError) throw pullError;
      sandbox.state.quotes.push({ id: 'fresh-module-data' });
    },
    persistNow: async () => {
      calls.push('persist');
      assert.equal(sandbox.state.quotes[0]?.id, 'fresh-module-data');
      return true;
    }
  };
  vm.runInNewContext(flushSource, sandbox);
  return { window, calls, toasts, sandbox };
}

test('prima di uscire importa i dati del modulo aperto e poi salva il database', async () => {
  const { window, calls } = makeSandbox();

  assert.equal(await window.flushDesktopBeforeClose(), true);
  assert.ok(calls.indexOf('pull') < calls.indexOf('persist'));
});

test('se la lettura del modulo fallisce la chiusura viene annullata', async () => {
  const { window, calls, toasts } = makeSandbox({ pullError: new Error('modulo non disponibile') });

  assert.equal(await window.flushDesktopBeforeClose(), false);
  assert.ok(calls.includes('pull'));
  assert.ok(!calls.includes('persist'));
  assert.match(toasts.at(-1), /modulo/i);
});
