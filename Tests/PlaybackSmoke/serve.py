"""Loopback-only, range-capable fixture endpoint. A test can withhold the first byte."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import re
import sys
import time

root = Path(sys.argv[1])

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.serve(True)

    def do_HEAD(self):
        self.serve(False)

    def serve(self, body):
        route = self.path.lstrip('/')
        if route not in ('slow.mov', 'timeout.mov'):
            self.send_error(404)
            return
        (root / (route + '.requested')).touch()
        deadline = time.monotonic() + 60
        while not (root / (route + '.release')).exists():
            if time.monotonic() >= deadline:
                return
            time.sleep(.02)
        data = (root / 'blue.mov').read_bytes()
        start, end = 0, len(data) - 1
        header = self.headers.get('Range')
        if header:
            m = re.fullmatch(r'bytes=(\d+)-(\d*)', header)
            if not m or not (0 <= int(m[1]) < len(data)):
                self.send_error(416)
                return
            start = int(m[1])
            end = min(int(m[2]), end) if m[2] else end
        self.send_response(206 if header else 200)
        self.send_header('Content-Type', 'video/quicktime')
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Length', str(end - start + 1))
        if header:
            self.send_header('Content-Range', f'bytes {start}-{end}/{len(data)}')
        self.end_headers()
        if body:
            try:
                self.wfile.write(data[start:end + 1])
            except (BrokenPipeError, ConnectionResetError):
                pass

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
(root / 'port').write_text(str(server.server_port))
server.serve_forever()
