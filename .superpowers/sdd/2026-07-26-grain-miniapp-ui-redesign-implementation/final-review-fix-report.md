# Final review fix report

Review input: `final-review-findings.md`
Base HEAD: `654d7ef42953a9edc794545eb253d9d85c15fe3a`
Required diff-check baseline: `8325c9247e007e4c0014e3cbca8247dcd7de8cf9`

## Scope and constraints

- One concentrated correction wave for 1 Critical, 4 Important, and 3 Minor findings.
- No new, duplicated, concatenated, or generated questions.
- No changes to existing question IDs, catalog IDs, occupation codes, or question inventory.
- Existing visual content and composition are retained; image work is limited to local release optimization.
- WeChat DevTools GUI, simulator, device testing, login, upload, and release remain `NOT RUN`.

## Root-cause investigation

### Critical: main-package size

- Baseline command: recursive file measurement of `miniapp/miniprogram`, plus an
  actual `Compress-Archive` of that directory.
- Baseline result: 1,316 files, 3,686,910 raw bytes, 2,600,772 ZIP bytes.
- `assets/practical/rice-ear-hero.png` alone is 1,714,664 bytes at 1536×864;
  all other files total 1,972,246 bytes.
- Root cause: the full-resolution lossless hero is shipped in the main package,
  while all 16 pages are main-package pages. `project.config.json` also has no
  upload filter and keeps source-map upload enabled. The image is the dominant
  single cause; a real file-budget check is absent.
- Hypothesis: card-sized local WebP re-encoding, without changing the image's
  composition, will put the actual raw main-package tree below the 2 MiB limit.

### Important: practice fallback navigation

- `pages/practice/index.json` registers `app-topbar`.
- `pages/practice/index.wxml` does not render `<app-topbar>`.
- The shared component already implements stack-aware back navigation and
  fallback-tab navigation, so the missing render is the broken boundary.

### Important: practical-guide source status

- Four guides include `SRC-0004` in `sourceIds`.
- The source catalog marks `SRC-0004` as `is_active: false` and
  `usage: bibliography_only`.
- Those guides display the source title in a generic “参考依据” card beside
  active sources, with no historical/inactive distinction.
- Root cause: practical-guide data has only one undifferentiated source list and
  no build-time gate against the authoritative source catalog.
- Honest downgrade: keep `SRC-0004` auditable only as an explicitly historical
  reference, remove it from current supporting sources, and do not invent a
  replacement standard.

### Important: verified question release gate

- `_validate_verified_question` rejects missing and inactive sources but never
  checks `Source.usage`.
- Therefore an active `bibliography_only` or `public_sample` record can pass as
  the sole source for a verified question.
- Hypothesis: require every source of a verified question to be both active and
  `knowledge_basis`; current 64 published records should remain unchanged.

### Important: future-schema recovery

- `migrateProgress` throws immediately when `schemaVersion` is greater than 2.
- `ProgressRepository.load` only creates the timestamped recovery backup after
  `migrateProgress` returns a recovered result, so the throw bypasses the
  existing backup/recovery pattern.
- `ProgressService` loads in its constructor, and `app-services.ts` constructs it
  during module evaluation, so this exception can abort startup.
- Hypothesis: return an explicit recovered result for a future schema; the
  repository can then preserve the untouched value in its existing auditable
  backup record, install safe empty current data, and expose the existing
  one-time recovery-notice path without crashing.

### Minor: chapter-number ordering

- `profile-presenter.ts` uses `numberText.localeCompare` as its final tie-break.
- Equal-metric chapters numbered `10` and `2` therefore sort lexicographically.
- Hypothesis: compare validated numeric values first and retain text fallback for
  non-numeric labels.

### Minor: semantic icon mapping

- The current test only proves each icon is one of five PNGs and exists.
- Swapping a semantically wrong but allowed icon between guide IDs would pass.
- Hypothesis: an explicit, hand-derived ID-to-icon expectation will catch that
  regression without adding or changing guide inventory.

### Minor: fixed-range whitespace verification

- Fresh command:
  `git diff --check 8325c9247e007e4c0014e3cbca8247dcd7de8cf9..HEAD`
- Result: failed on 17 pre-existing trailing-space lines in one historical plan
  and the UI redesign spec.
- Root cause: the prior acceptance used an unfixed working-tree range and did
  not validate the required baseline-to-HEAD history.

## RED / GREEN log

### RED

Command:

```text
cd miniapp
npx vitest run tests/main-package-budget.test.ts tests/project-structure.test.ts tests/practical-skills.test.ts tests/migrations.test.ts tests/progress-service.test.ts tests/profile-presenter.test.ts
```

Result: expected failure, 6 failed and 51 passed.

- Package budget measured 3,686,910 bytes > 2,097,152 bytes.
- Practice markup lacked `<app-topbar>`.
- `SRC-0004` was observed as inactive + bibliography-only in a current source list.
- Future schema version 3 threw from `migrateProgress`, both directly and through
  `ProgressService` construction.
- Equal-metric chapter order was `10, 2` instead of `2, 10`.
- The explicit ID-to-icon mapping test passed, proving the current mapping is
  semantically correct while closing the previous regression gap.

Command:

```text
python -m pytest tests/test_validate.py -q
```

Result: expected failure, 2 failed and 15 passed. Active sources with
`bibliography_only` and `public_sample` usage produced no release error.

### GREEN

Implementation-level commands:

```text
cd miniapp
npx vitest run tests/migrations.test.ts tests/progress-service.test.ts
# 2 files passed, 21 tests passed

npx vitest run tests/project-structure.test.ts
# 1 file passed, 25 tests passed

npx vitest run tests/profile-presenter.test.ts
# 1 file passed, 4 tests passed

npx vitest run tests/practical-skills.test.ts tests/project-structure.test.ts
# 2 files passed, 31 tests passed

npm run check:package
# 1 file passed, 1 test passed

cd ..
python -m pytest tests/test_validate.py -q
# 17 passed
```

Consolidated focused command:

```text
cd miniapp
npx vitest run tests/main-package-budget.test.ts tests/project-structure.test.ts tests/practical-skills.test.ts tests/migrations.test.ts tests/progress-service.test.ts tests/profile-presenter.test.ts
```

Result: 6 files passed, 57 tests passed.

The final focused and full-suite results are repeated under Verification after
all refactoring and report edits.

## Files changed

- Package/image: `miniapp/package.json`, `miniapp/project.config.json`,
  `miniapp/miniprogram/assets/README.md`, and replacement of
  `rice-ear-hero.png` with the locally re-encoded `rice-ear-hero.webp`.
- Navigation: `miniapp/miniprogram/pages/practice/index.wxml`.
- Practical provenance: `miniapp/miniprogram/data/practical-skills.ts` and the
  practical-detail page `.ts/.wxml/.wxss`.
- Storage recovery: `miniapp/miniprogram/storage/migrations.ts`.
- Sorting: `miniapp/miniprogram/presenters/profile-presenter.ts`.
- Release validation: `src/grain_quiz/validate.py`.
- Regression coverage: the six affected miniapp test files, new
  `miniapp/tests/main-package-budget.test.ts`, and `tests/test_validate.py`.
- Historical whitespace only: the 2026-07-22 implementation plan and the
  2026-07-26 redesign spec.
- This report.

## Package measurements

All measurements read real files. ZIP values come from fresh
`Compress-Archive` output; they are not DevTools upload results.

| Measurement | Before | After |
| --- | ---: | ---: |
| Hero format and dimensions | PNG, 1536×864 | WebP, 1024×576 |
| Hero bytes | 1,714,664 | 50,574 |
| Physical `miniprogram` raw bytes | 3,686,910 | 2,024,971 |
| Physical `miniprogram` ZIP bytes | 2,600,772 | 936,636 |
| Physical raw headroom under 2 MiB | −1,589,758 | 72,181 |

`project.config.json` now disables source-map upload and excludes the 76,826-byte
TDesign `.wechatide.ib.json` editor metadata. Applying only that configured
filter gives 1,948,145 raw bytes and 919,072 ZIP bytes, with 149,007 raw bytes of
headroom.

The executable `npm run check:package` walks and sums the actual physical
`miniprogram` tree and enforces 2,097,152 bytes. It intentionally counts even the
configured ignored metadata, so the automated gate is stricter than the upload
filter.

## Question-bank invariants

Command:

```text
cd miniapp
npm run sync:questions
```

Sync output stayed at:

- `warehouse_l5.json`: 20
- `warehouse_l4.json`: 8
- `warehouse_l3.json`: 9
- `inspector_l5.json`: 8
- `inspector_l4.json`: 8
- `inspector_l3.json`: 8

Evidence:

- SHA-256 comparison covered 17 tracked source/catalog/runtime files before and
  after sync: `ChangedAfterSync: 0`.
- `git diff --exit-code 654d7ef42953a9edc794545eb253d9d85c15fe3a
  -- data/questions data/knowledge_catalog.json data/taxonomy.json
  miniapp/miniprogram/data/questions` exited 0.
- Current source inventory remains 61 verified questions with 61 unique question
  IDs.
- Occupation-code set remains exactly `4-02-06-01` and `4-08-05-01`.
- The knowledge catalog remains 84 IDs with 84 unique IDs.
- No question, question ID, catalog ID, occupation code, or question inventory
  was added, removed, or edited by this correction wave.
- With `PYTHONPATH=src`, the real
  `python -m grain_quiz.cli validate --questions data/questions --sources
  data/sources.json --taxonomy data/taxonomy.json --catalog
  data/knowledge_catalog.json` release command exited 0 under the strengthened
  source-usage gate.

## Verification

Focused:

- Miniapp affected tests: 6 files, 57 tests passed.
- Python release-gate tests: 17 passed.

Full automation:

```text
cd miniapp
npm run verify
```

Result: TypeScript, ESLint, Stylelint, Prettier, actual package budget, and all
22 Vitest files passed; 176 tests passed.

```text
cd ..
python -m pytest -q
```

Result: 60 tests passed.

Post-commit evidence:

```text
git diff --check 8325c9247e007e4c0014e3cbca8247dcd7de8cf9..HEAD
# exit 0

git status --short
# 0 entries
```

Staged-diff self-review also confirmed:

- `git diff --cached --check` exited 0.
- The staged question/catalog path count was 0.
- Image replacement was the only binary change.
- Production changes were limited to the eight reviewed findings and their
  release/test evidence.

## Residual risks

- WeChat DevTools compile/build, simulator, screenshot, iOS, Android, login,
  upload, and release are all `NOT RUN` as required.
- The local physical-tree and ZIP measurements are reproducible release-budget
  evidence, but they are not an official DevTools compiled/upload package
  measurement. The stricter physical-tree gate currently has 72,181 bytes of
  headroom; the configured filtered tree has 149,007 bytes.
- The WebP was visually inspected after re-encoding and retains the original
  subject and 16:9 composition. Device/DevTools rendering remains unverified.
- No replacement regulation was invented. `SRC-0004` is retained only as an
  explicit inactive historical reference; `SRC-0003` is retained only as a
  bibliography locator that cannot support steps, parameters, or limits.
