"""Secret field names are stripped in any case, including compound names."""
from harnesslab.shallow.identity import public_record


def test_compound_and_uppercase_secret_names_drop():
    row = public_record({
        "id": "claude",
        "API_KEY": "hidden",
        "access_token": "hidden",
        "max_tokens_per_call": 2048,
        "nested": {"client_secret": "hidden", "harness_id": "claude"},
    })
    assert "API_KEY" not in row
    assert "access_token" not in row
    assert row["max_tokens_per_call"] == 2048
    assert row["id"] == "claude"
    assert row["nested"] == {"harness_id": "claude"}
