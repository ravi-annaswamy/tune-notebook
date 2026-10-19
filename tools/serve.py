"""Local dev server that disables browser caching (python's default lets the browser
reuse stale ES modules after edits). Run: python3 tools/serve.py [port]"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    root = Path(__file__).resolve().parent.parent
    handler = partial(NoCacheHandler, directory=str(root))
    print(f"Serving {root} on http://localhost:{port} (no-store)")
    ThreadingHTTPServer(("", port), handler).serve_forever()
