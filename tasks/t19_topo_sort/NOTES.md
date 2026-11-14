Bug: the cycle check compares len(result) with len(graph) (keys only) instead of all nodes, so leaf-only dependencies mask a cycle (visible test: wide acyclic part next to a cycle).
Reference: compare with len(deps).
Decoy: adds a DFS cycle check from the first key only; passes visible (first key is on the cycle), fails hidden where the cycle comes after the acyclic part.
Shallow: correct check but a plain list instead of a heap, newly unlocked nodes are not re-sorted; passes hidden, fails the strong brute force and tie test.
Weak-agent mistake: treating the symptom with a start-node DFS or a "result is empty" check; or forgetting self-dependencies.
