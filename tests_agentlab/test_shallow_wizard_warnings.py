"""Read-only minimal cells warn without changing the compiled harness."""
from traceharness.core.harness import content_hash
from traceharness.shallow.wizard import compile_minimal, recommended_answers

VERIFY = "This prompt asks to edit files and run tests, and neither edit_file nor run_tests is mounted."
PERMISSIVE = "Read only is paired with a permissive policy."


def test_recommended_cell_keeps_its_hash_and_stays_quiet():
    built = compile_minimal()
    assert built["harness"]["id"] == "min_099dc52e693e"
    assert built["hash"] == "099dc52e693e"
    assert content_hash(built["harness"]) == built["hash"]
    assert VERIFY not in built["warnings"]
    assert PERMISSIVE not in built["warnings"]


def test_read_only_verify_warns_and_leaves_the_harness_alone():
    answers = {**recommended_answers(), "touch": "read_only"}
    built = compile_minimal(answers)
    tools = built["harness"]["tools"]
    assert "edit_file" not in tools
    assert "run_tests" not in tools
    assert VERIFY in built["warnings"]
    assert PERMISSIVE not in built["warnings"]
    assert content_hash(built["harness"]) == built["hash"]
    assert built["harness"]["id"] == "min_" + built["hash"]
    assert built["harness"]["id"] != "min_099dc52e693e"


def test_read_only_permissive_warns_without_the_verify_sentence():
    answers = {**recommended_answers(), "touch": "read_only", "verify": "no", "dangerous": "permissive"}
    built = compile_minimal(answers)
    assert VERIFY not in built["warnings"]
    assert PERMISSIVE in built["warnings"]
    assert content_hash(built["harness"]) == built["hash"]


def test_both_read_only_mismatches_are_listed():
    answers = {**recommended_answers(), "touch": "read_only", "dangerous": "permissive"}
    built = compile_minimal(answers)
    assert built["warnings"][-2:] == [VERIFY, PERMISSIVE]


def test_permissive_with_edit_tools_is_not_this_warning():
    answers = {**recommended_answers(), "dangerous": "permissive"}
    built = compile_minimal(answers)
    assert VERIFY not in built["warnings"]
    assert PERMISSIVE not in built["warnings"]
