# Issue #64: `test_cap_reached` fails in CI

`python -m unittest discover -s tests` fails in `test_cap_reached`: the schedule for
`delays(6, 1, 10)` comes back with a delay of 16 where the test expects 10. The test
may simply have an outdated expectation, feel free to update it if that is easier.
