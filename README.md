# Grain question bank

This project builds original study questions from public sources for grain
storage and inspection occupations. It is not a confidential question set or
an official national examination bank.

## Install

```powershell
python -m pip install -e ".[test]"
```

## Commands

```powershell
grain-quiz validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json
grain-quiz dedupe --questions data/questions --threshold 92
grain-quiz build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --output dist
python -m pytest -q
```

`export` accepts the same input and output arguments as `build`; both commands
first run the release validation gate. Any validation error prevents publishing.

Successful release output contains:

- `question-bank.xlsx` — review workbook
- `json/` — six verified-only runtime shards
- `version-report.json` — validation totals, record totals, source count, shard
  counts, and statistics

## Corrections

Correct the affected record or source metadata, then rerun `validate` and
`dedupe`. Build a new release only after validation reports zero errors; the
commands overwrite only their known release files and never recursively delete
the output directory.
