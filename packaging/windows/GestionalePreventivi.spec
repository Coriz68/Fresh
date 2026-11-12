# PyInstaller onedir build for the Windows desktop application.
from pathlib import Path
from PyInstaller.utils.hooks import collect_submodules

root = Path(SPECPATH).resolve().parents[1]
data_files = []

for relative in (
    "Gestione_preventivi.html",
    "Apri_catalogo.html",
    "gestionale.css",
    "gestionale-desktop.css",
    "gestionale.js",
    "gestionale-pdf.js",
    "Licenza_pdf-lib.txt",
):
    data_files.append((str(root / relative), "."))

for folder in ("Moduli", "Disegni"):
    for source in (root / folder).rglob("*"):
        if source.is_file():
            data_files.append((str(source), str(source.parent.relative_to(root))))

data_files.append((str(root / "Logo_BN_Trasp_HD.png"), "."))

a = Analysis(
    [str(root / "desktop_app.py")],
    pathex=[str(root)],
    binaries=[],
    datas=data_files,
    hiddenimports=collect_submodules("webview"),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="GestionalePreventivi",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    version="version_info.txt",
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="GestionalePreventivi",
)
