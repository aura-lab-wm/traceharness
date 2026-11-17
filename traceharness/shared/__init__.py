"""The shared contracts of the console, the package and traceharness.dev, as code (SPEC section 4).

`contract` holds the constants and the capability table; `generate` writes the shared-sources
bundle the console and the site vendor; `versions` is the version stamp; `vocabulary` is the
retired-phrase check. Standard library only, and nothing here imports `traceharness.backend` at
module level.
"""
