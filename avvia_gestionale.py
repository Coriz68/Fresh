#!/usr/bin/env python3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import webbrowser


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8765


class LocalServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    handler = lambda *args, **kwargs: SimpleHTTPRequestHandler(
        *args, directory=str(ROOT), **kwargs
    )
    try:
        server = LocalServer((HOST, PORT), handler)
    except OSError as error:
        raise SystemExit(
            f"Non riesco ad avviare il gestionale sulla porta {PORT}: {error}. "
            "Chiudi l'altra istanza e riprova."
        ) from error

    url = f"http://{HOST}:{PORT}/Gestione_preventivi.html"
    print(f"Gestionale locale attivo: {url}")
    print("Lascia aperta questa finestra. Premi Ctrl+C per arrestarlo.")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nGestionale arrestato.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
