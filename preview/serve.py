"""Local preview of the popup: python preview/serve.py  ->  http://localhost:8765/
Serves the real popup files with a stubbed chrome API and sample data. Not part of the extension."""
import http.server, os, socketserver
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(root)
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.split('?')[0] in ('/', '/index.html'):
            html = open('popup.html', encoding='utf-8').read().replace('<head>', '<head>\n<script src="/preview/stub.js"></script>', 1)
            b = html.encode('utf-8')
            self.send_response(200); self.send_header('Content-Type', 'text/html; charset=utf-8'); self.send_header('Content-Length', str(len(b))); self.send_header('Cache-Control', 'no-store'); self.end_headers(); self.wfile.write(b)
        else:
            super().do_GET()
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', 8765), H) as s:
    print('Preview at http://localhost:8765/  (Ctrl+C to stop)'); s.serve_forever()
