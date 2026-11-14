Bug: first_index returns as soon as sorted_list[mid] == target, so with duplicates it returns any matching index; count() then undercounts.
Reference: keep narrowing hi on equality (lower-bound search) and check sorted_list[lo] after the loop.
Decoy: on a match, looks only at the immediate left neighbour (returns mid-1); fine for runs of two, wrong for longer runs.
Shallow: sorted_list.index(target): correct on lists, but O(n); strong tier counts element reads on a Sequence of 15000 elements and bounds them below 60.
Weak-agent mistake: stopping at the neighbour check, or replacing the binary search with a linear scan.
