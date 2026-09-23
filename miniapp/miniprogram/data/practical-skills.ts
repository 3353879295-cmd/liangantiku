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
  iconAsset: string;
  purpose: string;
  preparations: string[];
  steps: PracticalStep[];
  safetyNotes: string[];
  commonMistakes: string[];
  relatedQuestionIds: string[];
  sourceIds: string[];
  standardReference: string;
  nonCurrentSourceIds?: string[];
  nonCurrentReference?: string;
}

const ALL_PRACTICAL_SKILLS: PracticalSkill[] = [
  {
    id: 'grain-condition-rounds',
    occupation: '4-02-06-01',
    title: '粮情巡查与记录',
    summary: '按固定路线观察粮面、仓房、温湿度与异常线索，留下可复核的原始记录。',
    iconAsset: '/assets/practical/warehouse.png',
    purpose: '建立连续、可复核的粮情记录，尽早发现仓储异常。',
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
    relatedQuestionIds: ['WH-L4-000001', 'WH-L3-000007'],
    sourceIds: ['SRC-0001', 'SRC-0008'],
    standardReference: '（粮油）仓储管理员国家职业技能标准（2019年版）',
    nonCurrentSourceIds: ['SRC-0004'],
    nonCurrentReference: '政府储备粮食仓储管理办法（已失效，仅作历史/书目参考）',
  },
  {
    id: 'warehouse-entry-check',
    occupation: '4-02-06-01',
    title: '入仓前安全检查',
    summary: '在开门、进仓和登高前完成准入、环境、设备与人员条件确认。',
    iconAsset: '/assets/practical/warehouse.png',
    purpose: '确认人员、环境和设备均满足入仓条件，避免带险作业。',
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
    relatedQuestionIds: ['WH-L4-000003', 'WH-L3-000004'],
    sourceIds: ['SRC-0001', 'SRC-0008'],
    standardReference:
      '（粮油）仓储管理员国家职业技能标准（2019年版）；粮食仓储企业重大生产安全事故隐患判定标准（试行）',
  },
  {
    id: 'mechanical-ventilation',
    occupation: '4-02-06-01',
    title: '机械通风作业检查',
    summary: '围绕作业条件、设备连接、运行巡视和停机复核完成安全检查。',
    iconAsset: '/assets/practical/warehouse.png',
    purpose: '确保通风方案正确执行，及时发现设备与粮情异常。',
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
    relatedQuestionIds: ['WH-L4-000002', 'WH-L3-000008'],
    sourceIds: ['SRC-0001', 'SRC-0008'],
    standardReference: '（粮油）仓储管理员国家职业技能标准（2019年版）',
    nonCurrentSourceIds: ['SRC-0004'],
    nonCurrentReference: '政府储备粮食仓储管理办法（已失效，仅作历史/书目参考）',
  },
  {
    id: 'fumigation-safety',
    occupation: '4-02-06-01',
    title: '熏蒸作业安全配合',
    summary: '只讲授权、警戒、监护与应急边界，不提供药剂剂量或无监护操作方法。',
    iconAsset: '/assets/practical/grain-pest.png',
    purpose: '在专业作业边界内完成警戒、联络和记录，防止熏蒸风险外溢。',
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
    relatedQuestionIds: ['WH-L3-000004', 'WH-L4-000008'],
    sourceIds: ['SRC-0001', 'SRC-0008'],
    standardReference:
      '（粮油）仓储管理员国家职业技能标准（2019年版）；粮食仓储企业重大生产安全事故隐患判定标准（试行）',
  },
  {
    id: 'stored-pest-check',
    occupation: '4-02-06-01',
    title: '储粮害虫检查',
    summary: '规范查看诱捕、筛检或可见痕迹，记录发现位置并交由规定流程确认。',
    iconAsset: '/assets/practical/grain-pest.png',
    purpose: '规范发现、留样和报告虫害线索，为后续确认与处置提供依据。',
    preparations: ['确认检查点位和频次', '准备洁净采集与记录用品', '做好样品和工具防交叉污染'],
    steps: [
      { title: '按点检查', detail: '依布点或巡查路线查看粮面、墙角、门窗和设备周边的可见线索。' },
      { title: '留取信息', detail: '记录位置、时间、数量或状态；需留样时按单位方法编号和封装。' },
      { title: '清洁隔离', detail: '检查后清洁工具，避免将虫体或粮粒带往其他仓间。' },
      { title: '报告确认', detail: '按程序提交记录或样品，不凭单一迹象擅自确定种类和处置方案。' },
    ],
    safetyNotes: ['使用筛具、攀登或进入仓内时同时遵守粉尘、机械和高处作业防护要求。'],
    commonMistakes: ['只检查一个显眼位置', '样品无仓号、点位和时间标识'],
    relatedQuestionIds: ['WH-L3-000002'],
    sourceIds: ['SRC-0001', 'SRC-0005'],
    standardReference: '（粮油）仓储管理员国家职业技能标准（2019年版）；粮食质量安全监管办法',
    nonCurrentSourceIds: ['SRC-0004'],
    nonCurrentReference: '政府储备粮食仓储管理办法（已失效，仅作历史/书目参考）',
  },
  {
    id: 'abnormal-heating-response',
    occupation: '4-02-06-01',
    title: '异常升温初步处置',
    summary: '复核点位、保护现场、分级报告，在批准方案下配合后续处置。',
    iconAsset: '/assets/practical/thermometer.png',
    purpose: '复核异常升温并保全原始信息，为分级报告和批准处置提供依据。',
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
    relatedQuestionIds: ['WH-L3-000001', 'WH-L3-000003'],
    sourceIds: ['SRC-0001', 'SRC-0005'],
    standardReference: '（粮油）仓储管理员国家职业技能标准（2019年版）',
    nonCurrentSourceIds: ['SRC-0004'],
    nonCurrentReference: '政府储备粮食仓储管理办法（已失效，仅作历史/书目参考）',
  },
];

export const PRACTICAL_SKILLS = ALL_PRACTICAL_SKILLS.filter(
  (skill) => skill.occupation === '4-02-06-01',
);

export const getPracticalSkill = (id: string): PracticalSkill | undefined =>
  PRACTICAL_SKILLS.find((skill) => skill.id === id);
