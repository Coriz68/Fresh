'use strict';

const DB_NAME = 'area-tenda-preventivi';
const DB_VERSION = 1;
const STORE_NAME = 'appState';
const CHANNEL = 'area-tenda-quote-manager';
const DESKTOP_MODE = new URLSearchParams(location.search).get('desktop') === '1';
const app = document.querySelector('#app');
const frame = document.querySelector('#moduleFrame');
const moduleDialog = document.querySelector('#moduleDialog');
const formDialog = document.querySelector('#formDialog');
const pdfDialog = document.querySelector('#pdfDialog');
const toast = document.querySelector('#toast');

let db;
let state;
let desktopBridge = null;
let storagePaths = { database_dir: '', customer_pdf_dir: '', supplier_pdf_dir: '' };
let databaseError = '';
let modules = [];
let currentPage = 'dashboard';
let currentQuoteId = null;
let activeModuleItemId = null;
let pendingRequests = new Map();
let saveQueue = Promise.resolve();
let saveTimer;
let lastSaveError = null;
let modulePullTimer;
let toastTimer;
let pdfUrl = '';
let generatedPdfBytes = null;
let generatedPdfKind = 'customer';
let pdfGenerationActive = false;

const emptyState = () => ({
  clients: [],
  quotes: [],
  prices: {},
  company: {
    name: '',
    address: '',
    postalCode: '',
    city: '',
    province: '',
    vatNumber: '',
    taxCode: '',
    phone: '',
    email: '',
    website: '',
    footerNotes: '',
    logo: ''
  }
});

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function money(value) {
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(value) || 0);
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(date.valueOf()) ? '—' : new Intl.DateTimeFormat('it-IT').format(date);
}

function dateTimeLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? '—'
    : new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function makeId() {
  return crypto.randomUUID();
}

function showToast(message, isError = false) {
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
}

function showPdfProgress(message) {
  toast.textContent = message;
  toast.classList.remove('error');
  toast.classList.add('show');
  clearTimeout(toastTimer);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Impossibile aprire il database locale.'));
    request.onblocked = () => reject(new Error('Chiudi le altre schede del gestionale e riprova.'));
  });
}

async function waitForDesktopBridge() {
  const api = () => {
    const candidate = window.pywebview?.api;
    return typeof candidate?.load_initial_data === 'function' ? candidate : null;
  };
  if (api()) return api();
  if (!DESKTOP_MODE) return null;
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 15000);
    window.addEventListener('pywebviewready', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
  return api();
}

function readState() {
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get('main');
    request.onsuccess = () => resolve(request.result?.value || null);
    request.onerror = () => reject(request.error || new Error('Impossibile leggere i dati locali.'));
  });
}

function writeState(snapshot) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put({ id: 'main', value: snapshot });
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Impossibile salvare i dati locali.'));
    transaction.onabort = () => reject(transaction.error || new Error('Salvataggio locale annullato.'));
  });
}

function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void persistNow(); }, 350);
}

function logDesktopEvent(event) {
  if (typeof desktopBridge?.log_event !== 'function') return;
  try {
    Promise.resolve(desktopBridge.log_event(event)).catch(() => undefined);
  } catch {
    // Diagnostics must never interrupt saving or PDF generation.
  }
}

function persistNow() {
  clearTimeout(saveTimer);
  if (!state) return Promise.resolve(false);
  const snapshot = structuredClone(state);
  if (desktopBridge && (!storagePaths.database_dir || databaseError)) {
    lastSaveError = new Error(databaseError || 'Scegli prima la cartella del database locale.');
    showToast(lastSaveError.message, true);
    return Promise.resolve(false);
  }
  logDesktopEvent('state_save_started');
  const pendingSave = saveQueue
    .catch(() => undefined)
    .then(() => desktopBridge ? desktopBridge.save_state(snapshot) : writeState(snapshot));
  saveQueue = pendingSave.then(() => {
    lastSaveError = null;
    logDesktopEvent('state_save_succeeded');
    return true;
  }).catch(error => {
    lastSaveError = error;
    logDesktopEvent('state_save_failed');
    showToast(`Errore di salvataggio: ${error.message}`, true);
    return false;
  });
  return saveQueue;
}

window.flushDesktopBeforeClose = async () => {
  clearTimeout(saveTimer);
  if (!DESKTOP_MODE || !desktopBridge || !state) return true;
  if (!storagePaths.database_dir || databaseError) {
    if (hasMeaningfulState()) {
      showToast(databaseError || 'Scegli una cartella database prima di chiudere: i dati non sono ancora salvati.', true);
      return false;
    }
    return true;
  }
  if (moduleDialog.open && activeModuleItemId) {
    clearTimeout(modulePullTimer);
    try {
      await pullActiveModule();
    } catch (error) {
      showToast(`Impossibile salvare il modulo aperto: ${error.message}`, true);
      return false;
    }
  }
  return persistNow();
};

async function loadCatalog() {
  const response = await fetch('Apri_catalogo.html');
  if (!response.ok) throw new Error(`Catalogo non disponibile (${response.status}).`);
  const text = await response.text();
  const documentCopy = new DOMParser().parseFromString(text, 'text/html');
  const entries = [...documentCopy.querySelectorAll('a[href^="Moduli/"]')].map(link => {
    const path = link.getAttribute('href');
    const category = link.closest('section')?.querySelector('h2')?.textContent.trim();
    return {
      id: path.split('/').pop().replace(/\.html$/i, ''),
      path,
      name: [category, link.textContent.trim()].filter(Boolean).join(' · ')
    };
  });
  if (!entries.length) throw new Error('Non trovo moduli nel catalogo originale.');
  return entries;
}

function getQuote(id = currentQuoteId) {
  return state.quotes.find(quote => quote.id === id);
}

function getClient(id) {
  return state.clients.find(client => client.id === id);
}

function clientLabel(client) {
  if (!client) return 'Cliente non selezionato';
  return client.name || client.company || 'Cliente senza nome';
}

function snapshotClient(client) {
  if (!client) return null;
  return {
    name: client.name || '',
    company: client.company || '',
    taxCode: client.taxCode || '',
    vatNumber: client.vatNumber || '',
    address: client.address || '',
    postalCode: client.postalCode || '',
    city: client.city || '',
    province: client.province || '',
    phone: client.phone || '',
    email: client.email || ''
  };
}

function normalizePhoneNumber(value) {
  const original = String(value ?? '').trim();
  if (!original) return { value: '', valid: true, empty: true };
  let normalized = original.replace(/\(\s*0\s*\)/g, '').replace(/[\s().-]/g, '');
  if (normalized.startsWith('00')) normalized = `+${normalized.slice(2)}`;
  else if (!normalized.startsWith('+')) normalized = `+39${normalized}`;
  const valid = /^\+[1-9]\d{7,14}$/.test(normalized);
  return { value: normalized, valid, empty: false };
}

function updatePhoneValidation(input) {
  const result = normalizePhoneNumber(input.value);
  const feedback = formDialog.querySelector('#phoneValidation');
  input.setAttribute('aria-invalid', result.empty || result.valid ? 'false' : 'true');
  if (feedback) {
    feedback.textContent = result.empty || result.valid ? '' : 'Numero non valido. Usa un numero nazionale o internazionale con 8–15 cifre.';
    feedback.hidden = result.empty || result.valid;
  }
  return result;
}

function activeClient(quote) {
  return quote.clientSnapshot || snapshotClient(getClient(quote.clientId));
}

function quoteModuleData(kind, originalData, client, quote) {
  return {
    ...structuredClone(originalData || {}),
    cliente: client.name || client.company || '',
    riferimento: quote.number
  };
}

function quoteTotals(quote) {
  const lines = quote.items.map(item => {
    const quantity = Math.max(0, Number(item.quantity) || 0);
    const price = Math.max(0, Number(item.price) || 0);
    const discount = Math.min(100, Math.max(0, Number(item.discount) || 0));
    const listTotal = quantity * price;
    const discountTotal = listTotal * discount / 100;
    return { listTotal, discountTotal, netTotal: listTotal - discountTotal };
  });
  const listTotal = lines.reduce((sum, line) => sum + line.listTotal, 0);
  const discountTotal = lines.reduce((sum, line) => sum + line.discountTotal, 0);
  const netTotal = lines.reduce((sum, line) => sum + line.netTotal, 0);
  const vatRate = Math.max(0, Number(quote.vatRate) || 0);
  const vatTotal = netTotal * vatRate / 100;
  return { lines, listTotal, discountTotal, netTotal, vatRate, vatTotal, grossTotal: netTotal + vatTotal };
}

function quoteStatusClass(status) {
  return ({ inviato: 'sent', accettato: 'accepted', archiviato: 'closed' })[status] || '';
}

function quoteSendStatusMarkup(quote) {
  const customer = quote.sentCustomerAt
    ? `Inviato il ${esc(dateTimeLabel(quote.sentCustomerAt))}`
    : 'Non inviato';
  const supplier = quote.sentSupplierAt
    ? `Inviato il ${esc(dateTimeLabel(quote.sentSupplierAt))}`
    : 'Non inviato';
  return `<div class="send-indicators"><span><b>PDF cliente</b> · ${customer}</span><span><b>PDF fornitore</b> · ${supplier}</span></div>`;
}

function setPage(page) {
  currentPage = page;
  render();
}

function renderHeader() {
  const labels = {
    dashboard: ['Gestionale', 'Dashboard'],
    quotes: ['Gestione', 'Preventivi'],
    clients: ['Gestione', 'Clienti'],
    prices: ['Configurazione', 'Listino articoli'],
    company: ['Configurazione', 'Azienda e PDF'],
    quote: ['Preventivi', getQuote()?.number || 'Nuovo preventivo']
  };
  const [breadcrumb, title] = labels[currentPage] || labels.dashboard;
  document.querySelector('#breadcrumbs').textContent = breadcrumb;
  document.querySelector('#pageTitle').textContent = title;
  document.querySelector('#quoteCount').textContent = String(state.quotes.length);
  document.querySelectorAll('.nav-item[data-page]').forEach(button => {
    const activePage = currentPage === 'quote' ? 'quotes' : currentPage;
    button.classList.toggle('active', button.dataset.page === activePage);
  });
}

function render() {
  if (!state) return;
  renderHeader();
  if (currentPage === 'quote') renderQuote();
  else if (currentPage === 'quotes') renderQuotes();
  else if (currentPage === 'clients') renderClients();
  else if (currentPage === 'prices') renderPrices();
  else if (currentPage === 'company') renderCompany();
  else renderDashboard();
}

function renderDashboard() {
  const openQuotes = state.quotes.filter(quote => !['accettato', 'archiviato'].includes(quote.status)).length;
  const totalClients = state.clients.length;
  const latest = [...state.quotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
  app.innerHTML = `
    <div class="stat-grid">
      <section class="card stat"><div class="stat-label">Preventivi totali</div><div class="stat-value">${state.quotes.length}</div><div class="stat-foot">${desktopBridge ? 'Salvati sul disco locale' : 'Salvati in questo browser'}</div></section>
      <section class="card stat"><div class="stat-label">In lavorazione</div><div class="stat-value">${openQuotes}</div><div class="stat-foot">Bozze e preventivi inviati</div></section>
      <section class="card stat"><div class="stat-label">Clienti registrati</div><div class="stat-value">${totalClients}</div><div class="stat-foot">Anagrafiche disponibili</div></section>
    </div>
    ${desktopBridge && !storagePaths.database_dir ? '<p class="notice">Seleziona la cartella del database in “Azienda e PDF” prima di inserire i dati.</p>' : ''}
    ${databaseError ? `<p class="notice">${esc(databaseError)}. Scegli una cartella database valida in “Azienda e PDF”. Il file non è stato modificato.</p>` : ''}
    ${!state.company.name ? '<p class="notice">Completa i dati aziendali e il logo in “Azienda e PDF”; configura il listino prima di inviare i primi preventivi.</p>' : ''}
    <div class="content-grid">
      <section class="card">
        <div class="card-head"><div><h2>Preventivi recenti</h2><p>Apri una bozza per rivederla o modificarla.</p></div><button class="button small" data-page="quotes">Tutti i preventivi</button></div>
        ${renderQuoteTable(latest)}
      </section>
      <section class="card">
        <div class="card-head"><div><h2>Configurazione iniziale</h2><p>Passi consigliati prima di creare il PDF cliente.</p></div></div>
        <div class="stack">
          <div><span class="badge">${state.company.name ? 'Completato' : 'Da configurare'}</span><p class="client-detail"><a class="module-link" href="#" data-page="company">Dati aziendali, intestazione e note PDF →</a></p></div>
          <div><span class="badge">${Object.keys(state.prices).length ? 'Iniziato' : 'Da configurare'}</span><p class="client-detail"><a class="module-link" href="#" data-page="prices">Inserisci i prezzi di listino dei moduli →</a></p></div>
          <div class="footer-note">${desktopBridge ? 'Il gestionale non usa servizi cloud: clienti, preventivi e impostazioni restano nel database locale scelto.' : 'Il gestionale non usa servizi cloud: clienti, preventivi e impostazioni restano nel database del browser su questo computer.'} Esporta periodicamente un backup.</div>
        </div>
      </section>
    </div>`;
}

function renderQuoteTable(quotes) {
  if (!quotes.length) return '<div class="empty"><strong>Nessun preventivo</strong>Crea il primo preventivo per iniziare.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>NUMERO</th><th>CLIENTE</th><th>AGGIORNATO</th><th>STATO</th><th>INVII PDF</th><th class="right">TOTALE SCONTATO</th><th></th></tr></thead><tbody>${quotes.map(quote => {
    const client = activeClient(quote);
    const totals = quoteTotals(quote);
    return `<tr><td><b>${esc(quote.number)}</b></td><td>${esc(clientLabel(client))}</td><td>${dateLabel(quote.updatedAt)}</td><td><span class="status ${quoteStatusClass(quote.status)}">${esc(quote.status || 'bozza')}</span></td><td>${quoteSendStatusMarkup(quote)}</td><td class="right">${money(totals.netTotal)}</td><td><div class="row-actions"><button class="button small" data-action="open-quote" data-id="${esc(quote.id)}">Apri</button><button class="button small danger" data-action="delete-quote" data-id="${esc(quote.id)}" aria-label="Elimina ${esc(quote.number)}">×</button></div></td></tr>`;
  }).join('')}</tbody></table></div>`;
}

function renderQuotes() {
  const quotes = [...state.quotes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  app.innerHTML = `
    <section class="card">
      <div class="card-head"><div><h2>Archivio preventivi</h2><p>Rivedi, modifica o genera nuovamente il PDF di un preventivo.</p></div><div class="toolbar"><input class="input search" id="quoteSearch" placeholder="Cerca numero o cliente"><button class="button primary" data-action="new-quote">＋ Nuovo preventivo</button></div></div>
      <div id="quotesTable">${renderQuoteTable(quotes)}</div>
    </section>`;
}

function renderQuoteSearchResults(query) {
  const normalizedQuery = query.trim().toLocaleLowerCase('it');
  const quotes = [...state.quotes]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter(quote => {
      if (!normalizedQuery) return true;
      const client = activeClient(quote);
      const searchable = [quote.number, client?.name, client?.company]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('it');
      return searchable.includes(normalizedQuery);
    });
  if (normalizedQuery && !quotes.length) {
    return '<div class="empty"><strong>Nessun risultato</strong>Prova con un altro numero o nome cliente.</div>';
  }
  return renderQuoteTable(quotes);
}

function renderClients() {
  const clients = [...state.clients].sort((a, b) => clientLabel(a).localeCompare(clientLabel(b), 'it'));
  app.innerHTML = `
    <section class="card">
      <div class="card-head"><div><h2>Anagrafica clienti</h2><p>I dati vengono copiati nel preventivo per conservarne lo storico.</p></div><button class="button primary" data-action="new-client">＋ Nuovo cliente</button></div>
      ${clients.length ? `<div class="table-wrap"><table><thead><tr><th>CLIENTE</th><th>PARTITA IVA / C.F.</th><th>CONTATTI</th><th>INDIRIZZO</th><th></th></tr></thead><tbody>${clients.map(client => `<tr><td><b>${esc(clientLabel(client))}</b>${client.company ? `<div class="article-sub">${esc(client.company)}</div>` : ''}</td><td>${esc(client.vatNumber || client.taxCode || '—')}</td><td>${esc(client.email || '—')}<div class="article-sub">${esc(client.phone || '')}</div></td><td>${esc([client.address, client.postalCode, client.city, client.province].filter(Boolean).join(', ') || '—')}</td><td><div class="row-actions"><button class="button small" data-action="edit-client" data-id="${esc(client.id)}">Modifica</button><button class="button small danger" data-action="delete-client" data-id="${esc(client.id)}">Elimina</button></div></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><strong>Nessun cliente registrato</strong>Aggiungi un’anagrafica prima di creare il preventivo.</div>'}
    </section>`;
}

function renderPrices() {
  app.innerHTML = `
    <section class="card">
      <div class="card-head"><div><h2>Listino articoli</h2><p>Prezzo unitario in euro per ciascun modulo. Lo sconto si imposta nel singolo preventivo.</p></div><button class="button primary" data-action="save-prices">Salva listino</button></div>
      <div class="notice">I prezzi non sono stati forniti: inseriscili qui o correggili direttamente nel preventivo. Il PDF cliente non viene generato se un articolo non ha un prezzo maggiore di zero.</div>
      <div class="table-wrap"><table><thead><tr><th>MODELLO</th><th>CONFIGURAZIONE</th><th class="right">PREZZO DI LISTINO (€)</th></tr></thead><tbody>${modules.map(model => `<tr><td><b>${esc(model.name.split('·')[0].trim())}</b></td><td>${esc(model.name.split('·').slice(1).join('·').trim() || model.name)}</td><td class="right"><input class="input right" style="max-width:160px" type="number" min="0" step="0.01" value="${esc(state.prices[model.id] ?? '')}" data-price-id="${esc(model.id)}" aria-label="Prezzo ${esc(model.name)}"></td></tr>`).join('')}</tbody></table></div>
    </section>`;
}

function renderCompany() {
  const company = state.company;
  app.innerHTML = `
    <section class="card storage-card">
      <div class="card-head"><div><h2>Archiviazione su disco</h2><p>Database e documenti vengono conservati localmente nei percorsi scelti.</p></div></div>
      ${desktopBridge ? '' : '<p class="notice">La scelta delle cartelle è disponibile nella finestra desktop. Nel browser i dati restano nel database del browser.</p>'}
      ${databaseError ? `<p class="notice">${esc(databaseError)}. Scegli una cartella database valida. Il file esistente non è stato modificato.</p>` : ''}
      <div class="path-grid">
        <div class="field"><label>DATABASE PREVENTIVI</label><div class="path-control"><input value="${esc(storagePaths.database_dir || 'Non selezionato')}" readonly aria-label="Cartella database"><button class="button" data-action="choose-database-folder" ${desktopBridge ? '' : 'disabled'}>Scegli cartella</button></div></div>
        <div class="field"><label>PDF CLIENTE</label><div class="path-control"><input value="${esc(storagePaths.customer_pdf_dir || 'Non selezionata')}" readonly aria-label="Cartella PDF cliente"><button class="button" data-action="choose-customer-folder" ${desktopBridge ? '' : 'disabled'}>Scegli cartella</button></div></div>
        <div class="field"><label>PDF FORNITORE</label><div class="path-control"><input value="${esc(storagePaths.supplier_pdf_dir || 'Non selezionata')}" readonly aria-label="Cartella PDF fornitore"><button class="button" data-action="choose-supplier-folder" ${desktopBridge ? '' : 'disabled'}>Scegli cartella</button></div></div>
      </div>
    </section>
    <section class="card">
      <div class="card-head"><div><h2>Intestazione e impostazioni PDF</h2><p>Questi dati definiscono l’intestazione aziendale nel riepilogo cliente.</p></div><button class="button primary" data-action="save-company">Salva impostazioni</button></div>
      <div class="form-grid">
        <div class="field"><label>RAGIONE SOCIALE / NOME AZIENDA</label><input data-company="name" value="${esc(company.name)}" placeholder="Nome della tua azienda"></div>
        <div class="field"><label>PARTITA IVA</label><input data-company="vatNumber" value="${esc(company.vatNumber)}"></div>
        <div class="field"><label>CODICE FISCALE</label><input data-company="taxCode" value="${esc(company.taxCode)}"></div>
        <div class="field"><label>INDIRIZZO</label><input data-company="address" value="${esc(company.address)}"></div>
        <div class="field"><label>CAP</label><input data-company="postalCode" value="${esc(company.postalCode)}"></div>
        <div class="field"><label>CITTÀ</label><input data-company="city" value="${esc(company.city)}"></div>
        <div class="field"><label>PROVINCIA</label><input data-company="province" value="${esc(company.province)}"></div>
        <div class="field"><label>TELEFONO</label><input data-company="phone" value="${esc(company.phone)}"></div>
        <div class="field"><label>EMAIL</label><input data-company="email" value="${esc(company.email)}"></div>
        <div class="field"><label>SITO WEB</label><input data-company="website" value="${esc(company.website)}"></div>
        <div class="field full"><label>NOTE A PIÈ DI PAGINA DEL PREVENTIVO</label><textarea data-company="footerNotes" placeholder="Condizioni, coordinate o note da riportare nel PDF">${esc(company.footerNotes)}</textarea></div>
        <div class="field full"><label>LOGO AZIENDALE (PNG O JPEG, MAX 3 MB)</label><input id="companyLogo" type="file" accept="image/png,image/jpeg"><div class="footer-note">Il logo viene conservato nel database locale.${company.logo ? '<br><button class="button small danger" data-action="remove-logo" style="margin-top:8px">Rimuovi logo</button>' : ''}</div>${company.logo ? `<img class="company-logo" src="${esc(company.logo)}" alt="Logo aziendale">` : ''}</div>
      </div>
    </section>
    <p class="footer-note">Il PDF cliente avrà l’intestazione aziendale sopra il riepilogo e, a seguire, le pagine generate dai moduli originali. Se un preventivo contiene più moduli, vengono inclusi tutti nello stesso PDF.</p>`;
}

function hasMeaningfulState(value = state) {
  return Boolean(value?.clients?.length || value?.quotes?.length || Object.keys(value?.prices || {}).length || value?.company?.name || value?.company?.logo);
}

async function chooseDatabaseFolder() {
  if (!desktopBridge) return;
  const selection = await desktopBridge.choose_database_folder();
  if (selection.cancelled) return;
  if (selection.status === 'invalid') throw new Error(`Il database nella cartella selezionata non è valido: ${selection.error}`);
  let mode = selection.status === 'existing' ? 'open' : 'empty';
  if (selection.status === 'empty' && hasMeaningfulState()) {
    mode = confirm('La cartella è vuota. Scegli OK per copiarvi i dati attualmente aperti; scegli Annulla per iniziare con un archivio vuoto.')
      ? 'copy-current'
      : 'empty';
  }
  if (storagePaths.database_dir && !databaseError) {
    if (!await persistNow()) throw new Error('Impossibile salvare i dati nella cartella database attuale. La cartella non è stata cambiata.');
  }
  const result = await desktopBridge.set_database_folder(selection.path, mode, mode === 'copy-current' ? structuredClone(state) : null);
  state = result.state;
  storagePaths = result.paths;
  databaseError = '';
  currentQuoteId = null;
  currentPage = 'company';
  render();
  showToast(mode === 'copy-current' ? 'Database copiato nella nuova cartella.' : 'Cartella database selezionata.');
}

async function chooseOutputFolder(kind) {
  if (!desktopBridge) return;
  const result = await desktopBridge.choose_output_folder(kind);
  if (result.cancelled) return;
  storagePaths = result.paths;
  if (currentPage === 'company') renderCompany();
  showToast(`Cartella PDF ${kind === 'customer' ? 'cliente' : 'fornitore'} salvata.`);
}

function renderQuote() {
  const quote = getQuote();
  if (!quote) {
    currentPage = 'quotes';
    render();
    return;
  }
  const client = activeClient(quote);
  const totals = quoteTotals(quote);
  const selectedClient = quote.clientId || '';
  app.innerHTML = `
    <div class="quote-layout">
      <div class="stack">
        <section class="card">
          <div class="card-head"><div><h2>Cliente</h2><p>Anagrafica salvata insieme al preventivo.</p></div><button class="button small" data-action="new-client">＋ Nuovo cliente</button></div>
          <div class="form-grid">
            <div class="field"><label>CLIENTE</label><select data-qfield="clientId"><option value="">Seleziona un cliente</option>${state.clients.map(item => `<option value="${esc(item.id)}" ${item.id === selectedClient ? 'selected' : ''}>${esc(clientLabel(item))}</option>`).join('')}</select></div>
            <div class="field"><label>VALIDITÀ (GIORNI)</label><input type="number" min="1" max="365" data-qfield="validityDays" value="${esc(quote.validityDays ?? 30)}"></div>
            <div class="field"><label>ALIQUOTA IVA (%)</label><input type="number" min="0" max="100" step="0.1" data-qfield="vatRate" value="${esc(quote.vatRate ?? 22)}"></div>
          </div>
          ${client ? `<div class="client-detail" style="margin-top:12px"><b>${esc(clientLabel(client))}</b>${client.company ? ` · ${esc(client.company)}` : ''}<br>${esc([client.address, client.postalCode, client.city, client.province].filter(Boolean).join(', '))}<br>${esc(client.vatNumber || client.taxCode || '')} ${client.email ? ` · ${esc(client.email)}` : ''} ${client.phone ? ` · ${esc(client.phone)}` : ''}</div>` : ''}
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Articoli del preventivo</h2><p>Ogni riga usa un modulo originale compilabile.</p></div><button class="button small" data-action="add-module">＋ Aggiungi modulo</button></div>
          ${quote.items.length ? `<div class="table-wrap"><table class="quote-items"><thead><tr><th>MODULO / CONFIGURAZIONE</th><th>Q.TÀ</th><th>LISTINO (€)</th><th>SCONTO (%)</th><th>NETTO</th><th></th></tr></thead><tbody>${quote.items.map((item, index) => {
            const model = modules.find(entry => entry.id === item.moduleId);
            const line = totals.lines[index];
            return `<tr><td><div class="article-name">${esc(model?.name || item.moduleId)}</div><div class="article-sub">${Object.keys(item.data || {}).length ? 'Modulo compilato' : 'Da compilare'} · <button class="module-link" data-action="edit-module" data-id="${esc(item.id)}">Apri modulo originale ↗</button></div></td><td><input class="input" style="width:68px" type="number" min="1" step="1" value="${esc(item.quantity ?? 1)}" data-item-id="${esc(item.id)}" data-item-field="quantity" aria-label="Quantità"></td><td><input class="input right" style="width:118px" type="number" min="0" step="0.01" value="${esc(item.price ?? '')}" data-item-id="${esc(item.id)}" data-item-field="price" aria-label="Prezzo di listino"></td><td><input class="input right" style="width:84px" type="number" min="0" max="100" step="0.1" value="${esc(item.discount ?? 0)}" data-item-id="${esc(item.id)}" data-item-field="discount" aria-label="Sconto percentuale"></td><td><b>${money(line.netTotal)}</b></td><td><button class="button small danger" data-action="remove-item" data-id="${esc(item.id)}" aria-label="Rimuovi modulo">×</button></td></tr>`;
          }).join('')}</tbody></table></div>` : '<div class="empty"><strong>Nessun modulo aggiunto</strong>Seleziona un modulo per inserirlo nel preventivo.</div>'}
          <div class="quote-total">
            <div class="total-line"><span>Totale listino</span><span>${money(totals.listTotal)}</span></div>
            <div class="total-line"><span>Sconti applicati</span><span>− ${money(totals.discountTotal)}</span></div>
            <div class="total-line final"><span>Totale scontato (IVA esclusa)</span><span>${money(totals.netTotal)}</span></div>
            <div class="total-line"><span>IVA ${totals.vatRate}%</span><span>${money(totals.vatTotal)}</span></div>
            <div class="total-line"><b>Totale con IVA</b><b>${money(totals.grossTotal)}</b></div>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><div><h2>Note e stato</h2><p>Queste informazioni vengono registrate nello storico del preventivo.</p></div></div>
          <div class="form-grid">
            <div class="field"><label>STATO</label><select data-qfield="status">${['bozza', 'inviato', 'accettato', 'archiviato'].map(status => `<option value="${status}" ${quote.status === status ? 'selected' : ''}>${status[0].toUpperCase()}${status.slice(1)}</option>`).join('')}</select></div>
            <div class="field full"><label>NOTE CLIENTE / NOTE A PIÈ DI PAGINA</label><textarea data-qfield="notes" placeholder="Note specifiche da includere nel PDF">${esc(quote.notes || '')}</textarea></div>
          </div>
        </section>
      </div>
      <aside class="card quote-side">
        <div class="card-head"><div><h2>${esc(quote.number)}</h2><p>Creato il ${dateLabel(quote.createdAt)}</p></div><span class="status ${quoteStatusClass(quote.status)}">${esc(quote.status || 'bozza')}</span></div>
        ${quoteSendStatusMarkup(quote)}
        <button class="button" data-action="duplicate-quote">Duplica preventivo</button>
        <button class="button primary" data-action="generate-pdf" data-kind="customer">Genera PDF cliente completo</button>
        <button class="button" data-action="generate-pdf" data-kind="supplier">Genera PDF fornitore · soli moduli</button>
        ${desktopBridge ? `<button class="button" data-action="share-pdf-whatsapp" data-kind="customer" ${storagePaths.customer_pdf_dir ? '' : 'disabled'}>Invia PDF cliente con WhatsApp</button>
        <button class="button" data-action="share-pdf-whatsapp" data-kind="supplier" ${storagePaths.supplier_pdf_dir ? '' : 'disabled'}>Invia PDF fornitore con WhatsApp</button>
        <div class="footer-note">WhatsApp Desktop apre la chat senza testo. Allega il PDF corretto e conferma l’invio nella chat; poi registra l’esito qui sotto.</div>` : ''}
        <button class="button" data-action="mark-quote-sent" data-kind="customer">Conferma invio PDF cliente</button>
        <button class="button" data-action="mark-quote-sent" data-kind="supplier">Conferma invio PDF fornitore</button>
        <button class="button" data-action="save-quote">Salva preventivo</button>
        <button class="button" data-action="back-quotes">Torna all’archivio</button>
        <div class="footer-note">Il PDF cliente include riepilogo e moduli. Quello fornitore contiene solo i moduli, con nome cliente e riferimento al preventivo.</div>
        ${!state.company.name ? '<p class="notice" style="margin-top:12px">Imposta i dati aziendali prima di generare il PDF cliente.</p>' : ''}
      </aside>
    </div>`;
}

function openFormDialog(title, body, onSubmit) {
  formDialog.innerHTML = `<form class="dialog-form" id="dynamicForm"><div><span class="eyebrow">GESTIONALE</span><h2>${esc(title)}</h2></div>${body}<div class="dialog-form-actions"><button type="button" class="button" data-dialog-close>Annulla</button><button class="button primary" type="submit">Salva</button></div></form>`;
  formDialog.showModal();
  formDialog.querySelector('[data-dialog-close]').addEventListener('click', () => formDialog.close());
  formDialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    await onSubmit(values);
    formDialog.close();
  });
}

function clientFields(client = {}) {
  const fields = [
    ['name', 'NOME E COGNOME (OPPURE COMPILA RAGIONE SOCIALE)', 'Giulia Bianchi'],
    ['company', 'RAGIONE SOCIALE', ''],
    ['vatNumber', 'PARTITA IVA', ''],
    ['taxCode', 'CODICE FISCALE', ''],
    ['address', 'INDIRIZZO', ''],
    ['postalCode', 'CAP', ''],
    ['city', 'CITTÀ', ''],
    ['province', 'PROVINCIA', ''],
    ['email', 'EMAIL', '']
  ];
  return `<div class="form-grid">${fields.map(([key, label, placeholder]) => `<div class="field"><label>${label}</label><input name="${key}" value="${esc(client[key] || '')}" placeholder="${esc(placeholder)}"></div>`).join('')}
    <div class="field"><label for="clientPhone">CELLULARE (FACOLTATIVO)</label><input id="clientPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" aria-describedby="phoneValidation" value="${esc(client.phone || '')}" placeholder="333 123 4567 o +33…"><p id="phoneValidation" class="validation-error" hidden></p></div></div>`;
}

function openClientDialog(existing = null) {
  openFormDialog(existing ? 'Modifica cliente' : 'Nuovo cliente', clientFields(existing || {}), async values => {
    const phone = normalizePhoneNumber(values.phone);
    if (!phone.valid) {
      updatePhoneValidation(formDialog.querySelector('[name="phone"]'));
      showToast('Inserisci un numero di cellulare valido oppure lascia il campo vuoto.', true);
      return;
    }
    values.phone = phone.value;
    const client = { ...(existing || {}), ...values, id: existing?.id || makeId(), updatedAt: new Date().toISOString() };
    if (!client.name.trim() && !client.company.trim()) {
      showToast('Inserisci il nome del cliente o la ragione sociale.', true);
      return;
    }
    if (existing) state.clients = state.clients.map(item => item.id === existing.id ? client : item);
    else state.clients.push(client);
    await persistNow();
    render();
    showToast(existing ? 'Anagrafica cliente aggiornata.' : 'Cliente registrato.');
  });
  const phoneInput = formDialog.querySelector('[name="phone"]');
  phoneInput.addEventListener('input', () => updatePhoneValidation(phoneInput));
  phoneInput.addEventListener('blur', () => {
    const result = updatePhoneValidation(phoneInput);
    if (result.valid && !result.empty) phoneInput.value = result.value;
  });
}

function openAddModuleDialog() {
  const quote = getQuote();
  if (!quote) return;
  const options = modules.map(model => `<option value="${esc(model.id)}">${esc(model.name)}</option>`).join('');
  openFormDialog('Aggiungi modulo al preventivo', `<div class="field"><label>MODELLO ORIGINALE</label><select name="moduleId" required>${options}</select></div>`, async values => {
    const model = modules.find(entry => entry.id === values.moduleId);
    if (!model) throw new Error('Modulo non trovato nel catalogo.');
    quote.items.push({
      id: makeId(),
      moduleId: model.id,
      data: {},
      price: Number(state.prices[model.id]) || 0,
      discount: 0,
      quantity: 1
    });
    quote.updatedAt = new Date().toISOString();
    await persistNow();
    renderQuote();
    formDialog.close();
    await openModuleEditor(quote.items.at(-1).id);
  });
}

function newQuote() {
  const now = new Date();
  const year = now.getFullYear();
  const prefix = `PREV-${year}-`;
  const sequence = state.quotes.reduce((max, quote) => {
    if (!quote.number?.startsWith(prefix)) return max;
    const suffix = Number(quote.number.slice(prefix.length));
    return Number.isInteger(suffix) ? Math.max(max, suffix) : max;
  }, 0) + 1;
  const today = localDateString(now);
  const quote = {
    id: makeId(),
    number: `PREV-${year}-${String(sequence).padStart(4, '0')}`,
    createdAt: today,
    updatedAt: today,
    clientId: '',
    clientSnapshot: null,
    validityDays: 30,
    vatRate: 22,
    status: 'bozza',
    notes: '',
    items: []
  };
  state.quotes.unshift(quote);
  currentQuoteId = quote.id;
  currentPage = 'quote';
  persistNow();
  render();
}

function duplicateQuote(sourceQuote) {
  const sourceNumber = String(sourceQuote.number || 'PREVENTIVO').replace(/-COPIA-\d+$/i, '');
  const existingNumbers = new Set(state.quotes.map(quote => String(quote.number || '')));
  let sequence = 1;
  let number;
  do {
    number = `${sourceNumber}-COPIA-${String(sequence).padStart(3, '0')}`;
    sequence++;
  } while (existingNumbers.has(number));
  const today = localDateString(new Date());
  return {
    ...structuredClone(sourceQuote),
    id: makeId(),
    number,
    createdAt: today,
    updatedAt: today,
    status: 'bozza',
    sentCustomerAt: null,
    sentSupplierAt: null
  };
}

async function duplicateCurrentQuote() {
  const sourceQuote = getQuote();
  if (!sourceQuote) return;
  const sourceId = currentQuoteId;
  const copy = duplicateQuote(sourceQuote);
  state.quotes.unshift(copy);
  currentQuoteId = copy.id;
  currentPage = 'quote';
  if (!await persistNow()) {
    state.quotes = state.quotes.filter(quote => quote.id !== copy.id);
    currentQuoteId = sourceId;
    renderQuote();
    return;
  }
  renderQuote();
  showToast(`Creato ${copy.number}. L’originale non è stato modificato.`);
}

async function loadModuleFrame(model) {
  const url = new URL(model.path, location.href).href;
  if (frame.dataset.loadedUrl === url && frame.contentDocument?.readyState === 'complete') return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Il modulo ${model.name} non si è caricato.`)), 20000);
    frame.onload = () => {
      clearTimeout(timeout);
      frame.onload = null;
      resolve();
    };
    frame.onerror = () => {
      clearTimeout(timeout);
      frame.onerror = null;
      reject(new Error(`Impossibile aprire il modulo ${model.name}.`));
    };
    frame.dataset.loadedUrl = url;
    frame.src = url;
  });
  const documentFrame = frame.contentDocument;
  if (!documentFrame) throw new Error('Il modulo non è accessibile: avvia il gestionale con Avvia_gestionale.command.');
  if (!documentFrame.documentElement.dataset.quoteManagerWatch) {
    const capture = event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.matches('input:not([type="file"]),textarea,button[aria-pressed]')) return;
      clearTimeout(modulePullTimer);
      modulePullTimer = setTimeout(() => pullActiveModule().catch(error => showToast(error.message, true)), 180);
    };
    documentFrame.addEventListener('input', capture, true);
    documentFrame.addEventListener('change', capture, true);
    documentFrame.addEventListener('click', capture, true);
    documentFrame.documentElement.dataset.quoteManagerWatch = 'true';
  }
}

function requestModule(type, payload = {}) {
  const requestId = makeId();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Il modulo non ha risposto. Riaprilo e riprova.'));
    }, 30000);
    pendingRequests.set(requestId, { resolve, reject, timeout });
    frame.contentWindow.postMessage({ channel: CHANNEL, type, requestId, ...payload }, location.origin);
  });
}

window.addEventListener('message', event => {
  if (event.source !== frame.contentWindow || event.origin !== location.origin) return;
  const message = event.data;
  if (!message || message.channel !== CHANNEL || !message.requestId) return;
  const pending = pendingRequests.get(message.requestId);
  if (!pending) return;
  clearTimeout(pending.timeout);
  pendingRequests.delete(message.requestId);
  if (message.type === 'module-error') pending.reject(new Error(message.error || 'Errore nel modulo.'));
  else pending.resolve(message);
});

async function openModuleEditor(itemId) {
  const quote = getQuote();
  const item = quote?.items.find(entry => entry.id === itemId);
  const model = modules.find(entry => entry.id === item?.moduleId);
  if (!item || !model) {
    showToast('Il modulo selezionato non è disponibile.', true);
    return;
  }
  activeModuleItemId = item.id;
  document.querySelector('#moduleDialogTitle').textContent = model.name;
  moduleDialog.showModal();
  try {
    await loadModuleFrame(model);
    await requestModule('set-data', { data: item.data || {} });
  } catch (error) {
    showToast(error.message, true);
    moduleDialog.close();
    activeModuleItemId = null;
  }
}

async function pullActiveModule() {
  const quote = getQuote();
  const item = quote?.items.find(entry => entry.id === activeModuleItemId);
  if (!item || !frame.contentWindow) return;
  const response = await requestModule('get-data');
  item.data = response.data || {};
  quote.updatedAt = new Date().toISOString();
  persistSoon();
}

async function closeModuleEditor() {
  try {
    await pullActiveModule();
    moduleDialog.close();
    activeModuleItemId = null;
    renderQuote();
  } catch (error) {
    showToast(error.message, true);
  }
}

function updateQuoteField(target) {
  const quote = getQuote();
  if (!quote) return;
  const field = target.dataset.qfield;
  if (!field) return;
  quote[field] = field === 'validityDays' || field === 'vatRate' ? Number(target.value) : target.value;
  if (field === 'clientId') quote.clientSnapshot = snapshotClient(getClient(quote.clientId));
  quote.updatedAt = new Date().toISOString();
  persistSoon();
}

function updateItemField(target) {
  const quote = getQuote();
  const item = quote?.items.find(entry => entry.id === target.dataset.itemId);
  if (!item) return;
  const field = target.dataset.itemField;
  const value = Number(target.value);
  if (field === 'discount') item.discount = Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  else if (field === 'quantity') item.quantity = Math.max(1, Math.floor(Number.isFinite(value) ? value : 1));
  else if (field === 'price') item.price = Math.max(0, Number.isFinite(value) ? value : 0);
  quote.updatedAt = new Date().toISOString();
  persistSoon();
}

function updateCompanyField(target) {
  const field = target.dataset.company;
  if (!field) return;
  state.company[field] = target.value;
  persistSoon();
}

async function handleLogoUpload(file) {
  if (!file) return;
  if (!['image/png', 'image/jpeg'].includes(file.type)) {
    showToast('Il logo deve essere un file PNG o JPEG.', true);
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    showToast('Il logo supera il limite di 3 MB.', true);
    return;
  }
  state.company.logo = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Non riesco a leggere il file del logo.'));
    reader.readAsDataURL(file);
  });
  if (!await persistNow()) return;
  renderCompany();
  showToast('Logo salvato nelle impostazioni locali.');
}

async function shareQuotePdfViaWhatsApp(kind) {
  if (!desktopBridge?.open_whatsapp) {
    showToast('La condivisione WhatsApp è disponibile nella finestra desktop.', true);
    return;
  }
  if (!['customer', 'supplier'].includes(kind)) return;
  const quote = getQuote();
  if (!quote) return;
  const client = activeClient(quote);
  try {
    const suggestedPhone = kind === 'customer' ? (client?.phone || '') : '';
    const recipient = window.prompt(
      kind === 'customer' ? 'Numero WhatsApp del cliente. Verifica o modifica il destinatario:' : 'Numero WhatsApp del fornitore:',
      suggestedPhone
    );
    if (recipient === null) return;
    const normalizedPhone = normalizePhoneNumber(recipient);
    if (normalizedPhone.empty || !normalizedPhone.valid) {
      showToast('Inserisci un numero WhatsApp valido per aprire la conversazione.', true);
      return;
    }
    const generated = await generateQuotePdf(kind);
    if (!generated?.path) return;
    const filename = generated.path.split(/[\\/]/).pop();
    await desktopBridge.open_whatsapp(normalizedPhone.value);
    showToast(`PDF ${kind === 'customer' ? 'cliente' : 'fornitore'} salvato: ${filename}. Allegalo manualmente nella chat e torna qui per confermare l’invio.`);
  } catch (error) {
    showToast(`WhatsApp non aperto: ${error.message}`, true);
  }
}

async function markQuoteSent(kind) {
  const fields = { customer: ['sentCustomerAt', 'PDF cliente'], supplier: ['sentSupplierAt', 'PDF fornitore'] };
  const entry = fields[kind];
  const quote = getQuote();
  if (!entry || !quote) return;
  if (!window.confirm(`Confermi di avere effettivamente inviato il ${entry[1]}?`)) return;
  const [field, label] = entry;
  const previousValue = quote[field] || null;
  quote[field] = new Date().toISOString();
  if (!await persistNow()) {
    quote[field] = previousValue;
    return;
  }
  render();
  showToast(`${label} registrato come inviato.`);
}

async function generateQuotePdf(kind = 'customer') {
  const quote = getQuote();
  if (!quote) return;
  const client = activeClient(quote);
  if (!client || !(client.name || client.company)) {
    showToast('Seleziona un cliente con nome o ragione sociale.', true);
    return;
  }
  if (kind === 'customer' && !state.company.name.trim()) {
    showToast('Inserisci il nome aziendale nelle impostazioni PDF.', true);
    return;
  }
  if (!quote.items.length) {
    showToast('Aggiungi almeno un modulo al preventivo.', true);
    return;
  }
  const outputFolder = kind === 'customer' ? storagePaths.customer_pdf_dir : storagePaths.supplier_pdf_dir;
  if (desktopBridge && !outputFolder) {
    showToast(`Scegli prima la cartella PDF ${kind === 'customer' ? 'cliente' : 'fornitore'} nelle impostazioni.`, true);
    return;
  }
  if (kind === 'customer' && quote.items.some(item => !(Number(item.price) > 0))) {
    showToast('Imposta un prezzo di listino maggiore di zero per ogni articolo.', true);
    return;
  }
  if (pdfGenerationActive) {
    showToast('La generazione di un PDF è già in corso. Attendi il completamento.', true);
    return;
  }
  pdfGenerationActive = true;
  logDesktopEvent('pdf_generation_started');
  document.querySelectorAll('[data-action="generate-pdf"]').forEach(button => { button.disabled = true; });
  document.querySelectorAll('[data-action="share-pdf-whatsapp"]').forEach(button => { button.disabled = true; });
  const resumeModuleItemId = moduleDialog.open ? activeModuleItemId : null;
  let savedPdfPath = '';
  try {
    if (resumeModuleItemId) {
      await pullActiveModule();
    }
    showPdfProgress(`Preparo il PDF ${kind === 'customer' ? 'cliente' : 'fornitore'}…`);
    const modulePdfs = [];
    try {
      for (let index = 0; index < quote.items.length; index++) {
        const item = quote.items[index];
        logDesktopEvent('pdf_module_started');
        const model = modules.find(entry => entry.id === item.moduleId);
        if (!model) throw new Error(`Modulo non trovato: ${item.moduleId}.`);
        const originalData = structuredClone(item.data || {});
        const moduleData = quoteModuleData(kind, originalData, client, quote);
        await loadModuleFrame(model);
        await requestModule('set-data', { data: moduleData });
        try {
          showPdfProgress(`Creo il PDF del modulo ${index + 1} di ${quote.items.length}: ${model.name}…`);
          const response = await requestModule('get-pdf');
          modulePdfs.push(response.bytes);
        } finally {
          await requestModule('set-data', { data: originalData });
        }
      }
      const payload = {
        quote: {
          number: quote.number,
          createdAt: quote.createdAt,
          validityDays: quote.validityDays,
          vatRate: quote.vatRate,
          notes: quote.notes,
          items: quote.items.map(({ moduleId, price, discount, quantity }) => ({ moduleId, price, discount, quantity }))
        },
        client,
        company: structuredClone(state.company),
        models: modules
      };
      let bytes;
      if (kind === 'customer') {
        logDesktopEvent('pdf_customer_assembly');
        showPdfProgress('Compongo il riepilogo commerciale e unisco i moduli…');
        const response = await requestModule('build-quote-pdf', { payload, modulePdfs });
        bytes = response.bytes;
      } else {
        logDesktopEvent('pdf_supplier_merge');
        showPdfProgress('Unisco le pagine dei moduli…');
        const supplierBuilder = frame.contentWindow?.buildSupplierPdfDocument;
        if (typeof supplierBuilder !== 'function') throw new Error('Generatore PDF fornitore non disponibile.');
        bytes = await supplierBuilder(modulePdfs, quote.number, client.name || client.company || '');
      }
      generatedPdfBytes = bytes;
      generatedPdfKind = kind;
      const blob = new Blob([bytes], { type: 'application/pdf' });
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      pdfUrl = URL.createObjectURL(blob);
      document.querySelector('#pdfPreview').src = pdfUrl;
      document.querySelector('#pdfDialogTitle').textContent = kind === 'customer' ? 'Anteprima preventivo cliente' : 'Anteprima moduli fornitore';
      document.querySelector('#pdfDialogEyebrow').textContent = kind === 'customer' ? 'DOCUMENTO CLIENTE' : 'DOCUMENTO FORNITORE';
      pdfDialog.showModal();
      if (desktopBridge) {
        logDesktopEvent('pdf_disk_save_started');
        showPdfProgress('Salvo il PDF nella cartella configurata…');
        const base64 = bytesToBase64(bytes);
        const prefix = kind === 'customer' ? 'cliente' : 'fornitore';
        const saved = await desktopBridge.write_pdf(kind, `preventivo_${quote.number}_${prefix}.pdf`, base64);
        savedPdfPath = saved.path;
        showToast(`PDF ${prefix} salvato: ${saved.path}`);
      } else {
        showToast(`Anteprima PDF ${kind === 'customer' ? 'cliente' : 'fornitore'} pronta.`);
      }
    } finally {
      if (resumeModuleItemId) {
        const activeItem = quote.items.find(item => item.id === resumeModuleItemId);
        const activeModel = modules.find(entry => entry.id === activeItem?.moduleId);
        if (activeItem && activeModel) {
          await loadModuleFrame(activeModel);
          await requestModule('set-data', { data: activeItem.data || {} });
        }
      }
    }
  } catch (error) {
    logDesktopEvent('pdf_generation_failed');
    showToast(`PDF non generato: ${error.message}`, true);
  } finally {
    pdfGenerationActive = false;
    document.querySelectorAll('[data-action="generate-pdf"]').forEach(button => { button.disabled = false; });
    document.querySelectorAll('[data-action="share-pdf-whatsapp"]').forEach(button => {
      button.disabled = button.dataset.kind === 'customer' ? !storagePaths.customer_pdf_dir : !storagePaths.supplier_pdf_dir;
    });
  }
  return savedPdfPath ? { path: savedPdfPath, kind } : null;
}

function bytesToBase64(bytes) {
  const values = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < values.length; index += chunkSize) {
    binary += String.fromCharCode(...values.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportBackup() {
  if (desktopBridge && (!storagePaths.database_dir || databaseError)) {
    showToast(databaseError || 'Scegli prima la cartella del database locale.', true);
    return;
  }
  const payload = {
    formato: 'AREA_TENDA_GESTIONALE_BACKUP',
    versione: 1,
    esportatoIl: new Date().toISOString(),
    dati: state
  };
  if (desktopBridge) {
    const result = await desktopBridge.export_backup(JSON.stringify(payload));
    if (result.cancelled) return;
    showToast(`Backup esportato: ${result.path}`);
    return;
  }
  downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `backup_preventivi_${new Date().toISOString().slice(0, 10)}.json`);
  showToast('Backup JSON esportato.');
}

async function restoreBackupPayload(payload) {
  if (payload?.formato !== 'AREA_TENDA_GESTIONALE_BACKUP' || payload.versione !== 1 ||
      !Array.isArray(payload.dati?.clients) || !Array.isArray(payload.dati?.quotes) ||
      !payload.dati?.prices || !payload.dati?.company) {
    throw new Error('Il file selezionato non è un backup valido del gestionale.');
  }
  if (desktopBridge && (!storagePaths.database_dir || databaseError)) {
    throw new Error(databaseError || 'Scegli prima la cartella del database locale.');
  }
  if (!confirm('Il ripristino sostituisce clienti, preventivi e impostazioni salvati in questo database. Continuare?')) return;
  state = payload.dati;
  await persistNow();
  render();
  showToast('Backup ripristinato.');
}

async function importBackup(file) {
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) throw new Error('Il file di backup supera il limite di 50 MB.');
  await restoreBackupPayload(JSON.parse(await file.text()));
}

async function importBackupFromDesktop() {
  if (!storagePaths.database_dir || databaseError) {
    throw new Error(databaseError || 'Scegli prima la cartella del database locale.');
  }
  const result = await desktopBridge.import_backup();
  if (!result.cancelled) await restoreBackupPayload(result.payload);
}

function removeQuote(id) {
  const quote = state.quotes.find(item => item.id === id);
  if (!quote || !confirm(`Eliminare il preventivo ${quote.number}?`)) return;
  state.quotes = state.quotes.filter(item => item.id !== id);
  persistNow();
  render();
  showToast('Preventivo eliminato.');
}

function handleClick(event) {
  const pageButton = event.target.closest('[data-page]');
  if (pageButton) {
    event.preventDefault();
    setPage(pageButton.dataset.page);
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, id } = button.dataset;
  if (action === 'new-quote') newQuote();
  else if (action === 'choose-database-folder') chooseDatabaseFolder().catch(error => showToast(error.message, true));
  else if (action === 'choose-customer-folder') chooseOutputFolder('customer').catch(error => showToast(error.message, true));
  else if (action === 'choose-supplier-folder') chooseOutputFolder('supplier').catch(error => showToast(error.message, true));
  else if (action === 'open-quote') {
    currentQuoteId = id;
    setPage('quote');
  } else if (action === 'delete-quote') removeQuote(id);
  else if (action === 'duplicate-quote') duplicateCurrentQuote();
  else if (action === 'back-quotes') setPage('quotes');
  else if (action === 'new-client') openClientDialog();
  else if (action === 'edit-client') openClientDialog(getClient(id));
  else if (action === 'delete-client') {
    const client = getClient(id);
    if (!client || !confirm(`Eliminare l’anagrafica ${clientLabel(client)}? I preventivi già salvati mantengono la copia dei dati cliente.`)) return;
    state.clients = state.clients.filter(item => item.id !== id);
    persistNow();
    render();
    showToast('Cliente eliminato.');
  } else if (action === 'add-module') openAddModuleDialog();
  else if (action === 'edit-module') openModuleEditor(id);
  else if (action === 'remove-item') {
    const quote = getQuote();
    if (quote) {
      quote.items = quote.items.filter(item => item.id !== id);
      quote.updatedAt = new Date().toISOString();
      persistNow();
      renderQuote();
    }
  } else if (action === 'generate-pdf') generateQuotePdf(button.dataset.kind || 'customer');
  else if (action === 'share-pdf-whatsapp') shareQuotePdfViaWhatsApp(button.dataset.kind || 'customer');
  else if (action === 'mark-quote-sent') markQuoteSent(button.dataset.kind || 'customer');
  else if (action === 'save-quote') {
    const quote = getQuote();
    if (quote) {
      quote.updatedAt = new Date().toISOString();
      void persistNow().then(saved => { if (saved) showToast('Preventivo salvato.'); });
    }
  } else if (action === 'save-prices') {
    void persistNow().then(saved => { if (saved) showToast('Listino salvato.'); });
  } else if (action === 'save-company') {
    void persistNow().then(saved => { if (saved) showToast('Impostazioni aziendali salvate.'); });
  } else if (action === 'remove-logo') {
    state.company.logo = '';
    void persistNow().then(saved => {
      if (saved) {
        renderCompany();
        showToast('Logo rimosso.');
      }
    });
  }
}

document.addEventListener('click', handleClick);
app.addEventListener('input', event => {
  const target = event.target;
  if (target.matches('#quoteSearch')) {
    document.querySelector('#quotesTable').innerHTML = renderQuoteSearchResults(target.value);
  } else if (target.matches('[data-qfield]')) updateQuoteField(target);
  else if (target.matches('[data-item-id][data-item-field]')) updateItemField(target);
  else if (target.matches('[data-company]')) updateCompanyField(target);
  else if (target.matches('[data-price-id]')) {
    const value = Number(target.value);
    state.prices[target.dataset.priceId] = target.value === '' ? '' : Math.max(0, Number.isFinite(value) ? value : 0);
    persistSoon();
  }
});
app.addEventListener('change', event => {
  const target = event.target;
  if (target.matches('[data-qfield="clientId"]')) {
    updateQuoteField(target);
    renderQuote();
  } else if (target.matches('[data-qfield]')) {
    updateQuoteField(target);
  } else if (target.matches('[data-item-id][data-item-field]')) {
    updateItemField(target);
    renderQuote();
  } else if (target.matches('[data-price-id]')) {
    const value = Number(target.value);
    state.prices[target.dataset.priceId] = target.value === '' ? '' : Math.max(0, Number.isFinite(value) ? value : 0);
    persistSoon();
    renderPrices();
  } else if (target.matches('#companyLogo')) {
    handleLogoUpload(target.files[0]).catch(error => showToast(error.message, true));
  }
});

document.querySelector('#newQuoteTop').addEventListener('click', newQuote);
const closeAppButton = document.querySelector('#closeAppButton');
closeAppButton.hidden = !DESKTOP_MODE;
closeAppButton.addEventListener('click', async () => {
  if (!desktopBridge?.request_close) {
    showToast('Il collegamento per la chiusura sicura non è pronto. Usa la X della finestra.', true);
    return;
  }
  try {
    await desktopBridge.request_close();
  } catch (error) {
    showToast(`Chiusura non riuscita: ${error.message}`, true);
  }
});
document.querySelector('#moduleSave').addEventListener('click', closeModuleEditor);
document.querySelector('#moduleClose').addEventListener('click', closeModuleEditor);
moduleDialog.addEventListener('cancel', event => {
  event.preventDefault();
  closeModuleEditor();
});
document.querySelector('#backupExport').addEventListener('click', () => exportBackup().catch(error => showToast(`Backup non esportato: ${error.message}`, true)));
document.querySelector('#backupImport').addEventListener('click', () => {
  if (desktopBridge) importBackupFromDesktop().catch(error => showToast(`Backup non importato: ${error.message}`, true));
  else document.querySelector('#backupFile').click();
});
document.querySelector('#backupFile').addEventListener('change', event => {
  importBackup(event.target.files[0]).catch(error => showToast(`Backup non importato: ${error.message}`, true)).finally(() => { event.target.value = ''; });
});
document.querySelector('#pdfClose').addEventListener('click', () => pdfDialog.close());
document.querySelector('#pdfDownload').addEventListener('click', async () => {
  if (!pdfUrl || !generatedPdfBytes) return;
  const quote = getQuote();
  const number = (quote?.number || 'cliente').replace(/[^a-zA-Z0-9_-]/g, '_');
  const prefix = generatedPdfKind === 'customer' ? 'cliente' : 'fornitore';
  const filename = `preventivo_${number}_${prefix}.pdf`;
  if (desktopBridge?.save_pdf_copy) {
    try {
      const result = await desktopBridge.save_pdf_copy(
        generatedPdfKind,
        filename,
        bytesToBase64(generatedPdfBytes)
      );
      if (!result.cancelled) showToast(`Copia PDF salvata: ${result.path}`);
    } catch (error) {
      showToast(`Copia PDF non salvata: ${error.message}`, true);
    }
    return;
  }
  const link = document.createElement('a');
  link.href = pdfUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
});
pdfDialog.addEventListener('close', () => {
  document.querySelector('#pdfPreview').removeAttribute('src');
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = '';
  generatedPdfBytes = null;
  document.querySelector('#pdfDialogTitle').textContent = 'Anteprima preventivo';
  document.querySelector('#pdfDialogEyebrow').textContent = 'DOCUMENTO CLIENTE';
});

async function init() {
  try {
    if (location.protocol === 'file:') throw new Error('Apri il gestionale con Avvia_gestionale.command: i moduli originali richiedono un’origine locale condivisa.');
    desktopBridge = await waitForDesktopBridge();
    if (DESKTOP_MODE && !desktopBridge) throw new Error('Il collegamento al database locale non è pronto. Chiudi e riapri il gestionale; i dati non sono stati salvati nel browser.');
    if (desktopBridge) {
      const [initial, catalog] = await Promise.all([desktopBridge.load_initial_data(), loadCatalog()]);
      state = initial.state;
      logDesktopEvent('bridge_ready');
      storagePaths = initial.paths || storagePaths;
      databaseError = initial.database_error || '';
      modules = catalog;
    } else {
      if (!('indexedDB' in window)) throw new Error('Questo browser non supporta il database locale richiesto.');
      [db, modules] = await Promise.all([openDatabase(), loadCatalog()]);
      state = await readState() || emptyState();
    }
    state.clients ||= [];
    state.quotes ||= [];
    state.prices ||= {};
    state.company = { ...emptyState().company, ...(state.company || {}) };
    if (desktopBridge && (!storagePaths.database_dir || databaseError)) currentPage = 'company';
    render();
    if (desktopBridge && !storagePaths.database_dir) {
      setTimeout(() => chooseDatabaseFolder().catch(error => showToast(error.message, true)), 200);
    } else if (databaseError) {
      showToast(databaseError, true);
    }
  } catch (error) {
    document.querySelector('#pageTitle').textContent = 'Avvio non riuscito';
    app.innerHTML = `<section class="card"><h2>Il gestionale non è pronto</h2><p class="client-detail">${esc(error.message)}</p><p class="footer-note">Avvia il server locale usando Avvia_gestionale.command. Nessun dato è stato inviato online.</p></section>`;
  }
}

init();
