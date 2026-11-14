# Issue #19: wrap() leaves lines one character short

`wrap("aaa bbb", 7)` returns `["aaa", "bbb"]`, but "aaa bbb" is exactly 7 characters
and should stay on one line. In longer paragraphs every line comes out a little
narrower than the width we asked for, so our receipts print on twice as many lines
as they should. Overlong words are still split correctly. Code is in `wrapper/wrap.py`.
