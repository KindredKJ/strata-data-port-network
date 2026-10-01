from http.server import BaseHTTPRequestHandler
from pathlib import Path

INDEX_PATH = Path("public/index.html")


class handler(BaseHTTPRequestHandler):
    def _respond(self, include_body: bool) -> None:
        try:
            body = INDEX_PATH.read_bytes()
            status = 200
            content_type = "text/html; charset=utf-8"
        except FileNotFoundError:
            body = b"Strata Data Port Network launch page unavailable."
            status = 503
            content_type = "text/plain; charset=utf-8"

        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header(
            "Cache-Control",
            "public, max-age=60, s-maxage=300, stale-while-revalidate=300",
        )
        self.end_headers()
        if include_body:
            self.wfile.write(body)

    def do_GET(self):
        self._respond(True)

    def do_HEAD(self):
        self._respond(False)
