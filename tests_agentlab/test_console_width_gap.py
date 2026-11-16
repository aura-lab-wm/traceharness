"""The console width check's internal-gap measure: a pane whose last block is pinned to the bottom edge
leaves a hole in the middle, which the alignment and bottom-band checks cannot see."""
import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location(
    "console_width_check", Path(__file__).resolve().parent.parent / "scripts" / "console_width_check.py")
cwc = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(cwc)


def pane(rects, top=0, bottom=800, ct=None, name="aside"):
    return {"n": name, "t": top, "b": bottom, "l": 0, "r": 400, "ct": top if ct is None else ct,
            "ce": max(r[1] for r in rects), "pb": bottom, "rects": rects}


class InternalGap(unittest.TestCase):
    def test_pinned_last_block_is_a_gap(self):
        gap, at = cwc.internal_gap(pane([[0, 200], [20, 60], [640, 800]]))
        self.assertEqual((gap, at), (440, 200))

    def test_overlapping_and_touching_content_has_no_gap(self):
        self.assertEqual(cwc.internal_gap(pane([[0, 100], [90, 300], [310, 800]]))[0], 10)

    def test_gap_above_first_content_counts(self):
        self.assertEqual(cwc.internal_gap(pane([[300, 800]]))[0], 300)

    def test_report_flags_only_large_gaps_beside_another_pane(self):
        tall = pane([[0, 200], [640, 800]], name="short")
        other = dict(pane([[0, 800]], name="long"), l=500, r=900)
        rep = cwc.pane_report([{"name": "div.split", "panes": [tall, other]}])
        self.assertTrue(any("empty gap inside" in b for b in rep["bad"]), rep)
        small = pane([[0, 300], [400, 800]], name="short")
        rep = cwc.pane_report([{"name": "div.split", "panes": [small, other]}])
        self.assertEqual(rep["bad"], [])


if __name__ == "__main__":
    unittest.main()
