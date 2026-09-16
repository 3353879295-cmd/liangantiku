# 粮安题库小程序

## 当前验收版本

2026-09-15 已跑通个人主体虚拟支付：**28 元 / 六个自然月会员，不自动续费**。真实 Apple IAP 付款、会员到账、平台已发货及重复通知不重复延长权益均已核验。最新部署、测试结果和部署前检查清单见 [支付验收报告](docs/qa/2026-09-15-person-payment-acceptance.md)；更早的排障记录仅保留历史过程。

微信开发者工具继续使用 `D:\文档\保管员刷题小程序\.worktrees\warehouse-question-classification\miniapp`。本地支付原始记录、部署 ZIP、临时文件及密钥不进入 Git。正式发布后的账单核对仍按验收报告执行。

面向粮油仓储管理员、粮油质量检验员五级（初级）至一级（高级技师）考证学习的微信刷题小程序。界面采用克制的苹果式视觉语言，答题、答题卡、结果分析、错题解析、收藏复习和实操技能形成完整学习闭环。

本项目是依据公开资料原创整理的学习题库，不是保密题库，也不代表官方国家考试题库。本次五等级仓储管理员基线共 4,110 题，其中 3,605 题已发布并通过验证，505 题进入人工 review，自动分类覆盖率为 87.7129%。质检员五个等级由活动云题库单向同步后分别发布 202、1,102、875、1,050、594 题，共 3,823 题。当前运行时共 7,428 题，pending 题不会同步到小程序运行时。

## 功能

- 首页：学习概览、连续学习、快捷练习、上次进度续答。
- 题库：两个职业、十个等级选项均已开放，支持章节、顺序、随机和模拟考试。
- 答题：单选、多选、判断和案例题运行时；普通练习即时解析，模拟考试交卷后统一解析。
- 答题卡与结果：定位未答题，展示分数、正确率、用时和薄弱模块。
- 错题与收藏：错题次数、掌握标记、筛选复习和专项重练。
- 实操：12 张操作技能卡，包含步骤、安全提醒、常见错误和公开依据。
- 我的：目标证书、每日目标、学习统计、最近活动和本地数据管理。

## 目录

- `data/`：题目、来源、分类与 `knowledge_catalog.json` 知识目录的人工维护源数据。
- `src/grain_quiz/`：验证、查重和发布工具。
- `dist/`：本地构建产物，不提交版本库。
- `miniapp/`：原生微信小程序工程；组件库使用 TDesign MiniProgram 1.15.3。
- `docs/`：数据契约、代码规范、设计说明和验收清单。

## 从源数据构建

安装开发依赖后，在仓库根目录执行完整发布与验证。显式设置 `PYTHONPATH` 可确保命令使用当前 worktree 的 `src/`，而不是其他检出目录中已安装的旧版本：

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m pytest -q
python -m grain_quiz.cli validate --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json
python -m grain_quiz.cli build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json --output dist
Set-Location miniapp
npm run sync:questions
npm run verify
```

质检员题库需要刷新时，先在已登录且指向既定环境的微信开发者工具中执行只读同步，再运行上述构建流程：

```powershell
python tools/sync_inspector_cloud.py
```

该工具把活动发布中的 `question_bank_questions` 单向合并到五个质检员 JSONL 分片，只调用云数据库只读接口；同 ID 内容冲突保留本地记录并写入 `data/inspector_cloud_sync_report.json`。工具固定校验 AppID `wx84ecacec08ca162c` 和环境 `cloud1-d2gglad830c91db10`，不会切换环境或修改云端。

`build` 会先执行发布门禁。只要存在校验错误，就不会发布运行时题库。成功后生成十个仅含 `verified` 题目的 JSON 分片、`knowledge_catalog.json` 和版本报告；默认构建只依赖 Python 与已声明的项目依赖，可在干净环境执行。

需要人工审核工作簿时，可在已配置 Node.js 与 `@oai/artifact-tool` 运行时的环境中显式增加 `--review-workbook`：

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m grain_quiz.cli build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json --output dist --review-workbook
```

该选项额外生成 `dist/question-bank.xlsx`，不会改变 JSON 运行时分片。

## 知识目录与运行时映射

`data/knowledge_catalog.json` 是稳定目录 ID、教材层级和页码的唯一人工维护源。仓储目录按五个等级和共享基础目录拆成 6 个部分、20 章、92 节；粮油质检员使用独立目录，不复用仓储章节。

Python 发布记录到小程序运行时的关键映射为：

- `chapter_id` → `chapterId`
- `section_id` → `sectionId`
- `knowledge_catalog.json` → `runtime-knowledge-catalog.ts`

完整目录结构的合法性由 `grain_quiz.cli validate/build --catalog` 保证。`npm run sync:questions` 只对 `dist/json` 发布产物执行传输边界检查：目录文件必须存在、可解析为 JSON 对象且包含顶层 `occupations`，五个仓储分片与五个质检员分片必须存在、可解析为数组、每片不少于 8 题且只含 `verified` 记录；脚本会先检查所有输入，失败时不会写入小程序目标文件。检查通过后才生成聚合题目模块与目录模块；`npm run verify` 随后执行类型检查、代码检查、格式检查和全部 Vitest 测试。

## 在微信开发者工具中运行

1. 登录微信开发者工具，导入 `miniapp/` 目录。
2. 本地预览可保留 `touristappid`；上传前在项目设置中换成自己有权限的 AppID。
3. 首次导入后选择“工具 → 构建 npm”，确认生成 `miniprogram_npm`。
4. 点击“编译”，按 [小程序验收清单](docs/miniapp-acceptance-checklist.md) 走完核心路径。

小程序题目使用构建生成的本地题库；账号进度同步及会员支付通过各自的云函数处理。云题库同时作为构建前的只读上游数据源。

## 维护约定

人工题目修订应修改 `data/questions/*.jsonl` 或来源元数据；云端质检题应通过只读同步工具刷新。随后完整执行验证、查重、构建和小程序同步。不要直接编辑 `miniapp/miniprogram/data/questions/runtime-*.ts`，它们是发布产物。详细约束见 [题库运行时契约](docs/question-runtime-contract.md) 与 [小程序代码规范](docs/miniapp-code-standards.md)。
