# Collapsible Selector and Answer Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an auto-collapsing certificate selector, configurable immediate/deferred answer reveal, horizontal question gestures, and submitted answer-sheet review without changing the real question inventory.

**Architecture:** Persist the default reveal preference in schema v3 and snapshot the resolved reveal mode into every practice session. Keep one question page and isolate gesture classification in a pure presenter; the page coordinates selection, persistence, animation, and navigation while grading remains in `practice-session`. The result page, answer sheet, and submitted practice page reuse the same session instead of duplicating review data.

**Tech Stack:** WeChat Mini Program TypeScript/WXML/WXSS, Vitest, existing storage migration and service layers.

## Global Constraints

- Do not add, duplicate, concatenate, synthesize, or expand questions.
- Keep exactly the current 61 verified question records, stable question IDs, 84 stable catalog IDs, and occupation codes `4-02-06-01` / `4-08-05-01`.
- Random practice continues to use only real candidates and shows “全部 N 题” when fewer than 10 exist.
- Primary tabs remain exactly “首页、实操、我的”.
- Mock exams always use deferred reveal regardless of the saved preference.
- Existing active sessions, answers, wrong questions, favorites, and preferences must survive migration.
- Every behavior change follows RED → GREEN TDD with a real failing test first.
- WeChat DevTools, simulator, login, upload, and device status remain `NOT RUN` unless actually executed.

---

## File Structure

- `miniapp/miniprogram/types/domain.ts`: define `AnswerRevealMode`.
- `miniapp/miniprogram/storage/migrations.ts`: schema v2 → v3 migration and current persisted session/preferences.
- `miniapp/miniprogram/storage/progress-repository.ts`: store the new current data type.
- `miniapp/miniprogram/services/progress-service.ts`: expose and preserve reveal preference.
- `miniapp/miniprogram/services/practice-session.ts`: session-level reveal policy, feedback timing, serialization, and restoration.
- `miniapp/miniprogram/services/practice-runtime.ts`: resolve saved preference at session creation and force mock exams to deferred.
- `miniapp/miniprogram/presenters/certificate-selector-presenter.ts`: derive roles, levels, and collapsed summary.
- `miniapp/miniprogram/components/certificate-selector/*`: expanded/collapsed interaction and animation.
- `miniapp/miniprogram/presenters/practice-swipe-presenter.ts`: pure swipe classifier.
- `miniapp/miniprogram/pages/practice/*`: option behavior, swipe navigation, animation, and submitted read-only review.
- `miniapp/miniprogram/pages/learning-settings/*`: reveal-mode setting.
- `miniapp/miniprogram/pages/answer-sheet/index.ts`: active-session back navigation and submitted-session review navigation.
- `miniapp/miniprogram/pages/report/*`: “查看答题卡” entry.
- `miniapp/tests/*`: migration, preference, session, selector, swipe, page-structure, and review-flow coverage.

---

### Task 1: Persist answer reveal mode with schema v3

**Files:**
- Modify: `miniapp/miniprogram/types/domain.ts`
- Modify: `miniapp/miniprogram/storage/migrations.ts`
- Modify: `miniapp/miniprogram/storage/progress-repository.ts`
- Modify: `miniapp/miniprogram/services/progress-service.ts`
- Modify: `miniapp/tests/migrations.test.ts`
- Modify: `miniapp/tests/progress-service.test.ts`

**Interfaces:**
- Produces: `AnswerRevealMode = 'immediate' | 'deferred'`
- Produces: `ProgressDataV3`, current `ProgressPreferences.answerRevealMode`
- Produces: current `PersistedPracticeSession.answerRevealMode`
- Preserves: v1 and v2 persisted data through explicit migration

- [ ] **Step 1: Write failing schema and preference tests**

Add tests proving:

```ts
expect(createEmptyProgress().preferences.answerRevealMode).toBe('immediate');
expect(migrateProgress(versionTwo).data.preferences.answerRevealMode).toBe('immediate');
expect(migrateProgress(versionTwoMock).data.session?.answerRevealMode).toBe('deferred');
expect(migrateProgress(versionTwoSequential).data.session?.answerRevealMode).toBe('immediate');
```

Add a service test:

```ts
service.updatePreferences({ answerRevealMode: 'deferred' });
expect(service.getPreferences().answerRevealMode).toBe('deferred');
service.clearLearningData();
expect(service.getPreferences().answerRevealMode).toBe('deferred');
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
cd miniapp
npx vitest run tests/migrations.test.ts tests/progress-service.test.ts
```

Expected: failures because the property, v3 migration, and validation do not exist.

- [ ] **Step 3: Implement the v3 types and migration**

Add:

```ts
export type AnswerRevealMode = 'immediate' | 'deferred';
export const CURRENT_SCHEMA_VERSION = 3 as const;
```

Represent schema v2 separately from the current schema. Its preferences do not contain `answerRevealMode`, and its persisted session does not contain the field. Add a v2 → v3 migration:

```ts
const legacyRevealMode = (mode: PracticeMode): AnswerRevealMode =>
  mode === 'mock' ? 'deferred' : 'immediate';

export const migrateVersionTwo = (value: ProgressDataV2): ProgressDataV3 => ({
  ...value,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  session: value.session
    ? { ...value.session, answerRevealMode: legacyRevealMode(value.session.mode) }
    : null,
  preferences: { ...value.preferences, answerRevealMode: 'immediate' },
});
```

Make first-launch data and v1 migration finish as valid v3. Validate the new preference and persisted-session field. Update repository and service type imports to use the current data type.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same Vitest command. Expected: all migration and preference tests pass.

- [ ] **Step 5: Commit**

```powershell
git add miniapp/miniprogram/types/domain.ts miniapp/miniprogram/storage/migrations.ts miniapp/miniprogram/storage/progress-repository.ts miniapp/miniprogram/services/progress-service.ts miniapp/tests/migrations.test.ts miniapp/tests/progress-service.test.ts
git commit -m "feat: persist answer reveal preference"
```

---

### Task 2: Make feedback timing a session policy

**Files:**
- Modify: `miniapp/miniprogram/services/practice-session.ts`
- Modify: `miniapp/miniprogram/services/practice-runtime.ts`
- Modify: `miniapp/tests/practice-session.test.ts`
- Create: `miniapp/tests/practice-runtime.test.ts`

**Interfaces:**
- Consumes: `AnswerRevealMode`
- Produces: `PracticeSession.answerRevealMode`
- Produces: `CreateSessionOptions.answerRevealMode`
- Produces: `resolveAnswerRevealMode(mode, preference)`

- [ ] **Step 1: Write failing session-policy tests**

Cover these literal behaviors:

```ts
const deferred = createPracticeSession([question], {
  mode: 'sequential',
  answerRevealMode: 'deferred',
  now: 1000,
});
expect(answerQuestion(deferred, question.id, ['A'], 1200).feedback).toEqual({});

const immediate = createPracticeSession([question], {
  mode: 'sequential',
  answerRevealMode: 'immediate',
  now: 1000,
});
expect(answerQuestion(immediate, question.id, ['A'], 1200).feedback[question.id]?.correct).toBe(true);

expect(resolveAnswerRevealMode('mock', 'immediate')).toBe('deferred');
expect(resolveAnswerRevealMode('random', 'deferred')).toBe('deferred');
```

Also assert serialize/rehydrate preserves the policy and only reconstructs active feedback for immediate sessions.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
cd miniapp
npx vitest run tests/practice-session.test.ts tests/practice-runtime.test.ts
```

Expected: failures because reveal policy is still derived only from `mode`.

- [ ] **Step 3: Implement session-policy behavior**

Add the session field and resolve policy when creating a session:

```ts
export const resolveAnswerRevealMode = (
  mode: PracticeMode,
  preference: AnswerRevealMode,
): AnswerRevealMode => (mode === 'mock' ? 'deferred' : preference);
```

Use `session.answerRevealMode === 'immediate'` to decide whether `answerQuestion` stores feedback before submission. `submitSession` continues to grade every question. Serialize and restore the field. Runtime creation reads `appServices.progress.getPreferences().answerRevealMode`, while mock mode is forced to deferred.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same two test files. Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add miniapp/miniprogram/services/practice-session.ts miniapp/miniprogram/services/practice-runtime.ts miniapp/tests/practice-session.test.ts miniapp/tests/practice-runtime.test.ts
git commit -m "feat: lock feedback policy per practice"
```

---

### Task 3: Add the collapsible certificate selector

**Files:**
- Create: `miniapp/miniprogram/presenters/certificate-selector-presenter.ts`
- Modify: `miniapp/miniprogram/components/certificate-selector/index.ts`
- Modify: `miniapp/miniprogram/components/certificate-selector/index.wxml`
- Modify: `miniapp/miniprogram/components/certificate-selector/index.wxss`
- Create: `miniapp/tests/certificate-selector-presenter.test.ts`
- Modify: `miniapp/tests/project-structure.test.ts`

**Interfaces:**
- Produces: `presentCertificateSelector(certificates, selectedKey, activeOccupation)`
- Produces: `summaryText`, role options, and level options
- Component state: `collapsed: boolean`

- [ ] **Step 1: Write failing presenter and structure tests**

Assert a selected warehouse level 4 produces:

```ts
expect(view.summaryText).toBe('粮油仓储管理员 · 中级');
```

Assert the WXML contains a collapsed summary, “重新选择”, a tap handler that reopens it, and expanded role/level content. Assert only `onLevelTap` changes the component to collapsed state.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
cd miniapp
npx vitest run tests/certificate-selector-presenter.test.ts tests/project-structure.test.ts
```

Expected: presenter import or collapsed-markup assertions fail.

- [ ] **Step 3: Implement presentation and component state**

Move option derivation into the presenter. Initialize `collapsed` as false. Keep the selector expanded after `onRoleTap`. After a valid `onLevelTap`, update the selection, emit `change`, and set `collapsed: true`. Add `onExpand` to restore the full selector.

Render mutually exclusive expanded/collapsed views and animate with 200ms opacity/translate transitions. Do not persist collapse state in learning data.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same two test files. Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add miniapp/miniprogram/presenters/certificate-selector-presenter.ts miniapp/miniprogram/components/certificate-selector miniapp/tests/certificate-selector-presenter.test.ts miniapp/tests/project-structure.test.ts
git commit -m "feat: collapse selected certificate"
```

---

### Task 4: Add reveal-mode settings UI

**Files:**
- Modify: `miniapp/miniprogram/pages/learning-settings/index.ts`
- Modify: `miniapp/miniprogram/pages/learning-settings/index.wxml`
- Modify: `miniapp/miniprogram/pages/learning-settings/index.wxss`
- Modify: `miniapp/tests/project-structure.test.ts`
- Create: `miniapp/tests/learning-settings-presenter.test.ts`
- Create: `miniapp/miniprogram/presenters/learning-settings-presenter.ts`

**Interfaces:**
- Produces: `presentRevealModes(selected)`
- Consumes: `ProgressService.updatePreferences({ answerRevealMode })`

- [ ] **Step 1: Write failing presenter and page-contract tests**

Assert the presenter returns exactly:

```ts
[
  { value: 'immediate', title: '即时解析', selected: true },
  { value: 'deferred', title: '交卷后解析', selected: false },
]
```

Assert page markup includes “答案与解析”, both mode labels, and a `data-reveal-mode` tap target.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
cd miniapp
npx vitest run tests/learning-settings-presenter.test.ts tests/project-structure.test.ts
```

Expected: missing presenter and markup failures.

- [ ] **Step 3: Implement the settings card**

Read the saved mode in `onShow`, render two matte selection rows, and persist only valid values. Copy:

- 即时解析：`单选与判断选中即看解析，多选确认后看解析`
- 交卷后解析：`答题时不显示正误，交卷后统一查看`

When changed, show `解析方式已更新，下次练习生效`.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same two test files. Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add miniapp/miniprogram/pages/learning-settings miniapp/miniprogram/presenters/learning-settings-presenter.ts miniapp/tests/learning-settings-presenter.test.ts miniapp/tests/project-structure.test.ts
git commit -m "feat: configure answer reveal mode"
```

---

### Task 5: Add swipe navigation and mode-aware answer behavior

**Files:**
- Create: `miniapp/miniprogram/presenters/practice-swipe-presenter.ts`
- Modify: `miniapp/miniprogram/pages/practice/index.ts`
- Modify: `miniapp/miniprogram/pages/practice/index.wxml`
- Modify: `miniapp/miniprogram/pages/practice/index.wxss`
- Create: `miniapp/tests/practice-swipe-presenter.test.ts`
- Modify: `miniapp/tests/presenters.test.ts`
- Modify: `miniapp/tests/project-structure.test.ts`

**Interfaces:**
- Produces: `resolvePracticeSwipe(input): { direction: 'previous' | 'next' | 'none'; boundary: boolean }`
- Uses: threshold `48px`, horizontal dominance `absX >= absY * 1.25`
- Page methods: `onTouchStart`, `onTouchEnd`, `onPrevious`, `onNext`, `navigateRelative`

- [ ] **Step 1: Write failing swipe-classifier tests**

Cover:

```ts
expect(resolvePracticeSwipe({ deltaX: -80, deltaY: 10, currentIndex: 0, total: 3 }))
  .toEqual({ direction: 'next', boundary: false });
expect(resolvePracticeSwipe({ deltaX: 80, deltaY: 10, currentIndex: 0, total: 3 }))
  .toEqual({ direction: 'none', boundary: true });
expect(resolvePracticeSwipe({ deltaX: -40, deltaY: 0, currentIndex: 0, total: 3 }))
  .toEqual({ direction: 'none', boundary: false });
expect(resolvePracticeSwipe({ deltaX: -80, deltaY: 70, currentIndex: 0, total: 3 }))
  .toEqual({ direction: 'none', boundary: false });
```

Add structure assertions for touch handlers and both previous/next buttons.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
cd miniapp
npx vitest run tests/practice-swipe-presenter.test.ts tests/presenters.test.ts tests/project-structure.test.ts
```

Expected: missing presenter and page-contract failures.

- [ ] **Step 3: Implement pure swipe classification**

Do not reference `wx` in the presenter. Return `boundary: true` only for a valid horizontal gesture that points beyond the first or last question. Return `none` for vertical, short, or single-question gestures.

- [ ] **Step 4: Implement mode-aware selection on the practice page**

Rules:

- Submitted session: ignore option selection.
- Immediate single/judge/single-answer case: one tap calls `confirmQuestionAnswer`, saves, and reveals.
- Immediate multiple: keep draft until “确认答案”.
- Deferred: every tap calls `answerQuestion`, saves immediately, keeps options neutral, and allows later changes.
- `renderSession` reveals feedback when submitted, or when an immediate active session has feedback.

Replace the single footer action with previous and next/answer-sheet controls. A last active question opens `/pages/answer-sheet/index`; it does not submit directly.

- [ ] **Step 5: Implement gesture animation**

Listen on a `.practice-content` wrapper. Capture the first touch point, classify the final delta, lock navigation for 180ms, apply direction-specific classes, save session position, render, then call:

```ts
void wx.pageScrollTo({ scrollTop: 0, duration: 0 });
```

Boundary gestures use a short rebound class and do not change the index.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the same three test files plus `tests/practice-session.test.ts`. Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
git add miniapp/miniprogram/presenters/practice-swipe-presenter.ts miniapp/miniprogram/pages/practice miniapp/tests/practice-swipe-presenter.test.ts miniapp/tests/presenters.test.ts miniapp/tests/project-structure.test.ts
git commit -m "feat: swipe through practice questions"
```

---

### Task 6: Connect report, submitted answer sheet, and read-only review

**Files:**
- Modify: `miniapp/miniprogram/pages/report/index.ts`
- Modify: `miniapp/miniprogram/pages/report/index.wxml`
- Modify: `miniapp/miniprogram/pages/report/index.wxss`
- Modify: `miniapp/miniprogram/pages/answer-sheet/index.ts`
- Modify: `miniapp/tests/answer-sheet-page.test.ts`
- Modify: `miniapp/tests/project-structure.test.ts`

**Interfaces:**
- Report method: `onOpenAnswerSheet`
- Submitted answer-sheet selection: navigate to `/pages/practice/index?resume=1`
- Active answer-sheet selection: preserve existing `navigateBack`

- [ ] **Step 1: Write failing review-flow tests**

Assert:

- Result page contains “查看答题卡”.
- Submitted answer-sheet selection navigates to the practice page instead of navigating back.
- Active answer-sheet selection still navigates back.
- Submitted practice markup is read-only and still exposes previous/next navigation.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
cd miniapp
npx vitest run tests/answer-sheet-page.test.ts tests/project-structure.test.ts
```

Expected: missing report entry and submitted navigation failures.

- [ ] **Step 3: Implement the review flow**

Add the report action:

```ts
onOpenAnswerSheet() {
  void wx.navigateTo({ url: '/pages/answer-sheet/index' });
}
```

After the user selects a submitted answer-sheet cell, save the selected index and navigate to `/pages/practice/index?resume=1`. For an active session, keep `navigateBack()` so the user returns to their in-progress answer page. Preserve the existing wrong-only review entry as a secondary action.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the same two test files. Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add miniapp/miniprogram/pages/report miniapp/miniprogram/pages/answer-sheet/index.ts miniapp/tests/answer-sheet-page.test.ts miniapp/tests/project-structure.test.ts
git commit -m "feat: review submitted answers from sheet"
```

---

### Task 7: Full verification and inventory invariants

**Files:**
- Modify only if evidence requires correction: `docs/miniapp-acceptance-checklist.md`
- No question or catalog edits allowed

- [ ] **Step 1: Run full miniapp verification**

Run:

```powershell
cd miniapp
npm run verify
```

Expected: typecheck, ESLint, Stylelint, Prettier, package budget, and all Vitest files pass.

- [ ] **Step 2: Run Python validation**

Run from repository root:

```powershell
python -m pytest -q
```

Expected: all Python tests pass.

- [ ] **Step 3: Sync questions and prove zero inventory change**

Run:

```powershell
cd miniapp
npm run sync:questions
```

Verify no diff under:

```text
data/questions
data/knowledge_catalog.json
data/taxonomy.json
miniapp/miniprogram/data/knowledge-catalog.ts
miniapp/miniprogram/data/questions
```

Count and assert:

- 61 verified questions
- 61 unique question IDs
- 84 unique catalog IDs
- occupations exactly `4-02-06-01` and `4-08-05-01`

- [ ] **Step 4: Run fixed-range hygiene checks**

Run:

```powershell
git diff --check HEAD~7..HEAD
git status --short
```

Expected: no whitespace errors and a clean working tree after commits.

- [ ] **Step 5: Record manual acceptance boundary**

Keep DevTools build/compile, simulator, screenshot, iOS, Android, login, and upload as `NOT RUN` unless real evidence is produced. Do not substitute static tests for rendered gesture and animation checks.

---

## Plan Self-Review

- Every approved requirement maps to a task.
- No task adds or modifies question content.
- Schema types and session-policy names are consistent across tasks.
- Immediate/deferred behavior is explicit for single, judge, multiple, case, and mock modes.
- Gesture thresholds and boundary behavior use exact values.
- Submitted answer-sheet navigation uses the existing session rather than a duplicate review store.
- No placeholders or deferred implementation steps remain.

## Execution Choice

The user explicitly approved direct modification in the current session, so execute this plan with `superpowers:executing-plans` and checkpoint after Tasks 2, 4, and 6. Do not pause for another design or plan approval.
