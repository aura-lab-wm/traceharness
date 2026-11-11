"""Real loopback transport regression; no provider calls or real credentials."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import time
import unittest

from harnesslab.runner_service.provider import OpenRouter, ProviderError

PAYLOAD = b'event: response.completed\ndata: {"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":3,"output_tokens":1,"cost":0.0001}}}\n\n'


class ModelTransportDeadlineTests(unittest.TestCase):
    def serve(self, *, header_delay=0, chunk_delay=0, drip=False):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                time.sleep(header_delay)
                try:
                    self.send_response(200)
                    self.send_header('Content-Type','text/event-stream')
                    self.send_header('Content-Length',str(len(PAYLOAD)))
                    self.end_headers()
                    if drip:
                        for byte in PAYLOAD:
                            self.wfile.write(bytes([byte]));self.wfile.flush();time.sleep(.04)
                    elif chunk_delay:
                        self.wfile.write(PAYLOAD[:10]);self.wfile.flush();time.sleep(chunk_delay)
                        self.wfile.write(PAYLOAD[10:])
                    else:self.wfile.write(PAYLOAD)
                except OSError:pass
        server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        server.daemon_threads=True
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        self.addCleanup(server.server_close);self.addCleanup(server.shutdown)
        provider=OpenRouter();provider.base='http://127.0.0.1:'+str(server.server_port)
        return provider

    def test_model_can_take_more_than_three_seconds_to_send_headers_within_reviewed_deadline(self):
        provider=self.serve(header_delay=3.2)
        self.assertEqual(provider._forward_local('responses','explicit-fixture-key',{},timeout_seconds=6),('text/event-stream',PAYLOAD))

    def test_model_can_pause_between_chunks_without_losing_sse_within_total_deadline(self):
        provider=self.serve(chunk_delay=3.2)
        self.assertEqual(provider._forward_local('responses','explicit-fixture-key',{},timeout_seconds=6),('text/event-stream',PAYLOAD))

    def test_slow_drip_does_not_extend_total_model_deadline(self):
        provider=self.serve(drip=True);start=time.monotonic()
        with self.assertRaises(ProviderError):provider._forward_local('responses','explicit-fixture-key',{},timeout_seconds=.25)
        self.assertLess(time.monotonic()-start,1)

if __name__=='__main__':unittest.main()
