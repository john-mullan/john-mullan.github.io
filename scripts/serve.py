"""Local preview server with HTTP Range support (needed for audio seeking).

Python's stock `http.server` ignores Range headers, which breaks seeking in
audio players. GitHub Pages supports Range natively; this makes local preview
behave the same:  python scripts/serve.py [port]
"""
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class RangeHandler(SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        range_header = self.headers.get("Range")
        if not (range_header and os.path.isfile(path)):
            return super().send_head()
        m = re.match(r"bytes=(\d*)-(\d*)$", range_header.strip())
        size = os.path.getsize(path)
        if not m or (not m.group(1) and not m.group(2)):
            return super().send_head()
        start = int(m.group(1)) if m.group(1) else size - int(m.group(2))
        end = int(m.group(2)) if m.group(1) and m.group(2) else size - 1
        start, end = max(0, start), min(end, size - 1)
        if start > end:
            self.send_error(416, "Requested Range Not Satisfiable")
            return None
        f = open(path, "rb")
        f.seek(start)
        self.range_length = end - start + 1
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Range", "bytes %d-%d/%d" % (start, end, size))
        self.send_header("Content-Length", str(self.range_length))
        self.end_headers()
        return f

    def copyfile(self, source, outputfile):
        if hasattr(self, "range_length"):
            remaining = self.range_length
            del self.range_length
            while remaining > 0:
                chunk = source.read(min(65536, remaining))
                if not chunk:
                    break
                outputfile.write(chunk)
                remaining -= len(chunk)
        else:
            super().copyfile(source, outputfile)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    handler = partial(RangeHandler, directory=root)
    print("Serving %s at http://localhost:%d" % (os.path.abspath(root), port))
    ThreadingHTTPServer(("", port), handler).serve_forever()


if __name__ == "__main__":
    main()
