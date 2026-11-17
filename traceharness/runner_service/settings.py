"""Runner settings. The local runner builds them in traceharness/runner/local.py; nothing reads the environment here."""
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    state_dir: Path
    registry_path: Path | None = None
    execution_enabled: bool = False
    docker_binary: str = "/usr/bin/docker"
    isolation_runtime: str = "runsc"
    max_workers: int = 2
    max_jobs_per_owner: int = 100
    max_active_per_owner: int = 2
    job_ttl: int = 86400
    #: The local runner (traceharness/runner): in-process behind the backend's own guards, the owner
    #: is the constant "local", plain Docker (runc) is an accepted isolation, and a compatibility
    #: receipt is advisory (an unreceipted combination needs an explicit flag, never a refusal here).
    local: bool = False
    owner: str = "local"

    def __post_init__(self):
        if not self.local:
            if self.isolation_runtime not in {"runsc", "kata-runtime", "io.containerd.kata.v2"}:
                raise ValueError("A separately provisioned isolation runtime is required")
        elif self.isolation_runtime not in {"runsc", "runc"}:
            raise ValueError("The local runner isolates with runsc or runc")
        if not 1 <= self.max_workers <= 8 or self.job_ttl < 3600:
            raise ValueError("Invalid runner capacity")


#: Bytes one local job may write across its workspace and output host directories (enforced by the
#: executor's watchdog; recorded in the manifest's limits as storage_bytes).
LOCAL_STORAGE_BYTES = 2 * 1024 ** 3
