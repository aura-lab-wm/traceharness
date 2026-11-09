"""Exercise a real compressed export in Chromium, including offline and damaged-file paths.

This standalone test accepts the actual export artifact; it never constructs a mock corpus.
Use the Python installation that has Playwright, independently of the backend environment:

  python3 tests_agentlab/test_static_export_browser.py --workbench-export /tmp/recorded.html \
      --chromium /path/to/chrome --report /tmp/export-browser-report.json
"""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import re
import tempfile
import time


PAYLOAD = re.compile(r'(<script id="harnesslab-data"[^>]*data-bytes=")(\d+)(">)([^<]*)(</script>)')


def inventory(data):
    coverage = {}
    for directory in data['__meta__']['results']:
        rows = data[f'/results/{directory}/runs']
        details = [data[f'/results/{directory}/runs/{row["run_id"]}'] for row in rows
                   if f'/results/{directory}/runs/{row["run_id"]}' in data]
        assert all(isinstance(detail.get('summary'), dict) and isinstance(detail.get('spans'), list)
                   for detail in details), 'a recorded ledger has an invalid shape'
        coverage[directory] = {'index_rows': len(rows), 'embedded_runs': len(details),
                               'spans': sum(len(detail['spans']) for detail in details)}
    return coverage


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbench-export', type=Path, required=True)
    parser.add_argument('--chromium', required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    raw_html = args.workbench_export.read_bytes()
    html = raw_html.decode('utf-8')
    match = PAYLOAD.search(html)
    assert match, 'this browser test requires an actual --export-compress-data artifact'
    payload = gzip.decompress(base64.b64decode(match[4], validate=True))
    assert len(payload) == int(match[2]), 'decoded byte count mismatch'
    expected = inventory(json.loads(payload))
    report = {'artifact': str(args.workbench_export.resolve()), 'sha256': hashlib.sha256(raw_html).hexdigest(),
              'html_bytes': len(raw_html), 'decoded_data_bytes': len(payload), 'coverage': expected, 'checks': {}}
    from playwright.sync_api import sync_playwright

    with sync_playwright() as playwright, tempfile.TemporaryDirectory(prefix='traceharness-export-browser-') as td:
        browser = playwright.chromium.launch(executable_path=args.chromium, headless=True)
        page = browser.new_page()
        requests, errors = [], []
        page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('http://**/*', lambda route: route.abort())
        page.route('https://**/*', lambda route: route.abort())
        started = time.monotonic()
        page.goto(args.workbench_export.resolve().as_uri(), wait_until='domcontentloaded')
        page.wait_for_function('!!window.__HARNESSLAB_DATA__', timeout=60000)
        page.wait_for_function('!document.getElementById("hl-boot") && document.getElementById("root").children.length > 0', timeout=60000)
        actual = page.evaluate('''() => Object.fromEntries(window.__HARNESSLAB_DATA__.__meta__.results.map(directory => {
          const data = window.__HARNESSLAB_DATA__;
          const rows = data[`/results/${directory}/runs`];
          const details = rows.map(row => data[`/results/${directory}/runs/${row.run_id}`]).filter(Boolean);
          if (!details.every(detail => detail.summary && Array.isArray(detail.spans))) throw new Error('invalid browser ledger');
          return [directory, {index_rows: rows.length, embedded_runs: details.length, spans: details.reduce((n, detail) => n + detail.spans.length, 0)}];
        }))''')
        assert actual == expected, 'browser data differs from the exact artifact'
        assert not errors, errors
        assert not requests, requests
        report['checks']['offline_load'] = {'ok': True, 'seconds': round(time.monotonic() - started, 3),
                                             'network_requests': 0, 'page_errors': 0}
        page.close()

        # Each corruption alters only the original artifact's transport, never its study data.
        variants = {
            'unsupported_browser': (html, True),
            'truncated_html': (html[:match.start(4) + len(match[4]) // 2], False),
            'truncated_gzip': (html[:match.start(4)] + match[4][:-16] + html[match.end(4):], False),
            'declared_size_mismatch': (html[:match.start(2)] + str(int(match[2]) - 1) + html[match.end(2):], False),
            'oversize_declared_data': (html[:match.start(2)] + str(256 * 1024 * 1024 + 1) + html[match.end(2):], False),
            'unsupported_encoding': (html.replace('data-encoding="gzip-base64"', 'data-encoding="unknown"', 1), False),
        }
        for name, (broken, unsupported) in variants.items():
            path = Path(td, name + '.html')
            path.write_text(broken)
            page = browser.new_page()
            if unsupported:
                page.add_init_script('window.DecompressionStream = undefined;')
            page.goto(path.as_uri(), wait_until='domcontentloaded')
            panel = page.locator('#harnesslab-export-error')
            panel.wait_for(state='visible', timeout=30000)
            assert 'The recorded data could not be loaded.' in panel.inner_text()
            assert page.evaluate('typeof window.__HARNESSLAB_DATA__') == 'undefined'
            assert page.locator('a[href="/app/shallow"]').count() == 0, 'local file must not invent a hosted member link'
            report['checks'][name] = {'ok': True, 'visible_error': panel.inner_text()}
            page.close()

        # Same failure under an authenticated-member marker keeps a usable local-origin exit.
        page = browser.new_page()
        page.add_init_script('window.DecompressionStream = undefined; window.__TRACEHARNESS_MEMBER__ = {version: 1, scope: "a".repeat(24)};')
        page.route('http://traceharness.test/app', lambda route: route.fulfill(status=200, content_type='text/html', body=html))
        page.goto('http://traceharness.test/app', wait_until='domcontentloaded')
        page.locator('#harnesslab-export-error').wait_for(state='visible')
        link = page.get_by_role('link', name='Open the simple harness editor')
        assert link.get_attribute('href') == '/app/shallow'
        report['checks']['hosted_failure_exit'] = {'ok': True, 'href': '/app/shallow'}
        page.close()
        browser.close()
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'ok': True, 'checks': len(report['checks']), 'report': str(args.report),
                      'coverage': expected, 'offline_seconds': report['checks']['offline_load']['seconds']}))


if __name__ == '__main__':
    main()
