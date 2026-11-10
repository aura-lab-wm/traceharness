"""Explicit private-service settings; no account secrets or public bind defaults."""
from dataclasses import dataclass, field
from pathlib import Path
import os


@dataclass(frozen=True)
class Settings:
    shared_secret: str = field(repr=False)
    state_dir: Path
    registry_path: Path | None = None
    execution_enabled: bool = False
    docker_binary: str = "/usr/bin/docker"
    isolation_runtime: str = "runsc"
    network: str = "traceharness-jobs"
    gateway_origin: str = ""
    max_workers: int = 2
    max_jobs_per_owner: int = 100
    max_active_per_owner: int = 2
    job_ttl: int = 86400

    def __post_init__(self):
        if not isinstance(self.shared_secret, str) or len(self.shared_secret) < 32:
            raise ValueError("RUNNER_SHARED_SECRET must contain at least 32 characters")
        if self.isolation_runtime not in {"runsc", "kata-runtime", "io.containerd.kata.v2"}:
            raise ValueError("A separately provisioned isolation runtime is required")
        if not 1 <= self.max_workers <= 8 or self.job_ttl < 3600:
            raise ValueError("Invalid runner capacity")

    @classmethod
    def from_env(cls):
        path = os.environ.get("RUNNER_REGISTRY")
        return cls(shared_secret=os.environ.get("RUNNER_SHARED_SECRET", ""),
                   state_dir=Path(os.environ.get("RUNNER_STATE_DIR", "/var/lib/traceharness-runner")),
                   registry_path=Path(path) if path else None,
                   execution_enabled=os.environ.get("RUNNER_EXECUTION_ENABLED") == "1",
                   docker_binary=os.environ.get("RUNNER_DOCKER", "/usr/bin/docker"),
                   isolation_runtime=os.environ.get("RUNNER_ISOLATION_RUNTIME", "runsc"),
                   network=os.environ.get("RUNNER_NETWORK", "traceharness-jobs"),
                   gateway_origin=os.environ.get("RUNNER_GATEWAY_ORIGIN", ""),
                   max_workers=int(os.environ.get("RUNNER_MAX_WORKERS", "2")),
                   max_active_per_owner=int(os.environ.get("RUNNER_MAX_ACTIVE_PER_OWNER", "2")))
