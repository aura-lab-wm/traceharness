"""Private, fail-closed execution service. Importing this package starts nothing."""

from .service import create_app

__all__ = ["create_app"]
