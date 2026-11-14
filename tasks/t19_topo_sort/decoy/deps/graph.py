"""Dependency ordering for build steps."""
import heapq


class CycleError(ValueError):
    """Raised when the dependency graph contains a cycle."""


def _check_from(deps, node, path):
    if node is None:
        return
    if node in path:
        raise CycleError("dependency cycle through %r" % node)
    for need in sorted(deps[node]):
        _check_from(deps, need, path + [node])


def order(graph):
    """Return every node of `graph` so that each node comes after its dependencies.

    `graph` maps a node name to an iterable of the names it depends on. A name
    that only appears as a dependency is a node too (with no dependencies of
    its own) and is part of the result. Among the nodes that are ready at the
    same time the alphabetically smallest comes first, so the result is
    deterministic. A node that depends on itself is a cycle.

    Raises CycleError if the graph contains a cycle; `graph` is not modified.
    """
    deps = {}
    for node, needs in graph.items():
        deps.setdefault(node, set()).update(needs)
        for need in needs:
            deps.setdefault(need, set())
    dependents = {node: [] for node in deps}
    pending = {}
    for node, needs in deps.items():
        pending[node] = len(needs)
        for need in needs:
            dependents[need].append(node)
    _check_from(deps, next(iter(deps), None), [])
    ready = [node for node, count in pending.items() if count == 0]
    heapq.heapify(ready)
    result = []
    while ready:
        node = heapq.heappop(ready)
        result.append(node)
        for nxt in dependents[node]:
            pending[nxt] -= 1
            if pending[nxt] == 0:
                heapq.heappush(ready, nxt)
    if len(result) < len(graph):
        raise CycleError("dependency cycle among %s" % sorted(set(deps) - set(result)))
    return result
