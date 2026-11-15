"""Rebuild agy_conversation.db, the SYNTHETIC agy fixture. Run from anywhere:

    python tests_agentlab/fixtures/capture/build_agy_conversation.py [out.db]

An agy conversation is a SQLite file whose payload columns are protobuf blobs, so it cannot be
committed as text; this script is the source of truth and the committed .db is its output. Nothing
here comes from a real session: the schema and the protobuf field numbers mirror the real format
(see traceharness/backend/importers/agy.py), the content is an invented toy repo -- calc.py whose
add() subtracts -- that the agent reads, edits and tests. Every timestamp, id and token count is a
constant, so a rebuild parses to the same events (test_importer_agy checks exactly that).
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys

SCHEMA = [
    "CREATE TABLE `trajectory_meta` (`trajectory_id` text,`cascade_id` text,`trajectory_type` integer,`source` integer,PRIMARY KEY (`trajectory_id`))",
    "CREATE TABLE `steps` (`idx` integer,`step_type` integer NOT NULL DEFAULT 0,`status` integer NOT NULL DEFAULT 0,`has_subtrajectory` numeric NOT NULL DEFAULT false,`metadata` blob,`error_details` blob,`permissions` blob,`task_details` blob,`render_info` blob,`step_payload` blob,`step_format` integer NOT NULL DEFAULT 0,PRIMARY KEY (`idx`))",
    "CREATE INDEX `idx_steps_status` ON `steps`(`status`)",
    "CREATE INDEX `idx_steps_step_type` ON `steps`(`step_type`)",
    "CREATE TABLE `gen_metadata` (`idx` integer,`data` blob,`size` integer NOT NULL DEFAULT 0,PRIMARY KEY (`idx`))",
    "CREATE TABLE `executor_metadata` (`idx` integer,`data` blob,PRIMARY KEY (`idx`))",
    "CREATE TABLE `parent_references` (`idx` integer,`data` blob,PRIMARY KEY (`idx`))",
    "CREATE TABLE `trajectory_metadata_blob` (`id` text DEFAULT \"main\",`data` blob,PRIMARY KEY (`id`))",
    "CREATE TABLE `battle_mode_infos` (`idx` integer,`data` blob,PRIMARY KEY (`idx`))",
]

CASCADE = "00000000-aaaa-4bbb-8ccc-000000000001"
TRAJECTORY = "00000000-aaaa-4bbb-8ccc-000000000002"
WORKSPACE = "/work/calc-demo"
T0 = 1800000000


# ----------------------------------------------------------------------------- protobuf encoder
def varint(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def vi(field: int, n: int) -> bytes:
    return varint(field << 3) + varint(n)


def ld(field: int, v) -> bytes:
    v = v.encode() if isinstance(v, str) else v
    return varint(field << 3 | 2) + varint(len(v)) + v


def stamp(sec: float) -> bytes:
    whole = int(sec)
    return vi(1, whole) + vi(2, int(round((sec - whole) * 1e9)))


# ----------------------------------------------------------------------------- steps
def envelope(sec: float, sid: str, *, done: float = 0, usage: bytes = b"", call: bytes = b"") -> bytes:
    return (ld(1, stamp(sec)) + vi(3, 2) + (ld(4, call) if call else b"")
            + (ld(8, stamp(done)) if done else b"") + (ld(9, usage) if usage else b"") + ld(35, sid))


def usage_block(req: str, inp: int, out: int, cache: int, thinking: int) -> bytes:
    return vi(1, 1) + vi(2, inp) + vi(3, out) + vi(5, cache) + ld(7, req) + vi(9, thinking)


def call_msg(cid: str, name: str, args: dict) -> bytes:
    return ld(1, cid) + ld(2, name) + ld(3, json.dumps(args, separators=(",", ":")))


def step(idx, stype, status, md, body_field, body, error=None):
    payload = vi(1, stype) + vi(4, status) + ld(5, md) + ld(body_field, body)
    return (idx, stype, status, 0, md, error, None, None, None, payload, 0)


def build(extras: bool = False) -> list:
    """The conversation's steps. `extras` adds a record type that is not conversation (the conformance
    kit requires the committed fixture to have none; test_importer_agy builds the variant)."""
    rows = []
    prompt = "Fix the bug in add() in calc.py and run the tests."
    rows.append(step(0, 14, 3, envelope(T0 + 0.1, "00000000000000000000000000000a00"), 19,
                     ld(2, prompt) + ld(3, ld(1, prompt))))

    def planner(idx, t, sid, req, thought, reply, calls, u):
        body = b""
        if reply:
            body += ld(1, reply)
        if thought:
            body += ld(3, thought)
        body += ld(6, req)
        for c in calls:
            body += ld(7, c)
        return step(idx, 15, 3, envelope(t, sid, usage=u), 20, body)

    def result(idx, t, sid, call, text, args):
        res = ld(2, ld(1, text) + ld(3, ld(5, "Ran")))
        body = b"".join(ld(1, ld(1, k) + ld(2, str(v))) for k, v in args.items()) + res
        return step(idx, 132, 3, envelope(t, sid, done=t + 0.5, call=call), 140, body)

    c1 = call_msg("call_1001", "read_file", {"Path": f"{WORKSPACE}/calc.py"})
    c2 = call_msg("call_1002", "edit_file", {"Path": f"{WORKSPACE}/calc.py", "Target": "    return a - b",
                                             "Replacement": "    return a + b"})
    c3 = call_msg("call_1003", "run_command", {"CommandLine": "pytest -q", "WaitMsBeforeAsync": 5000})
    rows.append(planner(1, T0 + 1, "00000000000000000000000000000a01", "bot-0001",
                        "Looking at calc.py to find the bug in add.", "", [c1],
                        usage_block("bot-0001", 3000, 60, 0, 20)))
    rows.append(result(2, T0 + 2, "00000000000000000000000000000a02", c1,
                       "Created At: x\nCompleted At: y\nShowing lines 1-2 of 2\n1: def add(a, b):\n2:     return a - b",
                       {"Path": f"{WORKSPACE}/calc.py"}))
    rows.append(planner(3, T0 + 3, "00000000000000000000000000000a03", "bot-0002",
                        "add subtracts; it must add.", "", [c2], usage_block("bot-0002", 200, 40, 2900, 10)))
    rows.append(result(4, T0 + 4, "00000000000000000000000000000a04", c2,
                       "Created At: x\nCompleted At: y\nMade 1 replacement in calc.py",
                       {"Path": f"{WORKSPACE}/calc.py"}))
    rows.append(planner(5, T0 + 5, "00000000000000000000000000000a05", "bot-0003",
                        "", "", [c3], usage_block("bot-0003", 210, 30, 3000, 0)))
    rows.append(result(6, T0 + 6, "00000000000000000000000000000a06", c3,
                       "Created At: x\nCompleted At: y\nCommand exited with code 0.\n\nCommand output:\n"
                       ". [100%]\n1 passed in 0.01s",
                       {"CommandLine": "pytest -q"}))
    if extras:       # a background-task notification: not conversation, counted as an unknown record type
        rows.append(step(7, 101, 3, envelope(T0 + 6.5, "00000000000000000000000000000a07"), 114,
                         ld(3, "task_notification")))
    rows.append(planner(8, T0 + 7, "00000000000000000000000000000a08", "bot-0004", "",
                        "Fixed add() to return a + b; the test passes.", [],
                        usage_block("bot-0004", 220, 25, 3100, 0)))
    return rows


def gen_rows() -> list:
    def row(idx, req, inp, out, cache):
        u = usage_block(req, inp, out, cache, 0)
        body = ld(1, vi(3, 1) + ld(4, u) + ld(19, "gemini-4-demo") + ld(21, "Gemini 4 Demo (High)"))
        return (idx, body, len(body))
    return [row(0, "bot-0001", 3000, 60, 0), row(1, "bot-0002", 200, 40, 2900),
            row(2, "bot-0003", 210, 30, 3000), row(3, "bot-0004", 220, 25, 3100)]


def write(path: str, extras: bool = False) -> None:
    if os.path.exists(path):
        os.remove(path)
    c = sqlite3.connect(path)
    for ddl in SCHEMA:
        c.execute(ddl)
    c.execute("insert into trajectory_meta values (?,?,?,?)", (TRAJECTORY, CASCADE, 4, 17))
    c.executemany("insert into steps values (?,?,?,?,?,?,?,?,?,?,?)", build(extras))
    c.executemany("insert into gen_metadata values (?,?,?)", gen_rows())
    c.execute("insert into executor_metadata values (?,?)", (0, vi(1, 4) + vi(2, 5)))
    meta = (ld(1, ld(1, f"file://{WORKSPACE}") + ld(2, f"file://{WORKSPACE}")) + ld(2, stamp(T0))
            + ld(3, TRAJECTORY) + ld(6, CASCADE) + ld(7, f"file://{WORKSPACE}") + ld(18, "demo-project"))
    c.execute("insert into trajectory_metadata_blob values (?,?)", ("main", meta))
    c.commit()
    c.close()


if __name__ == "__main__":
    write(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                             "agy_conversation.db"))
