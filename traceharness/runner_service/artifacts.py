"""Owner-authorized downloads of bounded, finalized runner artifacts."""
import base64
import hashlib
import os
import stat

from .jobs import JobError

ARTIFACT_NAMES = frozenset({"manifest.json", "grade.json", "trace.jsonl", "messages.json", "patch.diff", "summary.json",
                            "native-prompt-profile.json", "native-prompt-application.json", "native-prompt-observations.json"})
MAX_ARTIFACT_BYTES = 1024 * 1024


def read_artifact(jobs, owner, job_id, name):
    if name not in ARTIFACT_NAMES:
        raise JobError("Artifact not found.", 404)
    # Keep retention cleanup from racing the ownership check and file read.
    with jobs.lock:
        job = jobs.get(owner, job_id)
        item = next((row for row in job.get("artifacts", []) if row.get("name") == name), None)
        if not item:
            raise JobError("Artifact not found.", 404)
        path = jobs.root / job_id / name
        try:
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, "rb") as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_ARTIFACT_BYTES:
                    raise ValueError()
                raw = stream.read(MAX_ARTIFACT_BYTES + 1)
            if len(raw) != item["bytes"] or len(raw) > MAX_ARTIFACT_BYTES or hashlib.sha256(raw).hexdigest() != item["sha256"]:
                raise ValueError()
        except (OSError, ValueError, KeyError, TypeError):
            raise JobError("Artifact integrity could not be verified.", 409) from None
        return {"name": name, "bytes": len(raw), "sha256": item["sha256"], "encoding": "base64", "content": base64.b64encode(raw).decode("ascii")}
