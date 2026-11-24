# Contributing

Thanks for helping! This is a small, dependency-free project. Please keep
it that way: Python standard library on the server, plain JavaScript and
CSS in the browser, no build step.

## Never share real financial data

**Don't attach your Fidelity CSVs, `data.json`, screenshots with balances, or
account numbers** to issues or pull requests. Reproduce problems with the
built-in sample data (Welcome → *Try sample data*) or with a small, made-up
CSV. Privacy mode (Data → Settings → Hide dollar amounts) hides amounts in
screenshots.

## Running it

```sh
python3 server.py            # serves http://127.0.0.1:8765/
TP_DATA_DIR=/tmp/tp python3 server.py   # use a throwaway data folder
```

## Tests

Run these before opening a pull request. CI runs the same commands:

```sh
for t in tests/test-*.js; do node "$t" || exit 1; done
python3 tests/test_server.py
python3 tests/test_http.py
```

Tests use only made-up data (`tests/synthetic*.csv`, `sample/sample-data.json`).
If you change `tools/make-sample.js`, run `node tools/make-sample.js` and
commit the new `sample/sample-data.json`. A test checks that the two match.

## Pull requests

- Keep each change focused, and add a test for the behavior you changed.
- Calculation changes belong in `engine.js`, with a short note in
  `docs/METHODS.md` saying what changed and why.
- A new data source needs an entry in `DATA_SOURCES.md` with its terms.
- Add a line to `CHANGELOG.md` under *Unreleased*.
