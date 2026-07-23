import type { OccupationCode } from '../types/domain';

export interface PracticalStep {
  title: string;
  detail: string;
}

export interface PracticalSkill {
  id: string;
  occupation: OccupationCode;
  title: string;
  summary: string;
  icon: string;
  preparations: string[];
  steps: PracticalStep[];
  safetyNotes: string[];
  commonMistakes: string[];
  relatedQuestionIds: string[];
  sourceIds: string[];
  standardReference: string;
}

export const PRACTICAL_SKILLS: PracticalSkill[] = [
  {
    id: 'grain-condition-rounds',
    occupation: '4-02-06-01',
    title: '粮情巡查与记录',
    summary: '按固定路线观察粮面、仓房、温湿度与异常线索，留下可复核的原始记录。',
    icon: 'search',
    preparations: ['确认巡查任务和仓号', '携带记录工具及经确认可用的检测设备', '核对个人防护要求'],
    steps: [
      { title: '先看环境', detail: '从仓外到仓内按既定路线检查门窗、通风口、地面和作业通道。' },
      {
        title: '再查粮情',
        detail: '依单位规程观察粮面、气味、虫害痕迹和温湿度等信息，不跳过规定点位。',
      },
      { title: '如实记录', detail: '记录时间、仓号、点位、读数和可见现象，未确认的情况写为线索。' },
      { title: '异常报告', detail: '对异常点位做好必要隔离或警示，并按岗位流程及时报告。' },
    ],
    safetyNotes: ['进入限制区域前确认准入条件；发现缺氧、异味或结构风险时不得冒险进入。'],
    commonMistakes: ['只写“正常”而没有点位和数据', '把未经复核的迹象直接写成虫害或发热结论'],
    relatedQuestionIds: ['WH-L5-000056', 'WH-L5-000058'],
    sourceIds: ['SRC-0001', 'SRC-0004', 'SRC-0008'],
    standardReference: '（粮油）仓储管理员国家职业技能标准（2019年版）；政府储备粮食仓储管理办法',
  },
  {
    id: 'warehouse-entry-check',
    occupation: '4-02-06-01',
    title: '入仓前安全检查',
    summary: '在开门、进仓和登高前完成准入、环境、设备与人员条件确认。',
    icon: 'home',
    preparations: ['查看作业票或任务单', '确认监护与联络安排', '按单位要求配齐个人防护用品'],
    steps: [
      { title: '确认准入', detail: '核对仓号、作业内容、授权范围和现场负责人，不进入未获准区域。' },
      {
        title: '外围检查',
        detail: '检查通道、门窗、警示标识和可见设备状态，识别积水、阻塞等风险。',
      },
      { title: '环境确认', detail: '按单位制度完成通风、检测或其他进入条件确认，并保留记录。' },
      { title: '保持联络', detail: '按规定进入并与监护人员保持联系，异常时立即退出并报告。' },
    ],
    safetyNotes: ['不得单人擅自进入有限空间、熏蒸仓或状态不明的仓房。'],
    commonMistakes: ['先进入再补登记', '只检查个人防护用品，不核对仓房状态和监护安排'],
    relatedQuestionIds: ['WH-L5-000002', 'WH-L5-000062'],
    sourceIds: ['SRC-0001', 'SRC-0008'],
    standardReference:
      '（粮油）仓储管理员国家职业技能标准（2019年版）；粮食仓储企业重大生产安全事故隐患判定标准（试行）',
  },
  {
    id: 'mechanical-ventilation',
    occupation: '4-02-06-01',
    title: '机械通风作业检查',
    summary: '围绕作业条件、设备连接、运行巡视和停机复核完成安全检查。',
    icon: 'refresh',
    preparations: ['取得批准的通风方案', '确认设备和电气检查状态', '准备运行记录表'],
    steps: [
      { title: '核对方案', detail: '确认仓号、目的、设备组合和现场职责与批准方案一致。' },
      {
        title: '开机前检查',
        detail: '检查风道连接、防护装置、周边杂物和电气外观，异常未排除不得启动。',
      },
      { title: '运行巡视', detail: '按规定观察设备声响、振动和粮情变化，记录时间与状态。' },
      { title: '停机复核', detail: '按流程停机断开，检查设备与仓房状态并完成记录交接。' },
    ],
    safetyNotes: ['设备运转时不得拆卸防护装置或进入危险部位；电气异常由有资质人员处理。'],
    commonMistakes: ['未经方案确认直接启动', '只记开停时间，不记录运行异常和粮情变化'],
    relatedQuestionIds: ['WH-L5-000060', 'WH-L5-000061'],
    sourceIds: ['SRC-0001', 'SRC-0004', 'SRC-0008'],
    standardReference: '（粮油）仓储管理员国家职业技能标准（2019年版）；政府储备粮食仓储管理办法',
  },
  {
    id: 'fumigation-safety',
    occupation: '4-02-06-01',
    title: '熏蒸作业安全配合',
    summary: '只讲授权、警戒、监护与应急边界，不提供药剂剂量或无监护操作方法。',
    icon: 'shield',
    preparations: [
      '确认作业由具备条件的单位和人员组织',
      '核对审批、警戒与应急安排',
      '明确本人职责边界',
    ],
    steps: [
      { title: '核验授权', detail: '确认作业文件、现场负责人、专业人员和监护安排齐全。' },
      { title: '设置警戒', detail: '依批准方案设置隔离、标识和人员管控，防止无关人员进入。' },
      { title: '配合记录', detail: '只在授权范围内完成点名、联络、巡查或记录，不擅自接触药剂。' },
      {
        title: '异常撤离',
        detail: '警报、泄漏迹象或人员不适时立即远离危险区，启动报告和应急流程。',
      },
    ],
    safetyNotes: [
      '严禁无资质、无审批、无监护开展熏蒸；具体药剂、剂量、检测和散气以专业方案及单位规程为准。',
    ],
    commonMistakes: ['把一般防尘口罩当作防毒防护', '未确认安全条件就摘除警戒或进入仓房'],
    relatedQuestionIds: ['WH-L5-000001', 'WH-L5-000003'],
    sourceIds: ['SRC-0001', 'SRC-0008'],
    standardReference:
      '（粮油）仓储管理员国家职业技能标准（2019年版）；粮食仓储企业重大生产安全事故隐患判定标准（试行）',
  },
  {
    id: 'stored-pest-check',
    occupation: '4-02-06-01',
    title: '储粮害虫检查',
    summary: '规范查看诱捕、筛检或可见痕迹，记录发现位置并交由规定流程确认。',
    icon: 'bug',
    preparations: ['确认检查点位和频次', '准备洁净采集与记录用品', '做好样品和工具防交叉污染'],
    steps: [
      { title: '按点检查', detail: '依布点或巡查路线查看粮面、墙角、门窗和设备周边的可见线索。' },
      { title: '留取信息', detail: '记录位置、时间、数量或状态；需留样时按单位方法编号和封装。' },
      { title: '清洁隔离', detail: '检查后清洁工具，避免将虫体或粮粒带往其他仓间。' },
      { title: '报告确认', detail: '按程序提交记录或样品，不凭单一迹象擅自确定种类和处置方案。' },
    ],
    safetyNotes: ['使用筛具、攀登或进入仓内时同时遵守粉尘、机械和高处作业防护要求。'],
    commonMistakes: ['只检查一个显眼位置', '样品无仓号、点位和时间标识'],
    relatedQuestionIds: ['WH-L5-000049', 'WH-L5-000051'],
    sourceIds: ['SRC-0001', 'SRC-0004', 'SRC-0005'],
    standardReference: '（粮油）仓储管理员国家职业技能标准（2019年版）；粮食质量安全监管办法',
  },
  {
    id: 'abnormal-heating-response',
    occupation: '4-02-06-01',
    title: '异常升温初步处置',
    summary: '复核点位、保护现场、分级报告，在批准方案下配合后续处置。',
    icon: 'error-circle',
    preparations: ['调取近期粮温记录', '确认测温设备状态', '明确异常报告联系人'],
    steps: [
      {
        title: '复核信息',
        detail: '检查仓号、点位和时间，按规程复测或交叉核对，排除明显记录错误。',
      },
      { title: '比较趋势', detail: '与相邻点位和历史记录比较，描述变化范围，不越权判断原因。' },
      { title: '控制风险', detail: '在职责范围内保护现场、限制可能扩大风险的操作并设置提醒。' },
      { title: '立即报告', detail: '提交原始数据、位置、趋势和已采取措施，等待批准的处置方案。' },
    ],
    safetyNotes: ['不得为寻找热源擅自钻粮、深挖粮堆或进入未经确认安全的区域。'],
    commonMistakes: ['单个异常读数未经复核就下结论', '只口头报告，不保留原始数据和点位信息'],
    relatedQuestionIds: ['WH-L5-000053', 'WH-L5-000054'],
    sourceIds: ['SRC-0001', 'SRC-0004', 'SRC-0005'],
    standardReference: '（粮油）仓储管理员国家职业技能标准（2019年版）；政府储备粮食仓储管理办法',
  },
  {
    id: 'sampling',
    occupation: '4-08-05-01',
    title: '粮油扦样',
    summary: '先界定批次，再按适用标准布点取样，保证样品具有代表性和可追溯性。',
    icon: 'filter',
    preparations: [
      '确认适用的现行扦样方法',
      '核对批次、数量和状态',
      '准备洁净适用的器具、容器和标签',
    ],
    steps: [
      { title: '识别批次', detail: '核对品种、批号、货位和边界，发现混批或状态不明时先报告。' },
      {
        title: '按法布点',
        detail: '严格依适用现行标准和受控作业文件确定点位与份数，不凭经验随意减少。',
      },
      { title: '规范取样', detail: '使用洁净器具依次取样，防止遗漏、污染和样品损失。' },
      { title: '混合标识', detail: '按规定形成原始样品，立即标注批次、地点、时间和人员信息。' },
    ],
    safetyNotes: ['车、船、粮堆或高处扦样必须先落实现场安全措施，不在移动设备或无防护条件下操作。'],
    commonMistakes: ['先取样后补写批次标签', '只取方便到达的位置，造成代表性不足'],
    relatedQuestionIds: ['QI-L5-000001', 'QI-L5-000002'],
    sourceIds: ['SRC-0002', 'SRC-0006', 'SRC-0010'],
    standardReference:
      'GB/T 5491-2025《粮食、油料检验 扦样、分样法》；政府储备粮油质量检查扦样检验管理办法',
  },
  {
    id: 'sample-division',
    occupation: '4-08-05-01',
    title: '样品混合与分样',
    summary: '在避免损失和偏析的前提下，将原始样品制成满足检验与留样要求的样品。',
    icon: 'git-branch',
    preparations: ['确认样品身份和包装完整', '准备洁净干燥的分样器具', '核对检验、复检和留样需求'],
    steps: [
      { title: '检查样品', detail: '核对标签、数量、状态和交接信息，异常先记录并确认。' },
      { title: '充分混合', detail: '依适用方法使样品均匀，避免粗细、轻重组分在操作中偏析。' },
      { title: '规范缩分', detail: '按现行标准选择适用分样方法，重复操作至满足后续用途。' },
      { title: '分别封装', detail: '检验样、复检样和留样分别装入适宜容器并完成唯一标识。' },
    ],
    safetyNotes: ['操作产生粉尘时按实验室要求采取通风和个人防护，器具使用后及时清洁。'],
    commonMistakes: ['直接从未混匀样品表层抓取检验样', '缩分后标签未同步，导致样品身份混淆'],
    relatedQuestionIds: ['QI-L5-000003', 'QI-L5-000004'],
    sourceIds: ['SRC-0002', 'SRC-0010', 'SRC-0011'],
    standardReference:
      'GB/T 5491-2025《粮食、油料检验 扦样、分样法》；GB/T 5490-2010《粮油检验 一般规则》',
  },
  {
    id: 'moisture-test',
    occupation: '4-08-05-01',
    title: '水分检验作业要点',
    summary: '围绕方法确认、样品制备、仪器状态、平行测定和原始记录控制检验质量。',
    icon: 'measurement',
    preparations: [
      '确认粮种对应的现行检验方法',
      '核对样品身份和状态',
      '检查仪器校准或核查状态及环境条件',
    ],
    steps: [
      { title: '选择方法', detail: '按样品类型、检验目的和受控文件确认适用方法及关键条件。' },
      { title: '制备样品', detail: '依方法要求完成混匀、缩分和必要制备，减少水分变化。' },
      {
        title: '实施测定',
        detail: '严格按现行标准与仪器作业文件操作，不自行更改时间、温度或计算规则。',
      },
      {
        title: '复核记录',
        detail: '记录原始读数、平行结果、仪器和环境信息，按规则判断是否需要复测。',
      },
    ],
    safetyNotes: ['涉及加热、研磨或电气设备时执行防烫、防尘和断电清洁要求。'],
    commonMistakes: ['样品敞口放置过久', '只抄最终结果，未保留称量或仪器原始数据'],
    relatedQuestionIds: ['QI-L5-000005', 'QI-L5-000006'],
    sourceIds: ['SRC-0002', 'SRC-0003', 'SRC-0011'],
    standardReference: 'GB/T 5490-2010《粮油检验 一般规则》及样品对应的现行水分检验方法标准',
  },
  {
    id: 'impurity-test',
    occupation: '4-08-05-01',
    title: '杂质检验作业要点',
    summary: '按适用标准完成样品称取、筛理与分类，避免组分遗漏和主观边界漂移。',
    icon: 'filter-clear',
    preparations: [
      '确认粮种对应的杂质检验方法',
      '准备适用且状态正常的筛具和衡器',
      '检查样品与容器标识',
    ],
    steps: [
      {
        title: '核对方法',
        detail: '确认检验对象、分类边界、所需试样量和结果表达均来自当前受控方法。',
      },
      { title: '混匀称取', detail: '从代表性样品中按方法取得试样，保留原始称量记录。' },
      { title: '筛理分拣', detail: '依标准顺序操作，分类存放各组分，防止散失、重复或交叉混入。' },
      { title: '计算复核', detail: '核对各组分质量、计算过程和允许差，异常时按质量控制程序处理。' },
    ],
    safetyNotes: ['筛理和清扫时控制粉尘，不用手直接清理仍在运行的设备。'],
    commonMistakes: ['分类容器无标识导致组分混淆', '筛上、筛下物散失后仍继续计算'],
    relatedQuestionIds: ['QI-L5-000007', 'QI-L5-000008'],
    sourceIds: ['SRC-0002', 'SRC-0003', 'SRC-0011'],
    standardReference: 'GB/T 5490-2010《粮油检验 一般规则》及样品对应的现行杂质检验方法标准',
  },
  {
    id: 'test-weight',
    occupation: '4-08-05-01',
    title: '容重测定作业要点',
    summary: '确认适用范围和仪器状态，按规定装样、读数并完成平行结果复核。',
    icon: 'dashboard',
    preparations: [
      '确认粮种和现行容重测定方法',
      '检查容重器、衡器及配套部件状态',
      '将样品混匀并核对标识',
    ],
    steps: [
      { title: '装配核查', detail: '依仪器作业文件检查各部件完整、洁净、放置稳定。' },
      { title: '规范装样', detail: '按适用标准完成样品处理和装填，保持每次操作方式一致。' },
      { title: '称量读数', detail: '待状态稳定后读取并记录，不以估读值替代原始示值。' },
      { title: '平行复核', detail: '比较平行结果和质量控制要求，超出条件时查找原因并按程序重做。' },
    ],
    safetyNotes: ['搬放金属部件时防夹手、防跌落；清理前确认设备处于安全状态。'],
    commonMistakes: ['装样速度和方式前后不一致', '仪器未置稳或部件有残留样品就开始测定'],
    relatedQuestionIds: ['QI-L5-000009', 'QI-L5-000010'],
    sourceIds: ['SRC-0002', 'SRC-0003', 'SRC-0011'],
    standardReference: 'GB/T 5490-2010《粮油检验 一般规则》及粮种对应的现行容重测定方法标准',
  },
  {
    id: 'laboratory-safety',
    occupation: '4-08-05-01',
    title: '检验室安全与记录',
    summary: '从人员、样品、试剂、设备和数据五个方面完成开工前检查与收尾。',
    icon: 'secured',
    preparations: [
      '了解当日检验任务和风险',
      '核对个人防护与应急设施',
      '确认受控方法和记录表单版本',
    ],
    steps: [
      { title: '开工检查', detail: '检查通风、电源、消防、洗眼等条件及设备状态，异常先停用报告。' },
      {
        title: '分区操作',
        detail: '样品、试剂和废弃物按实验室规则标识与放置，避免交叉污染和误用。',
      },
      { title: '同步记录', detail: '操作同时记录原始数据、异常和处置，不凭记忆事后集中补写。' },
      { title: '结束复位', detail: '关闭设备和能源，清洁台面，处置废弃物并完成样品与记录交接。' },
    ],
    safetyNotes: [
      '不使用无标签试剂，不独自处理未知泄漏；发生人身风险时优先撤离、求助并启动应急程序。',
    ],
    commonMistakes: ['用非受控纸张记录后再誊抄', '样品、试剂或废弃物容器缺少身份和状态标识'],
    relatedQuestionIds: ['QI-L5-000011', 'QI-L5-000012'],
    sourceIds: ['SRC-0002', 'SRC-0005', 'SRC-0011'],
    standardReference:
      '农产品食品检验员国家职业技能标准（2019年版）；GB/T 5490-2010《粮油检验 一般规则》',
  },
];

export const getPracticalSkill = (id: string): PracticalSkill | undefined =>
  PRACTICAL_SKILLS.find((skill) => skill.id === id);
