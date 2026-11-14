# Issue #31: dependency cycle silently ignored in larger graphs

`order({"app": ["lib", "util", "log"], "x": ["y"], "y": ["x"]})` returns
`['lib', 'util', 'log', 'app']` (modules `x` and `y` are just missing) instead of
raising `CycleError`. A plain two-module cycle such as `{"a": ["b"], "b": ["a"]}` is
reported correctly, so this seems to depend on what else is in the graph.
