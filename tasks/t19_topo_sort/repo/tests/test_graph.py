import unittest
from deps import order, CycleError


class TestOrder(unittest.TestCase):
    def test_simple_chain(self):
        self.assertEqual(order({"c": ["b"], "b": ["a"]}), ["a", "b", "c"])

    def test_two_node_cycle(self):
        with self.assertRaises(CycleError):
            order({"a": ["b"], "b": ["a"]})

    def test_cycle_next_to_a_wide_acyclic_part(self):
        graph = {"c": ["d"], "d": ["c"], "app": ["lib", "util", "log"]}
        with self.assertRaises(CycleError):
            order(graph)


if __name__ == "__main__":
    unittest.main()
