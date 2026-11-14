import copy
import random
import unittest
from deps import order, CycleError


def brute(graph):
    """Repeatedly take the smallest node whose dependencies are all placed."""
    nodes = set(graph)
    for needs in graph.values():
        nodes.update(needs)
    placed, out = set(), []
    while len(out) < len(nodes):
        ready = sorted(n for n in nodes - placed if set(graph.get(n, ())) <= placed)
        if not ready:
            return None
        placed.add(ready[0])
        out.append(ready[0])
    return out


class TestOrderStrong(unittest.TestCase):
    def test_random_against_brute(self):
        rng = random.Random(19)
        names = "abcdefgh"
        cycles = 0
        for _ in range(500):
            graph = {}
            for n in rng.sample(names, rng.randint(0, 6)):
                graph[n] = [rng.choice(names) for _ in range(rng.randint(0, 3))]
                if rng.random() < 0.8:
                    graph[n] = [d for d in graph[n] if d >= n or rng.random() < 0.1]
            expected = brute(graph)
            snapshot = copy.deepcopy(graph)
            if expected is None:
                cycles += 1
                with self.assertRaises(CycleError, msg=graph):
                    order(graph)
            else:
                self.assertEqual(order(graph), expected, graph)
            self.assertEqual(graph, snapshot)
        self.assertGreater(cycles, 20)

    def test_tie_break_after_unlocking(self):
        graph = {"c": ["root"], "b": ["root"], "a": ["root"], "z": []}
        self.assertEqual(order(graph), ["root", "a", "b", "c", "z"])

    def test_result_is_a_valid_permutation(self):
        graph = {"n%d" % i: ["n%d" % j for j in range(i) if (i * j) % 3 == 1] for i in range(30)}
        out = order(graph)
        self.assertEqual(sorted(out), sorted(graph))
        pos = {n: i for i, n in enumerate(out)}
        for n, needs in graph.items():
            for d in needs:
                self.assertLess(pos[d], pos[n])


if __name__ == "__main__":
    unittest.main()
