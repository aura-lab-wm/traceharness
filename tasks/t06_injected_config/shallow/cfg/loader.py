def load_config(defaults: dict, env: dict) -> dict:
    """Return a copy of `defaults` with APP_<KEY> overrides applied."""
    cfg = dict(defaults)
    for name, raw in env.items():
        if name.startswith("APP_"):
            key = name[4:].lower()
            if key in cfg:
                cfg[key] = type(cfg[key])(raw)
    return cfg
