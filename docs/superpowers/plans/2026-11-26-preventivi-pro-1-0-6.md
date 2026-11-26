# Preventivi Pro 1.0.6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Python/pywebview desktop quote manager from v1.0.5 with safer WhatsApp handoff, independent send records, phone validation, quote duplication and CorradoWEB 2026 identity while preserving quote data and PDFs.

**Architecture:** Keep the current HTML/JavaScript interface, Python desktop bridge, JSON archive and Inno Setup packaging. Add small pure front-end helpers for phone normalization and quote operations; use a narrowly validated Windows protocol launch in Python; persist explicit send confirmations on the quote. Add a pre-migration backup before normalizing existing JSON records. Do not implement global clipboard/UI automation.

**Tech Stack:** Python 3.12, pywebview, HTML/CSS/JavaScript, Node test runner, Python unittest, PyInstaller, Inno Setup.

**Spec:** `docs/superpowers/specs/2026-11-26-preventivi-pro-1-0-6-design.md`; accepted user requirements are captured in the repository specification.

## Global Constraints

- Base commit is tag `v1.0.5` (`2af16c336bacc9c6db5c13b2d24f4e80b12bffaf`); work on branch `feat/preventivi-pro-1.0.6`.
- Preserve original/client PDF layout, quote calculations, product modules, quote editing/saving, separate output paths, and supplier PDF privacy.
- Preserve `AppId`, executable identity, legacy settings/database directories and filenames, JSON backup format, IndexedDB name/version, and module message channel.
- WhatsApp opens only through `whatsapp://send?phone=...` on Windows; no text or actual send automation. Attachment and send remain operator actions.
- Send timestamps are recorded only after explicit operator confirmation.
- Phone is optional; validate and normalize form only. No network lookup, paid API, dependency, or assertion of WhatsApp registration.
- No release/tag/push or real customer data. No new orders, work orders, inventory, delivery or installation features.
- Optional enhancements from request section 8 are analysis only.

## Review Focus

- Invalid/corrupt existing JSON or unwritable backup path: startup must leave the original archive intact and report failure; Task 1 tests this.
- Legacy and international phone formats, empty values, and numbers outside supported E.164 length: validation must be predictable without claiming WhatsApp registration; Task 2 tests this.
- Supplier PDF sending and timestamps must not accidentally update customer state or expose customer prices/data; Tasks 3 and 4 test recipient/PDF-kind separation and supplier PDF regression.
- Duplicate quote must not mutate the original or carry send metadata; Task 5 tests deep-copy independence and reset behavior.
- Upgrade must retain data locations, installer identity and compatibility strings while visible branding changes; Tasks 6 and 7 test those invariants.
- Final source review must inspect the complete diff for unintended formula/PDF layout changes, customer data in supplier PDFs, stale visible Area Tenda identity, and changes to compatibility identifiers.

---

### Task 1: Back up and normalize legacy quote records

**Files:**
- Modify: `local_store.py`
- Test: `tests/test_local_store.py`

**Interfaces:**
- Produces: `LocalStore._migrate_quote_send_fields(state) -> tuple[dict, bool]`, which adds nullable `sentCustomerAt` and `sentSupplierAt` to legacy quote dictionaries and reports whether the archive changed.

- [x] **Step 1: Write failing tests** `test_legacy_quotes_gain_empty_send_fields_and_original_archive_is_backed_up` and `test_backup_failure_keeps_original_database_unchanged`. Assert timestamps are `None`, the backup is byte-identical to the original JSON, and failure leaves source bytes unchanged.
- [x] **Step 2: Run** `python3 -m unittest tests.test_local_store.LocalStoreTests.test_legacy_quotes_gain_empty_send_fields_and_original_archive_is_backed_up tests.test_local_store.LocalStoreTests.test_backup_failure_keeps_original_database_unchanged -v`. Expected: both fail because load does not migrate or back up.
- [x] **Step 3: Implement** normalization on database load; if normalization changes records, create a unique same-folder backup before atomically writing the normalized archive. Never overwrite a prior backup. On backup failure, raise and preserve source bytes.
- [x] **Step 4: Run** the same two tests. Expected: both pass.
- [x] **Step 5: Run** `python3 -m unittest tests.test_local_store -v`. Expected: all LocalStore tests pass.

### Task 2: Validate optional client phone numbers

**Files:**
- Modify: `gestionale.js`
- Test: `tests/test_preventivi_v1_0_6.js`

**Interfaces:**
- Produces: `normalizePhoneNumber(value) -> { value: string, valid: boolean, empty: boolean }`, using E.164-like formatting with 8–15 digits; national Italian numbers receive `+39`. Empty is allowed, but a nonempty invalid value blocks saving the client and shows an inline error.

- [ ] **Step 1: Write failing tests** `normalizePhoneNumber adds the Italian prefix`, `normalizePhoneNumber accepts international numbers`, `normalizePhoneNumber allows an empty optional value`, `normalizePhoneNumber rejects malformed lengths`, and `invalid phone prevents client save`. Assert exact normalized output, validity, and unchanged client list after rejected save.
- [ ] **Step 2: Run** `node --test tests/test_preventivi_v1_0_6.js`. Expected: tests fail because the helper is absent.
- [ ] **Step 3: Implement** a pure normalizer, use it to render a `type=tel` client field with live feedback and to normalize on save. Keep blank optional and block formally invalid nonblank input.
- [ ] **Step 4: Run** `node --test tests/test_preventivi_v1_0_6.js`. Expected: all phone cases pass.
- [ ] **Step 5: Run** `node --test tests/*.js`. Expected: all JavaScript tests pass.

### Task 3: Open WhatsApp Desktop with recipient only

**Files:**
- Modify: `desktop_app.py`
- Test: `tests/test_desktop_api.py`

**Interfaces:**
- Consumes: normalized international phone string from Task 2.
- Produces: `DesktopApi.open_whatsapp(phone: str) -> {ok: true}`; Windows URI is exactly `whatsapp://send?phone=<digits>`. Front-end asks for a recipient when customer phone is blank and always asks for supplier recipient, since suppliers have no address book entry.

- [ ] **Step 1: Write failing tests** `test_open_whatsapp_launches_desktop_protocol_with_phone_only`, `test_open_whatsapp_rejects_invalid_phone`, and `test_open_whatsapp_reports_non_windows_or_missing_protocol_handler`. Assert no message/query text and no browser call.
- [ ] **Step 2: Run** `python3 -m unittest tests.test_desktop_api -v`. Expected: the new tests fail against the current browser/message implementation.
- [ ] **Step 3: Implement** validation and Windows URI dispatch through the OS protocol association. Return clear errors for unsupported OS/failed launch. Do not use clipboard, UI automation, webbrowser, or send API.
- [ ] **Step 4: Run** `python3 -m unittest tests.test_desktop_api -v`. Expected: all desktop API tests pass.
- [ ] **Step 5: Run** `python3 -m unittest discover -s tests -v`. Expected: all Python tests pass.

### Task 4: Show independent send status and confirmation

**Files:**
- Modify: `gestionale.js`, `gestionale.css`
- Test: `tests/test_preventivi_v1_0_6.js`
- Regression: `tests/test_quote_pdf_layout.js`

**Interfaces:**
- Consumes: Task 1 fields `sentCustomerAt` / `sentSupplierAt`; Task 3 `open_whatsapp(phone)`.
- Produces: independent “Segna PDF cliente inviato” and “Segna PDF fornitore inviato” actions that record `new Date().toISOString()` only after a second explicit confirmation. WhatsApp handoff generates/saves only the selected PDF, passes only the selected normalized recipient, and tells the operator to attach the file and return to confirm.

- [ ] **Step 1: Write failing tests** `customer and supplier send timestamps are independent`, `opening WhatsApp does not mark a quote sent`, `cancelled manual confirmation does not mark sent`, `confirmed send stores an ISO timestamp`, and `WhatsApp handoff supplies customer phone and no message`. Assert the untouched timestamp remains null.
- [ ] **Step 2: Run** `node --test tests/test_preventivi_v1_0_6.js`. Expected: failures because state/actions are absent or message is still generated.
- [ ] **Step 3: Implement** separate status badges in editor and quote list, separate manual confirmation actions, optional recipient entry for supplier/no client phone, and the text-free WhatsApp flow. Keep PDF kind passed to the existing generators unchanged.
- [ ] **Step 4: Run** the new JS tests. Expected: all handoff and confirmation cases pass.
- [ ] **Step 5: Run** `node --test tests/*.js`. Expected: all JavaScript tests pass and supplier PDF contains no customer totals/prices.

### Task 5: Duplicate an edited quote safely

**Files:**
- Modify: `gestionale.js`
- Test: `tests/test_preventivi_v1_0_6.js`

**Interfaces:**
- Produces: `duplicateQuote(sourceQuote) -> quote`, with deep-copied commercial fields/items, unique ID and `-COPIA-NNN` number, current creation/update date, draft status, and null send timestamps.

- [ ] **Step 1: Write failing tests** `duplicateQuote preserves quote data with a new identity`, `duplicateQuote clears both send timestamps`, `duplicateQuote copies nested module data independently`, and `duplicateQuote generates a unique number across the archive`. Assert editing nested copied item data leaves the original unchanged and collisions increment the global copy suffix.
- [ ] **Step 2: Run** the new JS test file. Expected: failures because duplication is absent.
- [ ] **Step 3: Implement** the pure duplicate helper and add a `Duplica preventivo` button in the open quote editor. Save the copy independently; leave ordinary save behavior unchanged.
- [ ] **Step 4: Run** the new JS tests. Expected: all duplication cases pass.
- [ ] **Step 5: Run** `node --test tests/*.js`. Expected: all JavaScript tests pass.

### Task 6: Replace visible identity and PDF metadata

**Files:**
- Modify: `Gestione_preventivi.html`, `Apri_catalogo.html`, user-facing strings in `Moduli/*.html`, `gestionale.js`, `gestionale-pdf.js`, `packaging/windows/GestionalePreventivi.iss`, `packaging/windows/version_info.txt`, README/manual/install instructions, workflow artifact/version strings.
- Preserve: `local_store.py`, IndexedDB/channel/backup format identifiers, `AppId`, data directory names, module serialization keys.
- Test: `tests/test_preventivi_v1_0_6.js`, `tests/test_quote_pdf_layout.js`

- [ ] **Step 1: Write failing tests** `visible application identity is CorradoWEB 2026`, `legacy storage and protocol identifiers stay stable`, and `generated PDFs identify CorradoWEB 2026 as author`. Assert visible branding and PDF author/creator values while checking compatibility strings remain.
- [ ] **Step 2: Run** the focused Node tests. Expected: branding assertions fail against current Area Tenda identity and missing author metadata.
- [ ] **Step 3: Implement** exact `CorradoWEB 2026` visible authorship, PDF metadata and Windows publisher/version identity; replace only user-facing Area Tenda references. Set application/package/installer version to 1.0.6 while retaining technical compatibility identifiers and the same installer AppId/install directory.
- [ ] **Step 4: Run** focused identity/PDF tests. Expected: pass.
- [ ] **Step 5: Run** all JavaScript tests. Expected: pass, including unchanged PDF structure/totals.

### Task 7: Verify upgrade configuration and handoff

**Files:**
- Modify: `.github/workflows/*`, `README_WINDOWS_MAC.md`, `Istruzioni_gestionale.txt`, `docs/INSTALLAZIONE_WINDOWS.md`, `docs/superpowers/specs/2026-11-26-preventivi-pro-1-0-6-design.md`
- Test: `tests/test_preventivi_v1_0_6.js`, existing Python/JavaScript suites

- [ ] **Step 1: Write failing checks** for 1.0.6 version consistency, stable `AppId` and install/data paths, no updater configuration, and supplier PDF privacy. Expected: checks fail on 1.0.5 metadata or missing 1.0.6 upgrade instructions.
- [ ] **Step 2: Implement** versioned workflow artifact and documentation. Confirm Inno Setup installs to the same path with `ignoreversion`; no automatic updater is added. Document backup/migration behavior and Windows-only manual checks.
- [ ] **Step 3: Run** `python3 -m unittest discover -s tests -v` and `node --test tests/*.js`. Expected: both suites pass.
- [ ] **Step 4: Run** source-level package checks for all 32 modules and matching `1.0.6` strings. Expected: all module resources present and version metadata consistent.
- [ ] **Step 5: Record** that Windows installer generation, real 1.0.5 in-place upgrade, WhatsApp Desktop launch/recipient/focus/attachment and actual send confirmation require a Windows machine; do not tag, push, or publish.

