"""Private execution service; provider workers do not import the ASGI server."""

__all__ = ["create_app"]


def __getattr__(name):
    if name == "create_app":
        # Spawned, deadline-bound provider workers import this package too. Keep
        # the controller and its route dependencies outside that transport path.
        from .service import create_app
        return create_app
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
