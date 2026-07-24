# 粮安题库小程序

面向粮油仓储管理员、粮油质量检验员五级（初级）、四级（中级）、三级（高级）考证学习的微信刷题小程序。界面采用克制的苹果式视觉语言，答题、答题卡、结果分析、错题解析、收藏复习和实操技能形成完整学习闭环。

本项目是依据公开资料原创整理的学习题库，不是保密题库，也不代表官方国家考试题库。当前随工程发布 61 道已审核起步题，六个职业等级均可独立练习。

## 功能

- 首页：学习概览、连续学习、快捷练习、上次进度续答。
- 题库：六类证书，支持章节、顺序、随机和模拟考试。
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

`build` 会先执行发布门禁。只要存在校验错误，就不会发布运行时题库。成功后生成六个仅含 `verified` 题目的 JSON 分片、`knowledge_catalog.json` 和版本报告；默认构建只依赖 Python 与已声明的项目依赖，可在干净环境执行。

需要人工审核工作簿时，可在已配置 Node.js 与 `@oai/artifact-tool` 运行时的环境中显式增加 `--review-workbook`：

```powershell
$env:PYTHONPATH=(Resolve-Path 'src').Path
python -m grain_quiz.cli build --questions data/questions --sources data/sources.json --taxonomy data/taxonomy.json --catalog data/knowledge_catalog.json --output dist --review-workbook
```

该选项额外生成 `dist/question-bank.xlsx`，不会改变 JSON 运行时分片。

## 知识目录与运行时映射

`data/knowledge_catalog.json` 是稳定目录 ID、教材层级和页码的唯一人工维护源。仓储目录按等级拆成 4 个部分、11 章、44 节；粮油质检员使用独立的 1 个部分、8 章、16 节目录，不复用仓储章节。

Python 发布记录到小程序运行时的关键映射为：

- `chapter_id` → `chapterId`
- `section_id` → `sectionId`
- `knowledge_catalog.json` → `runtime-knowledge-catalog.ts`

完整目录结构的合法性由 `grain_quiz.cli validate/build --catalog` 保证。`npm run sync:questions` 只对 `dist/json` 发布产物执行传输边界检查：目录文件必须存在、可解析为 JSON 对象且包含顶层 `occupations`，六个固定分片必须存在、可解析为数组、每片不少于 8 题且只含 `verified` 记录；脚本会先检查所有输入，失败时不会写入小程序目标文件。检查通过后才生成小程序 JSON 分片、聚合题目模块与目录模块；`npm run verify` 随后执行类型检查、代码检查、格式检查和全部 Vitest 测试。

## 在微信开发者工具中运行

1. 登录微信开发者工具，导入 `miniapp/` 目录。
2. 本地预览可保留 `touristappid`；上传前在项目设置中换成自己有权限的 AppID。
3. 首次导入后选择“工具 → 构建 npm”，确认生成 `miniprogram_npm`。
4. 点击“编译”，按 [小程序验收清单](docs/miniapp-acceptance-checklist.md) 走完核心路径。

小程序使用本地 JSON 和微信本地存储即可运行，不依赖云开发或后端服务。

## 维护约定

题目修订应修改 `data/questions/*.jsonl` 或来源元数据，再完整执行验证、查重、构建和同步。不要直接编辑 `miniapp/miniprogram/data/questions/*.json`，它们是发布产物。详细约束见 [题库运行时契约](docs/question-runtime-contract.md) 与 [小程序代码规范](docs/miniapp-code-standards.md)。
