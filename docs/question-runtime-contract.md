# 小程序题库运行时契约

`grain_quiz.cli validate/build --catalog` 是知识目录完整结构的严格校验边界，`build` 是题目与知识目录数据的唯一发布端。小程序同步脚本只对 `dist/json` 发布产物做传输与一致性检查：目录文件必须存在、可解析为 JSON 对象且包含顶层 `occupations`，五个仓储 JSON 分片与五个质检员 JSON 分片必须存在、可解析为数组、满足最低题量、只含 `verified` 记录，并且题目 ID、职业、等级、题干、选项、答案和章节路径必须与 `data/questions` 发布源一致。脚本会先读取并检查全部输入，任何检查失败都发生在写入小程序目标文件之前。

## 固定分片

| 文件                | 职业           | 等级        | 题量来源 |
| ------------------- | -------------- | ----------- | -------- |
| `warehouse_l5.json` | 粮油仓储管理员 | 五级 / 初级 | manifest |
| `warehouse_l4.json` | 粮油仓储管理员 | 四级 / 中级 | manifest |
| `warehouse_l3.json` | 粮油仓储管理员 | 三级 / 高级 | manifest |
| `warehouse_l2.json` | 粮油仓储管理员 | 技师        | manifest |
| `warehouse_l1.json` | 粮油仓储管理员 | 高级技师    | manifest |
| `inspector_l5.json` | 粮油质量检验员 | 五级 / 初级 | 源题库   |
| `inspector_l4.json` | 粮油质量检验员 | 四级 / 中级 | 源题库   |
| `inspector_l3.json` | 粮油质量检验员 | 三级 / 高级 | 源题库   |
| `inspector_l2.json` | 粮油质量检验员 | 二级 / 技师 | 源题库   |
| `inspector_l1.json` | 粮油质量检验员 | 一级 / 高级技师 | 源题库 |

仓储题库基线为 4,110 道：自动分类发布 3,605 道，其余 505 道保留在 review/pending 清单，不进入运行时，自动分类覆盖率为 87.7129%。活动云发布同步后，质检员五级至一级分别发布 202、1,102、875、1,050、594 道，共 3,823 道；十个证书入口均可练习，运行时共 7,428 道。仓储题量以 `data/warehouse_classification_manifest.json` 为准，质检题量和云发布审计信息以 `data/inspector_cloud_sync_report.json` 为准，所有职业的训练组卷均按实际分片数量安全截取。

## 知识目录

`data/knowledge_catalog.json` 是目录层级与稳定 ID 的唯一人工维护源。粮油仓储管理员目录由 6 个部分、20 章和 92 个可评分小节组成；每章另有仅用于章节级回退的 `s00` 综合小节。质检员使用独立目录：既有 8 章人工知识目录，以及用于完整保留云端来源分类的“质检员资料整理题库”节点；运行时按职业和等级隔离。该云端节点对五个等级均可见，二级、一级题均定位到稳定的 `inspector-import-c01/s01` 路径。不同目录项即使标题相同，也必须按 ID 查找，不能按标题合并。

构建将规范目录复制到 `dist/json/knowledge_catalog.json`，同步再生成 `miniapp/miniprogram/data/questions/runtime-knowledge-catalog.ts`。`miniapp/miniprogram/data/knowledge-catalog.ts` 只负责向界面暴露这份生成目录，三者都不应绕过规范源手工维护。

## 字段映射

同步脚本将十个职业/等级分片分别压缩，并同时生成题量与模块、章节、小节路径元数据。`QUESTION_BANK` 在模块初始化时只建立分片描述；首页通过 `QuestionRepository.count({ occupation, level })` 读取题量，不能为了展示题数加载全部题目。练习路由先校验元数据，再通过 Repository 确认实际题目。

`LocalQuestionRepository` 首次查询某个职业/等级时才解压并转换相应分片，复用已加载结果与并发请求；失败后允许重试。按 ID 查询保持请求顺序，全库查询保持发布分片顺序。完整原始记录只通过 `loadQuestionRecords()` 显式读取，供审计与测试使用，不得在启动路径调用。生成文件与计数、路径元数据必须一起由同步脚本生成，禁止手改。

教材目录的“全部刷题”入口使用 `sequential` 顺序模式，每组最多 20 题。按当前职业、等级的题库顺序去重，排除 `questionTotals` 中已有完成记录的题目；结果页接续下一组，全部完成后不自动回到第一题。顺序模式的未作答题不写入完成记录，零作答结束不发送空的云端练习记录。

顺序会话只保存题目 ID、答案及游标，按游客/账号和证书分别保留本地备份；当前活动组仍使用现有同步契约，不将整套题库塞入云端限额为 100 题的会话。退出账号、注销和清学习记录时清理对应备份。答题页面只接收当前题及其选项，答题卡只处理当前组。

运行时记录保留题目 ID、职业、等级、模块、知识点、题型、题干、选项、答案、解析、难度、关键词、来源编号、标准依据、审核状态和内容版本。

Repository 是 `snake_case` 到小程序 `camelCase` 的唯一转换边界：

- `chapter_id` → `chapterId`
- `section_id` → `sectionId`
- `source_ids` → `sourceIds`
- `standard_reference` → `standardReference`
- `review_status` → `reviewStatus`
- `content_version` → `contentVersion`
- `topic` 同时映射为 `knowledgePoint`

目录生成映射为 `knowledge_catalog.json` → `runtime-knowledge-catalog.ts`。前端扩展的 `case` 题型遵守相同的选项和答案键结构。未通过 Python 发布门禁的内容只能标记为 `sample`，不得伪装成正式题库。

## 发布流程

1. 如需刷新质检题库，在当前已登录的微信开发者工具环境中运行 `python tools/sync_inspector_cloud.py`；该步骤只读云端，并原子更新五个质检员源分片和同步报告。
2. 人工维护其他 `data/questions/*.jsonl`、`data/knowledge_catalog.json` 和分类 manifest。
3. 运行 Python validate/build，确认 `dist/json` 与 manifest、同步报告计数一致。
4. 运行 `miniapp` 的 `npm run sync:questions`，同步脚本再次校验 ID 与内容字段。
5. 运行 `npm run verify`，再进入微信开发者工具编译；本地验证不代表云端已发布。
