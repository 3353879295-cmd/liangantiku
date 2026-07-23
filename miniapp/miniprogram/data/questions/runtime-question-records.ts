import type { RuntimeQuestionRecord } from '../../types/runtime-question';

export const RUNTIME_QUESTION_RECORDS: RuntimeQuestionRecord[] = [
  {
    "id": "WH-L5-000001",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "某粮油库本年度只开展粮食储存业务。保管员在交接资料时，关于粮食经营台账的做法，哪项符合现行规则？",
    "options": [
      {
        "key": "A",
        "text": "未发生粮食收购时可以不建立台账"
      },
      {
        "key": "B",
        "text": "从事粮食储存的经营主体应当建立台账"
      },
      {
        "key": "C",
        "text": "只有承担政策性业务的单位才需建账"
      },
      {
        "key": "D",
        "text": "发生年度销售后再补建台账即可"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。储存属于应按办法建立粮食经营台账的经营活动；本题只判断建账范围，不涉及企业内部台账样式。",
    "difficulty": "easy",
    "keywords": [
      "粮食储存",
      "建账范围",
      "库存账卡"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第2条（建账主体范围）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000002",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "multiple",
    "stem": "保管员整理本周已发生业务的台账资料时，下列哪些材料可以作为形成粮食经营台账的原始依据？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "粮食收购码单"
      },
      {
        "key": "B",
        "text": "仅凭交接人回忆写成的便条"
      },
      {
        "key": "C",
        "text": "销售发票"
      },
      {
        "key": "D",
        "text": "购销合同"
      }
    ],
    "answer": [
      "A",
      "C",
      "D"
    ],
    "explanation": "答案是A、C、D。台账应以经营过程中形成的原始凭证和相关政策文件为依据；仅凭回忆写成的便条不能替代已形成的凭据。",
    "difficulty": "easy",
    "keywords": [
      "原始凭证",
      "收购码单",
      "销售发票"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第3条（台账依据）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000003",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "同一库点上午完成入库、下午完成出库，原始凭证均已齐全。保管员将两笔业务写入经营台账时，最符合要求的顺序是？",
    "options": [
      {
        "key": "A",
        "text": "按粮食品种的字母顺序排列"
      },
      {
        "key": "B",
        "text": "先写金额较大的业务"
      },
      {
        "key": "C",
        "text": "按业务实际发生的时间先后记录"
      },
      {
        "key": "D",
        "text": "等月底集中后任意排序录入"
      }
    ],
    "answer": [
      "C"
    ],
    "explanation": "答案是C。经营台账强调以业务发生时间为线索形成记录；本题不涉及库内作业先后或凭证审批权限。",
    "difficulty": "easy",
    "keywords": [
      "时间顺序",
      "出入库",
      "台账登记"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第3条（记录顺序）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000004",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "multiple",
    "stem": "库内交接时要把台账资料按办法规定的基本类别归集。下列哪些属于粮食经营台账通常包含的信息类别？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "经营主体的身份与联系资料"
      },
      {
        "key": "B",
        "text": "每笔粮食购销行为的资料"
      },
      {
        "key": "C",
        "text": "当班人员私人考勤汇总"
      },
      {
        "key": "D",
        "text": "已下达政策性任务的执行资料"
      }
    ],
    "answer": [
      "A",
      "B",
      "D"
    ],
    "explanation": "答案是A、B、D。上述内容分别对应经营主体、购销交易和政策执行资料；私人考勤汇总不属于办法列出的台账基本信息类别。",
    "difficulty": "medium",
    "keywords": [
      "台账类别",
      "资料归集",
      "交接"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第4条（台账信息类别）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000005",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "保管员核对经营主体基础信息页时，下列哪组信息属于市场主体的基础信息？",
    "options": [
      {
        "key": "A",
        "text": "粮食品种、数量和计量单位"
      },
      {
        "key": "B",
        "text": "详细名称、统一社会信用代码和法定代表人"
      },
      {
        "key": "C",
        "text": "仓内温度、湿度和检查频次"
      },
      {
        "key": "D",
        "text": "装卸班次、交接时长和作业路线"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。经营主体基础信息中包括作为市场主体的详细名称、统一社会信用代码和法定代表人等；其他选项分别属于交易、粮情或现场安排信息。",
    "difficulty": "easy",
    "keywords": [
      "主体信息",
      "统一社会信用代码",
      "台账核对"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第5条（经营主体基础信息）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000006",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "multiple",
    "stem": "保管员补录一笔已经发生的粮食购销交易行为时，下列哪些内容属于应结合业务记录的交易信息？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "业务类型和发生日期"
      },
      {
        "key": "B",
        "text": "粮食品种、数量和计量单位"
      },
      {
        "key": "C",
        "text": "购进或销售业务对应的粮食来源、去向"
      },
      {
        "key": "D",
        "text": "当班人员的私人通讯录"
      }
    ],
    "answer": [
      "A",
      "B",
      "C"
    ],
    "explanation": "答案是A、B、C。交易信息应反映业务类型、日期、品种、数量、计量单位等；购进和销售还需衔接来源或去向。私人通讯录不是该交易信息。",
    "difficulty": "medium",
    "keywords": [
      "交易信息",
      "粮食来源",
      "粮食去向"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第6条（购销交易行为信息）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000007",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "judge",
    "stem": "判断：记录一笔粮食购进或销售业务时，台账还应能够反映该粮食的来源或去向。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "A"
    ],
    "explanation": "答案是A。购进、销售业务的交易信息需要保留粮食来源或去向，便于业务记录保持可追溯；本题不要求保管员自行确定交易安排。",
    "difficulty": "easy",
    "keywords": [
      "购进记录",
      "销售记录",
      "可追溯"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第6条（来源与去向）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000008",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "在整理某批粮食的交易信息时，保管员要补充“其他信息”。下列哪项与这一部分最相符？",
    "options": [
      {
        "key": "A",
        "text": "粮食性质以及质量、储存品质、食品安全等指标信息"
      },
      {
        "key": "B",
        "text": "经营主体的联系人和地址"
      },
      {
        "key": "C",
        "text": "本月装卸设备的维修排班"
      },
      {
        "key": "D",
        "text": "仓房建设材料的采购计划"
      }
    ],
    "answer": [
      "A"
    ],
    "explanation": "答案是A。交易行为的其他信息可以反映粮食性质及相关质量信息；联系人和地址属于经营主体信息，其他两项不是本条列示的交易字段。",
    "difficulty": "medium",
    "keywords": [
      "粮食性质",
      "质量指标",
      "储存品质"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第6条（交易其他信息）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000009",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "保管员协助核对经营资金财务信息的基础栏。下列哪一组最符合该栏应记录的内容？",
    "options": [
      {
        "key": "A",
        "text": "仓号和货位号"
      },
      {
        "key": "B",
        "text": "粮食来源和销售去向"
      },
      {
        "key": "C",
        "text": "经营粮食的单价和金额"
      },
      {
        "key": "D",
        "text": "粮食性质和储存品质指标"
      }
    ],
    "answer": [
      "C"
    ],
    "explanation": "答案是C。经营资金财务信息的基础内容包括经营粮食的单价、金额等；其余选项属于交易或其他信息。",
    "difficulty": "easy",
    "keywords": [
      "资金财务信息",
      "单价",
      "金额"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第7条（资金财务基础信息）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000010",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "库内正在执行已下达的政策性粮食轮换计划。保管员整理政策执行信息时，哪项最符合应反映的内容？",
    "options": [
      {
        "key": "A",
        "text": "自行修改轮换计划目标"
      },
      {
        "key": "B",
        "text": "为下一年度另行制定轮换方案"
      },
      {
        "key": "C",
        "text": "决定是否向外发布计划"
      },
      {
        "key": "D",
        "text": "记录相关计划已经执行的数量和时间"
      }
    ],
    "answer": [
      "D"
    ],
    "explanation": "答案是D。政策执行信息应反映有关计划及其执行数量、时间等情况；保管员的记录工作不包括制定、修改或发布计划。",
    "difficulty": "medium",
    "keywords": [
      "政策执行信息",
      "轮换计划",
      "执行数量"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第8条（政策执行信息）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000011",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "一家企业只从事商业性粮食经营。保管员整理其经营台账的基础资料时，最应覆盖哪几类基础信息？",
    "options": [
      {
        "key": "A",
        "text": "仅覆盖粮食政策执行信息"
      },
      {
        "key": "B",
        "text": "经营主体、购销交易行为和经营资金财务三类基础信息"
      },
      {
        "key": "C",
        "text": "只记录出入库凭证编号即可"
      },
      {
        "key": "D",
        "text": "只记录政府事权粮食计划的执行情况"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。从事商业性经营业务的企业，其台账应包含经营主体、交易行为和资金财务三部分列出的基础信息；政策执行信息不能被当然视为其唯一内容。",
    "difficulty": "medium",
    "keywords": [
      "商业性经营",
      "基础信息",
      "台账范围"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第9条（商业性经营台账）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000012",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "judge",
    "stem": "判断：承担政策性业务的主体建立政策性粮食经营台账时，可以只保留购销交易资料而不记录相关政策执行信息。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。政策性粮食经营台账应覆盖办法第5至第8条规定的全部内容，其中包括政策执行信息；本题不涉及谁来下达计划。",
    "difficulty": "medium",
    "keywords": [
      "政策性业务",
      "台账内容",
      "政策执行信息"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第9条（政策性粮食台账范围）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000013",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "judge",
    "stem": "判断：交接中发现台账数值与原始凭证不一致时，应以核对后的凭证和相关要求为依据处理，不能为了交接方便而伪造、篡改或损毁台账内容。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "A"
    ],
    "explanation": "答案是A。台账内容应真实、准确、完整，并与原始凭证和相关政策文件要求一致；保管员交接时应保留可核对的记录边界。",
    "difficulty": "medium",
    "keywords": [
      "真实性",
      "原始凭证",
      "交接核对"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第11条（真实性与完整性）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000014",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "班组交接时，粮食购进、储存和销售的原始凭证散落在不同文件夹中。保管员首先应采取哪项记录措施？",
    "options": [
      {
        "key": "A",
        "text": "等到年度盘点后再处理凭证"
      },
      {
        "key": "B",
        "text": "只保留金额最大的几张凭证"
      },
      {
        "key": "C",
        "text": "及时汇总整理相关原始凭证并记录台账"
      },
      {
        "key": "D",
        "text": "以口头交代替代凭证整理"
      }
    ],
    "answer": [
      "C"
    ],
    "explanation": "答案是C。经营主体应及时汇总整理购进、储存、销售等原始凭证并记录台账；本题只考资料整理，不涉及凭证审批。",
    "difficulty": "easy",
    "keywords": [
      "凭证整理",
      "交接",
      "及时记录"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第12条（凭证汇总与记录）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000015",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "judge",
    "stem": "判断：某月没有发生粮食经营业务时，月度台账应完全留空，不需要结转上月末相关指标数据。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。月度内未发生业务时，月度末仍应结转上月末相关指标数据；本题仅考无业务月份的记录连续性。",
    "difficulty": "easy",
    "keywords": [
      "无业务月份",
      "月度结转",
      "记录连续性"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第12条（月度结转）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000016",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "库房搬迁前，保管员整理可供查验的粮食经营台账。按照现行办法，相关资料的保存期限最低应为多久？",
    "options": [
      {
        "key": "A",
        "text": "不少于3年"
      },
      {
        "key": "B",
        "text": "不少于6个月"
      },
      {
        "key": "C",
        "text": "不少于1年"
      },
      {
        "key": "D",
        "text": "保存到下一次交接即可"
      }
    ],
    "answer": [
      "A"
    ],
    "explanation": "答案是A。粮食经营台账应妥善保管备查并保持资料连续性，保存期限不得少于3年；本题只问最低保存期限。",
    "difficulty": "easy",
    "keywords": [
      "保存期限",
      "备查",
      "资料连续性"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第12条（台账保管）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000017",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "multiple",
    "stem": "库房采用电子资料交接。下列哪些情形可以作为“已通过信息化方式建立粮食经营台账”的依据？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "相关会计账簿已涵盖办法列明的台账内容"
      },
      {
        "key": "B",
        "text": "电子信息化管理系统能够查询到相关内容"
      },
      {
        "key": "C",
        "text": "仅保留未核对的聊天记录截图"
      },
      {
        "key": "D",
        "text": "只由上一班口头说明数据位置"
      }
    ],
    "answer": [
      "A",
      "B"
    ],
    "explanation": "答案是A、B。相关账簿涵盖规定内容，或电子系统能够查询到相关内容时，可以据此认定已建立台账；单纯聊天截图或口头说明不构成该条件。",
    "difficulty": "medium",
    "keywords": [
      "信息化台账",
      "会计账簿",
      "电子系统"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第13条（信息化建账条件）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000018",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "经核对，库房使用的电子管理系统已经能够查询到办法列明的全部相关台账内容。为同一内容再次建立台账时，哪项做法最符合要求？",
    "options": [
      {
        "key": "A",
        "text": "必须把每项内容抄写两遍后再归档"
      },
      {
        "key": "B",
        "text": "只能改用纸质账本，电子系统不得保留"
      },
      {
        "key": "C",
        "text": "将电子系统内容全部删除以避免重复"
      },
      {
        "key": "D",
        "text": "不必再另行抄录、打印形成实体账本"
      }
    ],
    "answer": [
      "D"
    ],
    "explanation": "答案是D。已可通过符合条件的相关账簿或电子系统查询到台账内容时，不必为了同一内容另行抄录、打印实体账本；电子资料仍应保持可查。",
    "difficulty": "medium",
    "keywords": [
      "实体账本",
      "电子查询",
      "重复抄录"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第13条（实体账本要求）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000019",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "保管员按规定准备需报送的粮食经营基本数据时，下列哪一组业务属于办法明确列出的范围？",
    "options": [
      {
        "key": "A",
        "text": "仓房建设、设备采购和人员招聘"
      },
      {
        "key": "B",
        "text": "粮食购进、储存和销售"
      },
      {
        "key": "C",
        "text": "食堂就餐、车辆维修和办公用品领用"
      },
      {
        "key": "D",
        "text": "设备运行、人员考勤和会议纪要"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。经营主体应按规定报送粮食购进、储存、销售等基本数据和有关情况；本题不涉及由谁制定报送口径。",
    "difficulty": "easy",
    "keywords": [
      "数据报送",
      "粮食购进",
      "粮食销售"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第14条（基本数据报送）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L5-000020",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 5,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "交接前，保管员发现准备报送的库存数据与当天已经核对的经营台账不一致。哪项处理原则最符合要求？",
    "options": [
      {
        "key": "A",
        "text": "优先保留报送表中的旧数字，避免重复修改"
      },
      {
        "key": "B",
        "text": "按交接人员习惯选择其中一组数字"
      },
      {
        "key": "C",
        "text": "核对后使报送数据同时与生产经营实际、经营台账一致"
      },
      {
        "key": "D",
        "text": "只要报送时间及时，数据是否一致不重要"
      }
    ],
    "answer": [
      "C"
    ],
    "explanation": "答案是C。报送的基本数据和有关情况既应符合生产经营实际，也应与粮食经营台账一致；本题只考交接前的数据核对原则。",
    "difficulty": "medium",
    "keywords": [
      "数据一致性",
      "交接核对",
      "经营实际"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第15条（报送数据一致性）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L4-000001",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 4,
    "module": "粮情检查",
    "topic": "粮温检查",
    "type": "single",
    "stem": "在政策性粮食承储企业安排粮情检查时，哪种做法最有利于后续复核温度变化？",
    "options": [
      {
        "key": "A",
        "text": "只记录发现异常的仓号，不留检查时间"
      },
      {
        "key": "B",
        "text": "按制度完成规定点位检查并保留时间、点位和原始数据"
      },
      {
        "key": "C",
        "text": "由不同人员凭印象选择点位且不作交接"
      },
      {
        "key": "D",
        "text": "先写变化原因，之后再补测量数据"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。规范化粮情检查需要按制度实施并形成可追溯记录；原因判断应建立在已核实数据上。",
    "difficulty": "medium",
    "keywords": [
      "粮情检查",
      "点位",
      "原始记录"
    ],
    "source_ids": [
      "SRC-0015"
    ],
    "standard_reference": "《政策性粮食承储企业仓储管理规范化指南》：粮情检查与记录要求",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L4-000002",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 4,
    "module": "职业道德与安全生产",
    "topic": "安全生产责任",
    "type": "single",
    "stem": "机械通风设备运行中出现异常振动，现场人员尚未查明原因。保管员首先应怎么做？",
    "options": [
      {
        "key": "A",
        "text": "保持设备运行并等交班后再提"
      },
      {
        "key": "B",
        "text": "自行拆下防护装置检查内部"
      },
      {
        "key": "C",
        "text": "按安全程序停止或隔离相关作业，记录现象并报告"
      },
      {
        "key": "D",
        "text": "把异常直接登记为设备报废"
      }
    ],
    "answer": [
      "C"
    ],
    "explanation": "答案是C。面对可能的仓储作业安全风险，应先防止风险扩大、保留事实并按程序报告，不得带险运行或越权拆修。",
    "difficulty": "medium",
    "keywords": [
      "异常振动",
      "设备安全",
      "报告"
    ],
    "source_ids": [
      "SRC-0008"
    ],
    "standard_reference": "《粮食仓储企业重大生产安全事故隐患判定标准（试行）》：仓储作业安全管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L4-000003",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 4,
    "module": "仓房与设备管理",
    "topic": "仓房检查",
    "type": "multiple",
    "stem": "政策性粮食承储企业开展仓房日常检查时，为使问题可追踪，下列哪些信息应在发现异常时保留？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "仓号和具体位置"
      },
      {
        "key": "B",
        "text": "检查时间与可见现象"
      },
      {
        "key": "C",
        "text": "已采取的防护或报告情况"
      },
      {
        "key": "D",
        "text": "未经核实的最终事故责任"
      }
    ],
    "answer": [
      "A",
      "B",
      "C"
    ],
    "explanation": "答案是A、B、C。位置、时间、事实和已采取措施便于复核；未调查的信息不能写成最终责任结论。",
    "difficulty": "medium",
    "keywords": [
      "仓房检查",
      "异常记录",
      "可追溯"
    ],
    "source_ids": [
      "SRC-0015"
    ],
    "standard_reference": "《政策性粮食承储企业仓储管理规范化指南》：设施设备与检查管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L4-000004",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 4,
    "module": "粮油储藏基础",
    "topic": "储粮生态条件",
    "type": "judge",
    "stem": "政策性粮食承储企业发现仓内局部水汽痕迹但原因未确认时，应先记录位置和现象并按制度报告，而不是直接把它写成粮食霉变结论。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "A"
    ],
    "explanation": "该说法正确。事实记录与专业结论应分开；未完成核查前不能把线索当成确定的质量结论。",
    "difficulty": "easy",
    "keywords": [
      "水汽痕迹",
      "事实记录",
      "质量结论"
    ],
    "source_ids": [
      "SRC-0015"
    ],
    "standard_reference": "《政策性粮食承储企业仓储管理规范化指南》：粮情检查与异常管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L4-000005",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 4,
    "module": "仓房与设备管理",
    "topic": "储粮设备维护",
    "type": "single",
    "stem": "检查发现测温设备外壳受损，但当天仍有测温任务。以下哪种处理最妥当？",
    "options": [
      {
        "key": "A",
        "text": "继续使用并删除明显异常数据"
      },
      {
        "key": "B",
        "text": "标识停用或隔离该设备，记录状态并按设备管理程序处理"
      },
      {
        "key": "C",
        "text": "自行拆修后不做任何功能确认"
      },
      {
        "key": "D",
        "text": "换用设备后不在记录中说明"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。状态异常的设备应先受控，避免产生不可靠数据；后续检查或维修按单位设备管理程序实施。",
    "difficulty": "medium",
    "keywords": [
      "测温设备",
      "状态异常",
      "停用标识"
    ],
    "source_ids": [
      "SRC-0015"
    ],
    "standard_reference": "《政策性粮食承储企业仓储管理规范化指南》：仓储设施设备管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L4-000006",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 4,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "粮食经营者当天先发生一笔销售、后发生一笔入库，两笔原始凭证齐全。形成经营台账时应如何排列？",
    "options": [
      {
        "key": "A",
        "text": "按业务实际发生时间依次记录"
      },
      {
        "key": "B",
        "text": "先记入库，月底再补销售"
      },
      {
        "key": "C",
        "text": "按金额从大到小排列"
      },
      {
        "key": "D",
        "text": "由录入人员任意调整顺序"
      }
    ],
    "answer": [
      "A"
    ],
    "explanation": "答案是A。粮食经营台账应以原始凭证等为依据，按照业务发生时间顺序形成。",
    "difficulty": "easy",
    "keywords": [
      "经营台账",
      "业务时间",
      "原始凭证"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第3条（记录依据与顺序）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L4-000007",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 4,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "multiple",
    "stem": "整理粮食经营台账依据时，下列哪些已形成材料属于办法明确列举的原始凭证类型？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "出入库凭证"
      },
      {
        "key": "B",
        "text": "购销合同"
      },
      {
        "key": "C",
        "text": "销售发票"
      },
      {
        "key": "D",
        "text": "没有来源的口头数字"
      }
    ],
    "answer": [
      "A",
      "B",
      "C"
    ],
    "explanation": "答案是A、B、C。办法列举出入库凭证、购销合同、销售发票等作为台账依据；无来源的口头数字不能替代原始凭证。",
    "difficulty": "easy",
    "keywords": [
      "出入库凭证",
      "购销合同",
      "台账依据"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第3条（原始凭证）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L4-000008",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 4,
    "module": "粮情控制与处理",
    "topic": "异常粮情处理",
    "type": "judge",
    "stem": "政策性粮食承储企业出现异常粮情线索时，只要保管员经验丰富，就可以不保留原始记录，直接实施未经批准的处置方案。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "该说法错误。异常粮情应有事实记录、报告和受控处置，个人经验不能替代企业制度和批准的作业安排。",
    "difficulty": "medium",
    "keywords": [
      "异常粮情",
      "受控处置",
      "原始记录"
    ],
    "source_ids": [
      "SRC-0015"
    ],
    "standard_reference": "《政策性粮食承储企业仓储管理规范化指南》：粮情检查与技术管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L3-000001",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 3,
    "module": "粮情检查",
    "topic": "粮温检查",
    "type": "single",
    "stem": "政策性粮食承储企业复盘某仓连续一周的测温记录时，个别高点反复出现。作为高级保管人员，下一步最合理的是？",
    "options": [
      {
        "key": "A",
        "text": "删除高点，使曲线更平滑"
      },
      {
        "key": "B",
        "text": "核对点位和设备状态，结合相邻数据复查并保留异常处置链"
      },
      {
        "key": "C",
        "text": "只凭一次最高值确定发热原因"
      },
      {
        "key": "D",
        "text": "不复核数据，直接改变全部仓房作业方案"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。趋势异常需要核对数据来源、设备和相邻信息，并保留复查与处置记录；不能删除数据或越过核查直接归因。",
    "difficulty": "hard",
    "keywords": [
      "温度趋势",
      "数据复核",
      "异常链"
    ],
    "source_ids": [
      "SRC-0015"
    ],
    "standard_reference": "《政策性粮食承储企业仓储管理规范化指南》：粮情检查与规范化管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L3-000002",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 3,
    "module": "储粮害虫与霉变",
    "topic": "储粮害虫识别",
    "type": "single",
    "stem": "多个仓间在不同点位陆续发现疑似害虫痕迹。为支持后续专业判断，汇总材料首先应突出什么？",
    "options": [
      {
        "key": "A",
        "text": "只保留最严重仓间的一张照片"
      },
      {
        "key": "B",
        "text": "把所有痕迹直接归为同一虫种"
      },
      {
        "key": "C",
        "text": "仓号、点位、时间、样品或影像及检查方法等可追溯信息"
      },
      {
        "key": "D",
        "text": "先确定药剂方案，再决定是否记录"
      }
    ],
    "answer": [
      "C"
    ],
    "explanation": "答案是C。跨仓异常研判需要可追溯的点位、时间和观察证据；虫种和处置方案应由后续核查支持。",
    "difficulty": "medium",
    "keywords": [
      "害虫痕迹",
      "跨仓汇总",
      "可追溯"
    ],
    "source_ids": [
      "SRC-0015"
    ],
    "standard_reference": "《政策性粮食承储企业仓储管理规范化指南》：害虫防治与粮情管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L3-000003",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 3,
    "module": "粮情控制与处理",
    "topic": "异常粮情处理",
    "type": "multiple",
    "stem": "评审一项政策性粮食仓储异常处置建议时，为确保建议有事实依据，应同时核对哪些资料？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "原始粮情记录和复核结果"
      },
      {
        "key": "B",
        "text": "设施设备状态与相关作业记录"
      },
      {
        "key": "C",
        "text": "已报告事项和已采取的受控措施"
      },
      {
        "key": "D",
        "text": "与本仓无关且来源不明的网络经验"
      }
    ],
    "answer": [
      "A",
      "B",
      "C"
    ],
    "explanation": "答案是A、B、C。处置建议应建立在本仓可追溯的数据、设备状态和已采取措施上；来源不明的信息不能替代现场证据。",
    "difficulty": "hard",
    "keywords": [
      "处置评审",
      "粮情记录",
      "设备状态"
    ],
    "source_ids": [
      "SRC-0015"
    ],
    "standard_reference": "《政策性粮食承储企业仓储管理规范化指南》：制度、设施设备与粮情管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L3-000004",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 3,
    "module": "职业道德与安全生产",
    "topic": "安全生产责任",
    "type": "judge",
    "stem": "粮食仓储企业发现可能构成重大生产安全事故隐患的线索时，应先控制相关风险并按制度组织核查，不能因为尚未定性就继续危险作业。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "A"
    ],
    "explanation": "该说法正确。是否最终构成重大隐患需要按适用标准核查，但发现风险线索不能成为继续危险作业的理由。",
    "difficulty": "medium",
    "keywords": [
      "重大隐患线索",
      "风险控制",
      "组织核查"
    ],
    "source_ids": [
      "SRC-0008"
    ],
    "standard_reference": "《粮食仓储企业重大生产安全事故隐患判定标准（试行）》：适用范围与隐患判定管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L3-000005",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 3,
    "module": "仓房与设备管理",
    "topic": "储粮设备维护",
    "type": "single",
    "stem": "同一类通风设备在三个月内多次出现相似异常。高级保管人员组织复盘时，哪项最能发现管理薄弱点？",
    "options": [
      {
        "key": "A",
        "text": "只看最后一次维修是否结束"
      },
      {
        "key": "B",
        "text": "把每次异常分别归档且不做关联"
      },
      {
        "key": "C",
        "text": "对照设备状态、检查记录、作业条件和处置结果分析重复原因"
      },
      {
        "key": "D",
        "text": "将所有异常都归因于操作人员"
      }
    ],
    "answer": [
      "C"
    ],
    "explanation": "答案是C。重复异常需要从设备、检查、作业条件和处置闭环综合复盘，单次结案或先行归责都不足以支持改进。",
    "difficulty": "hard",
    "keywords": [
      "重复异常",
      "设备管理",
      "复盘"
    ],
    "source_ids": [
      "SRC-0015"
    ],
    "standard_reference": "《政策性粮食承储企业仓储管理规范化指南》：设施设备与制度管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L3-000006",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 3,
    "module": "账卡与记录",
    "topic": "库存账卡",
    "type": "single",
    "stem": "审核粮食经营台账时发现一笔出库业务没有对应原始凭证，但台账数字与月度汇总恰好一致。应如何处理？",
    "options": [
      {
        "key": "A",
        "text": "因汇总一致而直接认定该笔记录充分"
      },
      {
        "key": "B",
        "text": "核查业务与原始凭证链，不能用汇总一致替代台账依据"
      },
      {
        "key": "C",
        "text": "删除该笔记录后不留说明"
      },
      {
        "key": "D",
        "text": "制作一张无来源凭证补齐形式"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。经营台账应以经营过程中形成的原始凭证和相关政策文件为依据；汇总数字吻合不能替代单笔业务的依据链。",
    "difficulty": "hard",
    "keywords": [
      "台账审核",
      "原始凭证",
      "依据链"
    ],
    "source_ids": [
      "SRC-0016"
    ],
    "standard_reference": "《粮食经营台账管理办法》第3条（台账依据）",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L3-000007",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 3,
    "module": "账卡与记录",
    "topic": "粮情记录",
    "type": "multiple",
    "stem": "为比较某仓通风前后的粮情变化，汇总记录至少应保持哪些信息可以相互对应？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "仓号和测点位置"
      },
      {
        "key": "B",
        "text": "检查或作业时间"
      },
      {
        "key": "C",
        "text": "设备及作业状态"
      },
      {
        "key": "D",
        "text": "只保留通风后的平均值"
      }
    ],
    "answer": [
      "A",
      "B",
      "C"
    ],
    "explanation": "答案是A、B、C。仓号、点位、时间和作业状态一致，才能支持前后比较；只留一个平均值会丢失复核条件。",
    "difficulty": "medium",
    "keywords": [
      "前后对照",
      "粮情记录",
      "作业状态"
    ],
    "source_ids": [
      "SRC-0015"
    ],
    "standard_reference": "《政策性粮食承储企业仓储管理规范化指南》：粮情检查、设施设备与技术管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L3-000008",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 3,
    "module": "粮情控制与处理",
    "topic": "通风降温",
    "type": "judge",
    "stem": "评价政策性粮食仓储通风作业时，只要设备正常运转就足以认定作业有效，无需比较作业前后粮情记录。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "该说法错误。设备运行状态与作业效果是不同问题；效果评价需要结合可追溯的作业前后粮情信息。",
    "difficulty": "medium",
    "keywords": [
      "通风效果",
      "设备状态",
      "前后比较"
    ],
    "source_ids": [
      "SRC-0015"
    ],
    "standard_reference": "《政策性粮食承储企业仓储管理规范化指南》：控温技术与粮情管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "WH-L3-000009",
    "occupation": "4-02-06-01",
    "direction": "粮油保管员",
    "level": 3,
    "module": "粮情控制与处理",
    "topic": "异常粮情处理",
    "type": "case",
    "stem": "【案例】某仓连续两次记录到同一点位温度异常，现场人员建议立即启动设备并进入粮堆查找原因。作为高级保管员，哪项初步处理最符合受控作业要求？",
    "options": [
      {
        "key": "A",
        "text": "只口头通知同事，不保留点位和原始读数"
      },
      {
        "key": "B",
        "text": "立即进入粮堆深处查找热源，之后再补办作业手续"
      },
      {
        "key": "C",
        "text": "复核点位与变化趋势，保存原始记录，先控制风险并按制度报告，等待批准的处置方案"
      },
      {
        "key": "D",
        "text": "把异常读数改为邻近点位的正常值，避免影响当班交接"
      }
    ],
    "answer": [
      "C"
    ],
    "explanation": "答案是C。案例中首先要复核可追溯数据、描述变化趋势、控制现场风险并按制度报告；未经安全确认和批准，不得冒险进入粮堆或擅自启动处置，也不得篡改原始记录。",
    "difficulty": "hard",
    "keywords": [
      "案例分析",
      "异常升温",
      "受控处置"
    ],
    "source_ids": [
      "SRC-0015"
    ],
    "standard_reference": "《政策性粮食承储企业仓储管理规范化指南》：制度、设施设备与粮情管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L5-000001",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 5,
    "module": "扦样分样与样品制备",
    "topic": "扦样方法",
    "type": "single",
    "stem": "开展政府粮油储备质量检查扦样时，哪项做法最能保证后续结果可对应到被检查批次？",
    "options": [
      {
        "key": "A",
        "text": "样品离开现场后再凭记忆补批次"
      },
      {
        "key": "B",
        "text": "在扦样和封装环节同步核对批次、点位及唯一标识"
      },
      {
        "key": "C",
        "text": "多个批次使用同一无编号容器"
      },
      {
        "key": "D",
        "text": "只在检验报告上写品种名称"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。政府储备质量检查强调扦样检验管理和样品代表性，样品必须能追溯到对应批次和扦样信息。",
    "difficulty": "easy",
    "keywords": [
      "政府储备",
      "扦样",
      "唯一标识"
    ],
    "source_ids": [
      "SRC-0006"
    ],
    "standard_reference": "《政府储备粮油质量检查扦样检验管理办法》：扦样与样品管理要求",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L5-000002",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 5,
    "module": "扦样分样与样品制备",
    "topic": "样品制备",
    "type": "multiple",
    "stem": "粮油质量安全风险监测样品到达承检环节时，下列哪些信息适合在接收登记中核对？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "样品标识和包装状态"
      },
      {
        "key": "B",
        "text": "接收时间与交接信息"
      },
      {
        "key": "C",
        "text": "监测任务或样品对应关系"
      },
      {
        "key": "D",
        "text": "尚未检验就填写最终合格结论"
      }
    ],
    "answer": [
      "A",
      "B",
      "C"
    ],
    "explanation": "答案是A、B、C。接收登记用于确认样品身份、状态和任务对应关系；最终结论必须建立在后续检验和复核上。",
    "difficulty": "easy",
    "keywords": [
      "样品接收",
      "登记",
      "风险监测"
    ],
    "source_ids": [
      "SRC-0018"
    ],
    "standard_reference": "《粮油质量安全风险监测管理办法》：样品接收与登记",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L5-000003",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 5,
    "module": "试剂器皿与仪器",
    "topic": "仪器校准",
    "type": "single",
    "stem": "依法向社会出具具有证明作用数据的检验检测机构中，某仪器已超过规定的校准或核查状态确认周期。检验员应如何处理？",
    "options": [
      {
        "key": "A",
        "text": "先继续出具结果，下月再补状态确认"
      },
      {
        "key": "B",
        "text": "只要仪器能开机就视为状态正常"
      },
      {
        "key": "C",
        "text": "按机构程序停止使用或受控处理，完成必要确认后再投入使用"
      },
      {
        "key": "D",
        "text": "自行修改设备标签日期"
      }
    ],
    "answer": [
      "C"
    ],
    "explanation": "答案是C。此类机构应保证设备检定、校准或核查状态受控；超过受控状态不能仅凭能开机继续用于出具结果。",
    "difficulty": "medium",
    "keywords": [
      "仪器状态",
      "校准",
      "资质认定"
    ],
    "source_ids": [
      "SRC-0019"
    ],
    "standard_reference": "《检验检测机构资质认定评审准则》：设备检定、校准与核查要求",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L5-000004",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 5,
    "module": "职业道德与实验室安全",
    "topic": "检验职业道德",
    "type": "judge",
    "stem": "检验员发现原始读数与预期不一致时，可以删除原始读数，只保留更接近预期的复测结果。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "该说法错误。检验记录应真实、客观并可追溯；异常和复测应按程序记录，不能选择性删除原始数据。",
    "difficulty": "easy",
    "keywords": [
      "原始读数",
      "真实客观",
      "复测"
    ],
    "source_ids": [
      "SRC-0002",
      "SRC-0019"
    ],
    "standard_reference": "《农产品食品检验员国家职业技能标准（2019年版）》；《检验检测机构资质认定评审准则》记录要求",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L5-000005",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 5,
    "module": "检验记录与报告",
    "topic": "原始记录",
    "type": "single",
    "stem": "检验过程中发现样品编号与任务单不一致，尚未开始测定。最合适的做法是？",
    "options": [
      {
        "key": "A",
        "text": "自行选择一个编号继续检验"
      },
      {
        "key": "B",
        "text": "暂停相关操作，保留样品状态并按程序核实记录"
      },
      {
        "key": "C",
        "text": "擦除样品标签后重新命名"
      },
      {
        "key": "D",
        "text": "完成检验后再决定是否报告"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。样品身份不一致会破坏结果对应关系，应在测定前暂停并按受控程序核实，不能自行改号。",
    "difficulty": "easy",
    "keywords": [
      "样品编号",
      "任务单",
      "暂停核实"
    ],
    "source_ids": [
      "SRC-0018"
    ],
    "standard_reference": "《粮油质量安全风险监测管理办法》：样品接收登记与检验管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L5-000006",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 5,
    "module": "数据处理与质量控制",
    "topic": "检验数据处理",
    "type": "judge",
    "stem": "粮油质量安全风险监测样品包装破损且可能影响样品状态时，承检人员应记录并按任务程序处理，不能假装接收状态正常。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "A"
    ],
    "explanation": "该说法正确。样品接收状态属于可追溯信息；可能影响结果的异常必须如实记录并按监测任务程序处理。",
    "difficulty": "easy",
    "keywords": [
      "包装破损",
      "样品状态",
      "异常记录"
    ],
    "source_ids": [
      "SRC-0018"
    ],
    "standard_reference": "《粮油质量安全风险监测管理办法》：样品接收与登记",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L5-000007",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 5,
    "module": "数据处理与质量控制",
    "topic": "质量控制样",
    "type": "multiple",
    "stem": "为使一次受控检验能够被复核，原始记录通常需要对应哪些信息？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "样品唯一标识"
      },
      {
        "key": "B",
        "text": "使用的方法和设备信息"
      },
      {
        "key": "C",
        "text": "原始观察或读数及操作时间"
      },
      {
        "key": "D",
        "text": "与本次检验无关的推测结论"
      }
    ],
    "answer": [
      "A",
      "B",
      "C"
    ],
    "explanation": "答案是A、B、C。样品、方法、设备和原始数据共同构成复核链；无关推测不属于检验事实。",
    "difficulty": "medium",
    "keywords": [
      "可复核",
      "原始记录",
      "设备信息"
    ],
    "source_ids": [
      "SRC-0019"
    ],
    "standard_reference": "《检验检测机构资质认定评审准则》：记录与结果可追溯要求",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L5-000008",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 5,
    "module": "检验记录与报告",
    "topic": "检验报告",
    "type": "single",
    "stem": "风险监测检验中，某项结果仍在规定的复核流程内。数据报送人员应如何处理？",
    "options": [
      {
        "key": "A",
        "text": "先按最终结果报送，复核后不再修改"
      },
      {
        "key": "B",
        "text": "等待规定复核完成并按受控流程报送"
      },
      {
        "key": "C",
        "text": "选择更符合经验的数字报送"
      },
      {
        "key": "D",
        "text": "只口头通知且不保留记录"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。风险监测包含检验复核和数据报送环节，尚未完成受控复核的数据不能冒充最终结果。",
    "difficulty": "medium",
    "keywords": [
      "风险监测",
      "检验复核",
      "数据报送"
    ],
    "source_ids": [
      "SRC-0018"
    ],
    "standard_reference": "《粮油质量安全风险监测管理办法》：检验复核与数据报送",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L4-000001",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 4,
    "module": "理化检验方法",
    "topic": "水分测定",
    "type": "single",
    "stem": "依法向社会出具具有证明作用数据的检验检测机构准备启用一项新引入的方法。正式用于出具结果前，首先应关注什么？",
    "options": [
      {
        "key": "A",
        "text": "由一名人员口头说可以即可"
      },
      {
        "key": "B",
        "text": "按机构程序完成方法确认或验证并保留相应记录"
      },
      {
        "key": "C",
        "text": "先出具报告，再补方法文件"
      },
      {
        "key": "D",
        "text": "直接照搬另一机构的结论"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。受资质认定评审准则约束的机构应确保所用方法适用并按程序完成确认或验证，相关证据需要可追溯。",
    "difficulty": "medium",
    "keywords": [
      "方法验证",
      "新方法",
      "资质认定"
    ],
    "source_ids": [
      "SRC-0019"
    ],
    "standard_reference": "《检验检测机构资质认定评审准则》：方法确认与验证要求",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L4-000002",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 4,
    "module": "职业道德与实验室安全",
    "topic": "实验室安全规范",
    "type": "single",
    "stem": "检验开始前发现实验室环境条件已超出该受控方法规定范围。中级检验员应如何处理？",
    "options": [
      {
        "key": "A",
        "text": "继续测定并隐去环境记录"
      },
      {
        "key": "B",
        "text": "暂停受影响检验，记录环境状态并按程序处理"
      },
      {
        "key": "C",
        "text": "把方法范围改成当前环境"
      },
      {
        "key": "D",
        "text": "仅凭最终结果看起来正常就接受"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。环境条件可能影响结果时应受控和记录；不能隐去条件、擅改方法或只凭结果外观判断。",
    "difficulty": "medium",
    "keywords": [
      "环境条件",
      "暂停检验",
      "受控方法"
    ],
    "source_ids": [
      "SRC-0019"
    ],
    "standard_reference": "《检验检测机构资质认定评审准则》：工作环境与方法控制",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L4-000003",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 4,
    "module": "试剂器皿与仪器",
    "topic": "仪器校准",
    "type": "multiple",
    "stem": "审核一台用于出具检验数据的设备是否处于受控状态时，应同时关注哪些证据？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "设备唯一标识和当前状态"
      },
      {
        "key": "B",
        "text": "适用的检定、校准或核查记录"
      },
      {
        "key": "C",
        "text": "维护、异常和修复后的确认信息"
      },
      {
        "key": "D",
        "text": "操作人员对设备品牌的偏好"
      }
    ],
    "answer": [
      "A",
      "B",
      "C"
    ],
    "explanation": "答案是A、B、C。设备身份、计量状态和异常处置共同支持其受控使用；个人品牌偏好不能作为技术证据。",
    "difficulty": "medium",
    "keywords": [
      "设备状态",
      "校准记录",
      "异常处置"
    ],
    "source_ids": [
      "SRC-0019"
    ],
    "standard_reference": "《检验检测机构资质认定评审准则》：设备检定、校准、核查与记录",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L4-000004",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 4,
    "module": "数据处理与质量控制",
    "topic": "质量控制样",
    "type": "judge",
    "stem": "检验检测机构参加能力验证时，应真实客观报送结果并保留原始记录，不能为了获得满意评价而选择性修改数据。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "A"
    ],
    "explanation": "该说法正确。能力验证要求结果和原始记录真实客观；人为选择性修改会破坏质量控制的有效性。",
    "difficulty": "easy",
    "keywords": [
      "能力验证",
      "真实客观",
      "原始记录"
    ],
    "source_ids": [
      "SRC-0020"
    ],
    "standard_reference": "《检验检测机构能力验证管理办法》：结果报送与原始记录要求",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L4-000005",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 4,
    "module": "数据处理与质量控制",
    "topic": "检验数据处理",
    "type": "single",
    "stem": "风险监测检验中，一组平行结果出现明显不一致且原因未查明。以下哪项最符合质量控制要求？",
    "options": [
      {
        "key": "A",
        "text": "选取更接近历史均值的一次结果"
      },
      {
        "key": "B",
        "text": "按受控程序检查样品、方法、设备和记录，必要时复核或重做"
      },
      {
        "key": "C",
        "text": "取两次结果中较有利的一项上报"
      },
      {
        "key": "D",
        "text": "删除所有原始数据重新开始"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。异常结果应通过可追溯的质量控制流程查找原因并复核，不能择优报送或删除原始记录。",
    "difficulty": "hard",
    "keywords": [
      "平行结果",
      "异常复核",
      "质量控制"
    ],
    "source_ids": [
      "SRC-0018",
      "SRC-0019"
    ],
    "standard_reference": "《粮油质量安全风险监测管理办法》检验复核要求；《检验检测机构资质认定评审准则》质量控制要求",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L4-000006",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 4,
    "module": "扦样分样与样品制备",
    "topic": "样品制备",
    "type": "single",
    "stem": "风险监测样品在制备过程中需要分出检验用样和留存部分。为维持可追溯性，哪项做法正确？",
    "options": [
      {
        "key": "A",
        "text": "分出后分别使用唯一且可对应原样的标识"
      },
      {
        "key": "B",
        "text": "所有容器不标识，靠摆放位置区分"
      },
      {
        "key": "C",
        "text": "只标检验用样，留存部分无需记录"
      },
      {
        "key": "D",
        "text": "不同原样制备后共用一个编号"
      }
    ],
    "answer": [
      "A"
    ],
    "explanation": "答案是A。制备后的各部分仍需与原样和任务保持对应关系；只靠位置或共用编号会破坏追溯链。",
    "difficulty": "medium",
    "keywords": [
      "样品制备",
      "留样",
      "追溯"
    ],
    "source_ids": [
      "SRC-0018"
    ],
    "standard_reference": "《粮油质量安全风险监测管理办法》：样品接收、检验与复核管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L4-000007",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 4,
    "module": "检验记录与报告",
    "topic": "检验报告",
    "type": "multiple",
    "stem": "风险监测数据在规定流程内报送前，哪些做法有助于保证信息质量？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "完成规定的检验复核"
      },
      {
        "key": "B",
        "text": "核对样品、结果和任务对应关系"
      },
      {
        "key": "C",
        "text": "依权限和规定渠道报送"
      },
      {
        "key": "D",
        "text": "为追求整齐而修改不一致的原始数据"
      }
    ],
    "answer": [
      "A",
      "B",
      "C"
    ],
    "explanation": "答案是A、B、C。复核、对应关系和受控报送共同保证数据质量；原始数据不能为了外观整齐被修改。",
    "difficulty": "medium",
    "keywords": [
      "数据报送",
      "结果复核",
      "权限"
    ],
    "source_ids": [
      "SRC-0018"
    ],
    "standard_reference": "《粮油质量安全风险监测管理办法》：检验复核、数据报送与保密要求",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L4-000008",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 4,
    "module": "检验记录与报告",
    "topic": "原始记录",
    "type": "judge",
    "stem": "能力验证样品的检测结果已经上报后，原始记录仍应按机构要求保留；上报完成不等于可以销毁原始证据。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "A"
    ],
    "explanation": "该说法正确。能力验证管理强调真实客观报送和原始记录，结果上报后仍需按受控要求保存相关证据。",
    "difficulty": "easy",
    "keywords": [
      "能力验证",
      "记录保存",
      "结果上报"
    ],
    "source_ids": [
      "SRC-0020"
    ],
    "standard_reference": "《检验检测机构能力验证管理办法》：结果与原始记录管理",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L3-000001",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 3,
    "module": "数据处理与质量控制",
    "topic": "质量控制样",
    "type": "single",
    "stem": "某检验检测机构计划评价一项粮油检测能力的长期稳定性。下列哪种设计更有助于识别系统性变化？",
    "options": [
      {
        "key": "A",
        "text": "只挑选一次结果最好的数据"
      },
      {
        "key": "B",
        "text": "结合适用的能力验证、人员或设备比对及留样再测等受控质量控制证据"
      },
      {
        "key": "C",
        "text": "只比较不同样品的最终合格结论"
      },
      {
        "key": "D",
        "text": "删除所有偏离历史均值的记录"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。多类受控质量控制证据可以从人员、设备和时间等维度识别能力变化；择优和删数会掩盖问题。",
    "difficulty": "hard",
    "keywords": [
      "能力评价",
      "比对",
      "留样再测"
    ],
    "source_ids": [
      "SRC-0020"
    ],
    "standard_reference": "《检验检测机构能力验证管理办法》：能力验证及相关质量控制方式",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L3-000002",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 3,
    "module": "理化检验方法",
    "topic": "杂质测定",
    "type": "single",
    "stem": "评审人员发现某检验批次使用了偏离受控方法的操作，但记录中没有批准、技术判断或影响评价。应如何看待该批结果？",
    "options": [
      {
        "key": "A",
        "text": "只要结果与经验接近即可直接接受"
      },
      {
        "key": "B",
        "text": "应按机构程序评估偏离及其对结果的影响，不能把未受控偏离视为正常"
      },
      {
        "key": "C",
        "text": "删除方法信息后重新出报告"
      },
      {
        "key": "D",
        "text": "由操作人员口头说明即可结案"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。方法及其偏离需要受控、记录并评价影响；结果看似合理不能替代技术和管理证据。",
    "difficulty": "hard",
    "keywords": [
      "方法偏离",
      "影响评价",
      "受控"
    ],
    "source_ids": [
      "SRC-0019"
    ],
    "standard_reference": "《检验检测机构资质认定评审准则》：方法控制、记录与结果质量要求",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L3-000003",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 3,
    "module": "数据处理与质量控制",
    "topic": "检验数据处理",
    "type": "multiple",
    "stem": "粮油质量安全风险监测结果复核时，若发现结果与样品背景明显不协调，应重点核对哪些环节？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "样品接收、标识和流转记录"
      },
      {
        "key": "B",
        "text": "方法、设备状态及原始数据"
      },
      {
        "key": "C",
        "text": "计算、复核和报送对应关系"
      },
      {
        "key": "D",
        "text": "与任务无关的市场传言"
      }
    ],
    "answer": [
      "A",
      "B",
      "C"
    ],
    "explanation": "答案是A、B、C。样品链、技术链和数据链都可能影响监测结果，复核应基于可追溯证据；市场传言不能替代检验记录。",
    "difficulty": "hard",
    "keywords": [
      "风险监测",
      "结果复核",
      "全流程追溯"
    ],
    "source_ids": [
      "SRC-0018",
      "SRC-0019"
    ],
    "standard_reference": "《粮油质量安全风险监测管理办法》检验复核要求；《检验检测机构资质认定评审准则》记录与质量控制要求",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L3-000004",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 3,
    "module": "数据处理与质量控制",
    "topic": "质量控制样",
    "type": "judge",
    "stem": "检验检测机构能力验证出现不满意结果时，把该结果直接改成满意并删除原始记录，比调查原因和采取受控措施更合适。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "该说法错误。能力验证的价值在于真实识别能力问题；修改结果和删除记录破坏真实性，应依据受控程序分析和改进。",
    "difficulty": "medium",
    "keywords": [
      "不满意结果",
      "能力验证",
      "改进"
    ],
    "source_ids": [
      "SRC-0020"
    ],
    "standard_reference": "《检验检测机构能力验证管理办法》：真实客观报送与原始记录要求",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L3-000005",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 3,
    "module": "试剂器皿与仪器",
    "topic": "仪器校准",
    "type": "single",
    "stem": "一台关键设备被发现曾在校准状态失效期间用于多个样品。技术负责人评估影响时，哪项资料最关键？",
    "options": [
      {
        "key": "A",
        "text": "设备颜色和购买价格"
      },
      {
        "key": "B",
        "text": "失效时间范围、涉及样品、原始数据、质量控制及后续确认记录"
      },
      {
        "key": "C",
        "text": "操作人员对结果的主观信心"
      },
      {
        "key": "D",
        "text": "删除设备日志后的最终报告"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。评价失控设备对既有结果的影响，需要时间、样品、数据和质量控制证据形成可追溯范围；主观信心不能替代证据。",
    "difficulty": "hard",
    "keywords": [
      "设备失控",
      "影响范围",
      "结果追溯"
    ],
    "source_ids": [
      "SRC-0019"
    ],
    "standard_reference": "《检验检测机构资质认定评审准则》：设备状态、记录与结果有效性控制",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L3-000006",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 3,
    "module": "检验记录与报告",
    "topic": "检验报告",
    "type": "multiple",
    "stem": "高级检验人员审核风险监测数据报送包时，应确认哪些内容相互一致？（选择全部适用项）",
    "options": [
      {
        "key": "A",
        "text": "监测任务与样品标识"
      },
      {
        "key": "B",
        "text": "原始数据、复核结果与拟报送数据"
      },
      {
        "key": "C",
        "text": "报送权限、渠道和版本状态"
      },
      {
        "key": "D",
        "text": "未经核实的外部评价"
      }
    ],
    "answer": [
      "A",
      "B",
      "C"
    ],
    "explanation": "答案是A、B、C。任务、样品、数据、复核和受控报送必须形成一致链条；未经核实的外部评价不属于报送依据。",
    "difficulty": "hard",
    "keywords": [
      "报送审核",
      "版本状态",
      "数据链"
    ],
    "source_ids": [
      "SRC-0018"
    ],
    "standard_reference": "《粮油质量安全风险监测管理办法》：样品登记、检验复核、数据报送与保密",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L3-000007",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 3,
    "module": "职业道德与实验室安全",
    "topic": "检验职业道德",
    "type": "single",
    "stem": "风险监测项目尚未按规定发布，一名无关人员要求检验员发送完整样品清单和未复核结果。最合适的处理是？",
    "options": [
      {
        "key": "A",
        "text": "直接发送，以便对方先行分析"
      },
      {
        "key": "B",
        "text": "按保密和权限要求拒绝擅自提供，并通过规定渠道处理请求"
      },
      {
        "key": "C",
        "text": "只删除样品编号后随意传播全部数据"
      },
      {
        "key": "D",
        "text": "在社交平台发布后再报告"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "答案是B。风险监测数据涉及规定的报送和保密管理，检验员应在授权范围内处理信息请求。",
    "difficulty": "medium",
    "keywords": [
      "风险监测",
      "保密",
      "权限"
    ],
    "source_ids": [
      "SRC-0018"
    ],
    "standard_reference": "《粮油质量安全风险监测管理办法》：数据报送与保密要求",
    "review_status": "verified",
    "content_version": 1
  },
  {
    "id": "QI-L3-000008",
    "occupation": "4-08-05-01",
    "direction": "粮油质量检验员",
    "level": 3,
    "module": "粮油质量指标",
    "topic": "水分指标",
    "type": "judge",
    "stem": "某机构在能力验证中表现满意，可以直接证明该机构今后检测的每一个粮油样品都必然得到正确质量结论。",
    "options": [
      {
        "key": "A",
        "text": "正确"
      },
      {
        "key": "B",
        "text": "错误"
      }
    ],
    "answer": [
      "B"
    ],
    "explanation": "该说法错误。能力验证用于评价特定检验检测能力，不能替代对每个样品的规范扦样、检验、复核和报告。",
    "difficulty": "medium",
    "keywords": [
      "能力验证",
      "单个样品",
      "结论边界"
    ],
    "source_ids": [
      "SRC-0020"
    ],
    "standard_reference": "《检验检测机构能力验证管理办法》：能力验证适用边界",
    "review_status": "verified",
    "content_version": 1
  }
];
