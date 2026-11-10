"""Operator-started private control service; never the member /app process."""
import uvicorn


def main():
    uvicorn.run("harnesslab.runner_service:create_app", factory=True,
                host="127.0.0.1", port=8743, access_log=False, limit_concurrency=32, timeout_keep_alive=5)


if __name__ == "__main__":
    main()
