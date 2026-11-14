# Issue #112: pointers to keys containing "~" or "/" do not resolve

Given `doc = {"~1": "tilde-one", "a/b": "slash"}`, `resolve(doc, "/~01")` raises `KeyError`,
although `"~01"` is the RFC 6901 encoding of the key `"~1"`. Keys that contain a slash
(`"/a~1b"`) are also affected in some combinations. Plain keys and list indexes work fine.
