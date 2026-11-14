# Issue #19: values are cut short when they contain `=` or `#`

Given

    [server]
    url = http://localhost:8000/?debug=1
    color = #ff8800

`parse(text)["server"]["url"]` is `http://localhost:8000/?debug` and
`["color"]` is an empty string. Both values should come back exactly as written
(minus surrounding whitespace). Fix `inifile/parser.py`.
