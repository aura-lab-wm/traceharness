Bug: `_decode` replaces "~0" before "~1", so the key "~1" (pointer "/~01") decodes to "/" and the lookup raises KeyError.
Reference: swap the two replaces ("~1" first, then "~0").
Decoy: decodes only "~1" and drops "~0" altogether; visible tests pass, "/m~0n" and "/~01" fail.
Strong adds: seeded round-trip over random docs with keys from the alphabet "ab~/01" (encode, resolve, compare), non-mutation, split edge cases ("/~001").
Weak-agent mistake: special-casing "~01" or removing "~0" support instead of fixing the order; visible tests give no signal (blind), so it must reason from the docstring.
