@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    py -3 -m venv .venv
    if errorlevel 1 (
        echo Non trovo Python 3. Installa Python 3 e riprova.
        pause
        exit /b 1
    )
)

".venv\Scripts\python.exe" -c "import webview" >nul 2>&1
if errorlevel 1 (
    ".venv\Scripts\python.exe" -m pip install -r requirements.txt
    if errorlevel 1 (
        echo Installazione delle dipendenze non riuscita.
        pause
        exit /b 1
    )
)

".venv\Scripts\python.exe" desktop_app.py
if errorlevel 1 pause
