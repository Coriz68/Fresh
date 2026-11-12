# Gestionale desktop locale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a development version of the quote manager that runs in a desktop window on macOS and Windows, stores all business data in a user-selected local JSON database, and saves separate customer and supplier PDFs to user-selected folders; defer Windows executable packaging until the user verifies the app and approves packaging.

**Architecture:** Use pywebview to host the existing HTML/JavaScript UI and expose a narrow Python API for local persistence, native folder/file dialogs, and PDF writing. Store state atomically in a JSON file under the selected database folder, and store only application paths in the per-user config directory. Keep the existing browser IndexedDB path as a fallback for opening the old browser edition.

**Tech Stack:** Python 3, pywebview (WebView2 on Windows, native WebKit backend on macOS), existing HTML/CSS/JavaScript, bundled pdf-lib, PyInstaller only in a later user-approved Windows packaging phase.

**Spec:** `docs/superpowers/specs/2026-11-12-gestionale-windows-desktop-design.md`

## Global Constraints

- The target of release is Windows 10/11; the development environment must also run on macOS.
- The application must run without Internet after its dependencies are installed.
- The database is a local JSON file in the selected database folder; writes must be atomic.
- The customer PDF contains the full quote summary and every completed module; the supplier PDF contains only the completed modules.
- Every module PDF must contain the customer name and quote number in its existing `cliente` and `riferimento` fields.
- The customer and supplier PDF folders must be distinct and selected by the user.
- A valid database in a newly selected folder is opened; an empty folder prompts to copy current data or start empty; an invalid database is never overwritten.
- Preserve the browser-based IndexedDB fallback and never alter or delete its existing data.
- Deliver development launchers for Windows and macOS first. Do not create the Windows executable until the user has verified the app and approved packaging.

## Review Focus

- Database path switches among valid, empty, invalid, and non-writable folders; show the correct open/copy/start-empty/error flow and preserve all previous data.
- Interrupted or rejected disk writes; show an error and keep the last valid database and generated PDFs intact.
- Customer names with accents, apostrophes, Windows-reserved characters, and very long text; stamp readable module fields and produce safe filenames.
- Large PDF byte payloads passed from JavaScript to Python; preserve exact bytes and save a readable PDF in the selected destination.
- Two destinations accidentally configured to the same directory or a filename collision; reject identical destinations and never overwrite an existing PDF silently.

---

### Task 1: Local JSON storage and native desktop API

**Files:**
- Create: `local_store.py`
- Create: `desktop_app.py`

**Interfaces:**
- `LocalStore.load() -> dict`: return `{state, paths, database_path}` from the configured local database; return an empty-state payload when no database folder is configured.
- `LocalStore.save(state: dict) -> None`: validate the top-level state shape, write a temporary UTF-8 JSON file, flush it, and atomically replace `preventivi.json`.
- `DesktopApi.load_initial_data() -> dict`: return the initialized app state and configured paths.
- `DesktopApi.save_state(state: dict) -> None`: persist a state snapshot through `LocalStore.save`.
- `DesktopApi.choose_database_folder() -> dict`: show a native directory dialog, then return the selected path and whether a valid database already exists there.
- `DesktopApi.set_database_folder(path: str, mode: str) -> dict`: accept `mode` values `open`, `copy-current`, or `empty`; validate the selected folder and return the loaded state and paths.
- `DesktopApi.choose_output_folder(kind: str) -> dict`: accept only `customer` or `supplier`, use a native folder dialog, persist the chosen path, and reject a path equal to the other PDF destination.
- `DesktopApi.write_pdf(kind: str, filename: str, base64_data: str) -> dict`: accept only `customer` or `supplier`, sanitize to a basename, decode bytes, write exclusively in the configured folder, and choose a numbered suffix if a file already exists.
- Persist per-user paths in `%LOCALAPPDATA%/AreaTendaPreventivi/settings.json` on Windows and `~/Library/Application Support/AreaTendaPreventivi/settings.json` on macOS.

- [ ] Add `LocalStore` empty-state defaults matching `emptyState()` in `gestionale.js`; add a manual inspection case for an unconfigured first launch.
- [ ] Implement atomic JSON save and safe load/migration errors; verify with a manual run that a forced write failure leaves the previous `preventivi.json` readable.
- [ ] Implement the pywebview `DesktopApi` directory and file dialogs and bind it to the application window; verify the native dialogs return a path on both supported systems.
- [ ] Implement output writing with path containment checks and numbered collision suffixes; verify same-folder selection is rejected and an existing PDF remains unchanged.

### Task 2: Cross-platform desktop host and development launchers

**Files:**
- Leave: `avvia_gestionale.py` as the existing browser-server fallback
- Modify: `Avvia_gestionale.command`
- Create: `Avvia_gestionale_windows.bat`
- Create: `requirements.txt`

**Interfaces:**
- `desktop_app.main() -> None`: start the local static origin, create a pywebview window with `DesktopApi`, and shut the server down when the window closes.
- Launchers activate the documented environment and run the same Python entrypoint; they must not create an executable.

- [ ] Serve the existing static files on a loopback-only local origin and open `Gestione_preventivi.html` inside pywebview; preserve same-origin iframe messaging for modules.
- [ ] Add Windows and macOS development launchers plus concise setup instructions for creating a virtual environment and installing `requirements.txt`; keep the existing browser-server fallback available.
- [ ] Handle a missing WebView runtime or native backend with a clear Italian message and the official install/setup direction.
- [ ] Manually launch the development app on macOS and Windows and confirm the main screen, catalog, and one module open inside the desktop window; do not package an `.exe` in this task.

### Task 3: Database settings, persistence, and legacy backup workflow

**Files:**
- Modify: `Gestione_preventivi.html`
- Modify: `gestionale.js`
- Modify: `gestionale.css`
- Modify: `desktop_app.py`
- Modify: `local_store.py`

**Interfaces:**
- JavaScript helper `desktopApi() -> object | null`: return `window.pywebview.api` when available, otherwise `null` for the browser fallback.
- JavaScript helper `loadInitialState() -> Promise<{state, paths}>`: await the pywebview bridge or use the existing IndexedDB implementation.
- JavaScript helper `persistState(snapshot) -> Promise<void>`: serialize writes through the existing `saveQueue`; send the snapshot to `DesktopApi.save_state(state)` in desktop mode and keep IndexedDB behavior in browser mode.
- `DesktopApi.export_backup(payload_json: str) -> dict` and `DesktopApi.import_backup() -> dict`: use native JSON save/open dialogs and preserve the existing backup envelope/version.

- [ ] Replace desktop-mode initialization and writes with the Python bridge while retaining IndexedDB when no pywebview bridge exists; preserve debounce/queue ordering.
- [ ] Add three visible path settings (database, customer PDFs, supplier PDFs), native folder selection, and saved path status; enforce distinct PDF paths.
- [ ] Implement database switching: open an existing valid database; for an empty folder prompt to copy current data or initialize empty; reject malformed archives without replacing them.
- [ ] Keep backup import/export available using native dialogs in desktop mode and the current downloads/file picker in browser mode; import a prior browser backup with confirmation.
- [ ] Manually verify a record survives app close/reopen on both macOS and Windows and that a valid legacy backup appears in the selected database.

### Task 4: Separate customer and supplier PDF generation

**Files:**
- Modify: `Gestione_preventivi.html`
- Modify: `gestionale.js`
- Modify: `gestionale-pdf.js`
- Modify: `desktop_app.py`

**Interfaces:**
- `buildQuotePdfDocument(payload, modulePdfs) -> Promise<Uint8Array>`: preserve current complete customer PDF behavior.
- `buildSupplierPdfDocument(modulePdfs) -> Promise<Uint8Array>`: merge the module pages only; add no commercial summary pages.
- `generateQuotePdf(kind: 'customer' | 'supplier') -> Promise<void>`: collect the quote modules, add `cliente` and `riferimento` to cloned module data, build only the selected document type, and save via `DesktopApi.write_pdf` or download in browser fallback.

- [ ] Add two explicit quote actions, “Genera PDF cliente” and “Genera PDF fornitore”; each action must generate only its selected document.
- [ ] Populate each cloned module's existing `cliente` and `riferimento` keys from the saved client snapshot and quote number without changing unrelated module fields.
- [ ] Add supplier-only PDF assembly using pdf-lib to copy all pages from all selected module PDFs and no quote summary.
- [ ] Save the customer and supplier PDFs only into their respective configured folders; include quote number and sanitized customer name in the filename and report the final full path.
- [ ] Manually inspect one PDF of each type: customer includes prices/discounts/tax/notes and every module; supplier includes every module with client/reference and no commercial summary or prices.
- [ ] Manually cover a multi-module quote, a module with missing mandatory fields, Unicode client names, filename collision, and a large PDF payload that reopens correctly on both systems.

### Task 5: User documentation and staged handoff

**Files:**
- Modify: `Istruzioni_gestionale.txt`
- Create: `README_WINDOWS_MAC.md`
- Modify: `Licenza_pdf-lib.txt` only if new runtime dependency notices require it

- [ ] Document development setup and launch on Windows and macOS, folder configuration, database switching, backup import/export, and the two PDF destinations.
- [ ] State clearly that the first delivery is source-runnable and does not include a Windows executable.
- [ ] Provide a user verification checklist and wait for the user's confirmation before any PyInstaller/installer task or `.exe` creation.

### Later task (after user verification): Windows executable packaging

Do not execute this task as part of the first delivery. After the user confirms the Windows/macOS development version and explicitly approves packaging, add a reproducible Windows packaging script/spec and build on Windows. PyInstaller cannot cross-compile a Windows executable from macOS, so the build must run on Windows or a Windows CI worker.
