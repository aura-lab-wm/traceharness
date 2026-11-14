import copy
import random
import unittest
from pointer import resolve, split


def encode(key):
    return key.replace("~", "~0").replace("/", "~1")


ALPHABET = "ab~/01"


def rand_key(rng):
    return "".join(rng.choice(ALPHABET) for _ in range(rng.randint(0, 5)))


def rand_doc(rng, depth):
    if depth == 0 or rng.random() < 0.2:
        return rng.randint(0, 99)
    if rng.random() < 0.7:
        return {rand_key(rng): rand_doc(rng, depth - 1) for _ in range(rng.randint(1, 4))}
    return [rand_doc(rng, depth - 1) for _ in range(rng.randint(1, 4))]


def paths(node, prefix=()):
    yield prefix, node
    if isinstance(node, dict):
        for k, v in node.items():
            yield from paths(v, prefix + (k,))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from paths(v, prefix + (i,))


class TestResolveStrong(unittest.TestCase):
    def test_roundtrip_random(self):
        rng = random.Random(17)
        checked = 0
        for _ in range(300):
            doc = rand_doc(rng, 3)
            for path, value in paths(doc):
                pointer = "".join("/" + encode(str(p)) for p in path)
                self.assertEqual(resolve(doc, pointer), value, (doc, pointer))
                if path:
                    self.assertEqual(split(pointer), [str(p) for p in path])
                checked += 1
        self.assertGreater(checked, 1000)

    def test_document_not_mutated(self):
        doc = {"a~b": [1, {"c/d": 2}], "": {"~1": 3}}
        before = copy.deepcopy(doc)
        self.assertEqual(resolve(doc, "/a~0b/1/c~1d"), 2)
        self.assertEqual(resolve(doc, "//~01"), 3)
        self.assertEqual(doc, before)

    def test_split_edge_cases(self):
        self.assertEqual(split(""), [])
        self.assertEqual(split("/"), [""])
        self.assertEqual(split("//"), ["", ""])
        self.assertEqual(split("/~0~0"), ["~~"])
        self.assertEqual(split("/~1~1"), ["//"])
        self.assertEqual(split("/~001"), ["~01"])


if __name__ == "__main__":
    unittest.main()
