# Issue #47: flag parsing treats "off " as true

A setting written as `off ` with a trailing space ends up enabled. This showed up
when reading feature switches from the environment. Please fix the flag parsing.
