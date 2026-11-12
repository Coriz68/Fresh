#!/bin/sh
cd "$(dirname "$0")" || exit 1
if [ ! -x ".venv/bin/python" ]; then
  python3 -m venv .venv || exit 1
fi
if ! ".venv/bin/python" -c "import webview" >/dev/null 2>&1; then
  ".venv/bin/python" -m pip install -r requirements.txt || exit 1
fi
".venv/bin/python" desktop_app.py
