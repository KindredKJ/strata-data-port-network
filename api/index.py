from http.server import BaseHTTPRequestHandler
from pathlib import Path

INDEX_PATH = Path("public/index.html")


class handler(BaseHTTPRequestHandler):
    def _send_index(self, include_body: bool) -> None:
        try:
            body = INDEX_PATH.read_bytes()
        except FileNotFoundError:
            body = b"Strata Data Port Network launch page unavailable."
            self.send_response(503)
            self.send_header("Content-Type", "text/plain; charset=utf-8")
        else:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=300")
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def do_GET(self):
        self._send_index(True)

    def do_HEAD(self):
        self._send_index(False)
