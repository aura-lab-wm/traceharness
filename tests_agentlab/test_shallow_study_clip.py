"""Clip the shared study prompt to each shell's byte cap."""
from traceharness.shallow.catalog import catalog
from traceharness.shallow.study import apply_prompt_to_all, paired_study


def test_grok_clips_to_the_byte_cap_and_keeps_the_shell():
    prompt = "verify Do not modify the tests " + ("a" * 15000)
    rows = apply_prompt_to_all(prompt)
    grok = next(row for row in rows if row["id"] == "grok")
    assert len(grok["prompt"].encode("utf-8")) == 10000
    for row, stock in zip(rows, catalog()):
        assert row["tools"] == stock["tools"]
        assert row["policy"] == stock["policy"]
        assert row["max_steps"] == stock["max_steps"]
        assert row["cap_bytes"] == stock["cap_bytes"]
    study = paired_study("grok", "a" * 15000, 1)
    assert study["was_clipped"] is True
    assert study["prompt_bytes"] == 10000
    short = paired_study("claude", "verify Do not modify the tests.", 2)
    assert short["was_clipped"] is False
    assert short["prompt_bytes"] == len(short["edited"]["prompt"].encode("utf-8"))
