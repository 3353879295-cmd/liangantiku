# 保管员五等级题库导入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将新保管员资料整理为 L5/L4/L3/L2/L1 五个等级的正式题库并接入小程序。

**Architecture:** 扩展现有 Python 题库模型、分类目录和发布器，使等级 1-5 都可验证和分片；新增一次性来源抽取/规范化脚本，将 DOCX/PDF 转为 JSONL；运行时只同步保管员五档，暂不发布质检员。

**Tech Stack:** Python 3、Pydantic、python-docx、pypdf、TypeScript、Vitest。

---

### Task 1: 扩展五等级模型和发布分片

**Files:**
- Modify: `src/grain_quiz/models.py`
- Modify: `src/grain_quiz/catalog.py`
- Modify: `src/grain_quiz/export.py`
- Modify: `src/grain_quiz/validate.py`
- Modify: `miniapp/scripts/sync-question-bank.mjs`
- Modify: `miniapp/miniprogram/types/domain.ts`
- Modify: `miniapp/miniprogram/data/certificates.ts`
- Test: `tests/test_models.py`, `tests/test_catalog.py`, `tests/test_export.py`, `miniapp/tests/sync-question-bank.test.ts`

- [ ] 写失败测试：允许 L1/L2、生成五个 warehouse 分片、拒绝错误等级分片。
- [ ] 运行聚焦测试确认因当前 `Literal[5,4,3]` 和固定六分片失败。
- [ ] 将题目 ID 正则扩展为 `WH|QI` + `L[1-5]`，模型等级扩展为 1-5；目录等级允许 1-5。
- [ ] 将发布器改为按活动职业和 1-5 等级生成 `warehouse_l5.json` 至 `warehouse_l1.json`，不再把 inspector 作为本轮必需分片。
- [ ] 前端类型和证书列表改为保管员五档可用；暂时隐藏质检员证书。
- [ ] 运行 Python 与 Vitest 聚焦测试确认通过。

### Task 2: 抽取并规范化新资料

**Files:**
- Create: `tools/import_warehouse_sources.py`
- Create: `tools/warehouse_source_rules.json`
- Create: `tests/test_warehouse_import.py`
- Modify: `data/questions/*.jsonl`, `data/sources.json`

- [ ] 写失败测试覆盖 DOCX 段落中的单选、多选、判断题、答案和解析抽取，以及文件名到等级映射。
- [ ] 实现只读抽取器：按文件签名读取 OOXML，即使扩展名为 `.doc`；PDF 使用 `pypdf`，无法解析的 PDF 记录警告并跳过。
- [ ] 规范化全角标点、选项键、答案键和题型；多选答案支持连续字母；判断题映射为 A=正确/B=错误。
- [ ] 按资料文件名映射五个等级，生成稳定的 `WH-Lx-NNNNNN` ID；按关键词映射模块/主题，无法确定时使用该等级的“综合理论”路径并记录来源文件。
- [ ] 对重复题按规范化题干+选项去重；相同题干不同等级保留并设置不同等级 ID。
- [ ] 将不能可靠识别答案、选项或来源的题目写入 `tmp/warehouse-import-review.jsonl`，不写入正式 verified 分片。
- [ ] 运行导入测试，检查五个等级都有记录且答案键合法。

### Task 3: 重建目录、来源和正式 JSONL

**Files:**
- Modify: `data/taxonomy.json`
- Modify: `data/knowledge_catalog.json`
- Modify: `data/sources.json`
- Modify: `data/questions/warehouse_l1.jsonl` through `warehouse_l5.jsonl`
- Remove from active release: `data/questions/inspector_l1-l5` if present

- [ ] 为保管员五个等级建立稳定的模块、章节和小节路径，确保每条题目都能通过 taxonomy/catalog 校验。
- [ ] 为新资料建立来源目录记录，来源使用 `public_sample` 或 `school_material` 时保持 `sample/pending`，只有可核验公开依据才标记 `verified`。
- [ ] 导入后运行 `grain_quiz validate`，修复所有错误；近重复仅保留可解释警告。
- [ ] 运行 `grain_quiz build`，核对五个分片计数和版本报告。

### Task 4: 同步运行时并验证小程序

**Files:**
- Modify: `miniapp/miniprogram/data/questions/*`
- Modify: `miniapp/miniprogram/data/questions/runtime-knowledge-catalog.ts`
- Modify: `miniapp/miniprogram/data/questions/runtime-question-records.ts`
- Modify: `miniapp/tests/catalog.test.ts`, `miniapp/tests/certificate-selector-presenter.test.ts`

- [ ] 写失败测试：五个等级可选择，质检员不可选择，按等级筛选只返回对应题目。
- [ ] 运行失败测试确认旧选择器和固定分片行为不符合新规则。
- [ ] 执行 `npm run sync:questions` 生成运行时数据。
- [ ] 执行 `npm run verify`、`npm run typecheck`、`npm run lint` 和全部 Vitest。
- [ ] 检查运行时记录总数、等级分布、题目 ID 前缀和随机抽样题干/答案/解析。

### Task 5: 最终审计

- [ ] 运行完整 Python 测试和发布流水线。
- [ ] 对五个等级各抽样 10 题，核对题干、选项、答案、解析、等级和来源文件。
- [ ] 检查 `git diff` 只包含本次题库导入、等级扩展和必要测试/文档，不覆盖用户已有未提交文件。
- [ ] 记录导入统计、跳过待审数量和剩余警告。
