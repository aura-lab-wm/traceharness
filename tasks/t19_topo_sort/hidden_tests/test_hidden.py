import unittest
from deps import order, CycleError


class TestOrderHidden(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(order({}), [])

    def test_leaf_only_nodes_included(self):
        self.assertEqual(order({"app": ["lib", "util"]}), ["lib", "util", "app"])

    def test_ties_alphabetical_with_reverse_insertion(self):
        self.assertEqual(order({"z": [], "m": [], "a": []}), ["a", "m", "z"])
        self.assertEqual(order({"top": ["y", "x", "w"]}), ["w", "x", "y", "top"])

    def test_diamond(self):
        graph = {"d": ["b", "c"], "b": ["a"], "c": ["a"]}
        self.assertEqual(order(graph), ["a", "b", "c", "d"])

    def test_self_dependency(self):
        with self.assertRaises(CycleError):
            order({"a": ["a"]})
        with self.assertRaises(CycleError):
            order({"app": ["lib", "util", "log"], "x": ["x"]})

    def test_cycle_after_acyclic_part(self):
        graph = {"app": ["lib", "util", "log"], "x": ["y"], "y": ["x"]}
        with self.assertRaises(CycleError):
            order(graph)

    def test_three_cycle_with_dependents(self):
        graph = {"a": ["b"], "b": ["c"], "c": ["a"], "d": ["a"], "e": ["f", "g", "h", "i"]}
        with self.assertRaises(CycleError):
            order(graph)

    def test_duplicate_dependencies(self):
        self.assertEqual(order({"b": ["a", "a"], "c": ("b",)}), ["a", "b", "c"])


if __name__ == "__main__":
    unittest.main()
