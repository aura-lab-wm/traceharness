# Issue #208: version 1.10.0 sorts below 1.9.0

`compare("1.10.0", "1.9.0")` returns -1, so our release script thinks 1.9.0 is the
newer one and refuses to publish 1.10.0. The same happens with `2.0.0` vs `10.0.0`.
`compare("1.02.0", "1.2.0")` is also non-zero, although the leading zero is just formatting.
Everything with single-digit components looks fine. See `versions/compare.py`.
