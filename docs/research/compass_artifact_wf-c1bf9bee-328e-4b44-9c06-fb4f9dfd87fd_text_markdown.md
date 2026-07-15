# 工业级 PSA/ETA/FTA 软件前端建模界面与 UI/UX 设计调研报告
## ——面向 BESS 热失控 QRA 的现代 Web 化 ETA/FTA 建模工具设计指南

## TL;DR（三点核心结论）

- **应采用"双视图 + 共享数据库 + 现代 Web 栈"的架构**：故障树（自顶向下/左→右层次布局）与事件树（电子表格式表格布局）作为两个联动视图，逻辑与可靠性数据严格分离（基本事件引用共享参数），这是 RiskSpectrum、CAFTA、SAPHIRE、Isograph 四款成熟工具的共同核心范式，必须继承。
- **推荐技术栈：React + React Flow（或 AntV X6）+ Dagre/ELK 自动布局 + AG Grid（参数库）+ Apache ECharts（结果可视化）+ Yjs（协作）+ Open-PSA MEF 序列化**。这条路线已被开源的 OpenPRA 平台部分验证——其 README 逐字写明 "frontend-web-editor: A React v18 and TypeScript-based frontend UI"、"engine-scram: Node.js wrappers for the SCRAM C/C++ engine"、"mef-schema: OpenPRA MEF JSON Schema definitions"，图编辑实测为 React Flow + Zustand。
- **成熟工具"该学"与"该改"很清晰**：值得继承的是 MCS 回溯追踪（CutSetTracer）、模型差异对比着色（Model Compare）、逻辑/数据分离、CCF 组管理、自动布局；该改进的是这些工具普遍陈旧的桌面 UI（RiskSpectrum 早期为 16 位 VB3）、单机不易协作、大模型导航靠分页转移门、结果展示偏静态表格——现代 Web 方案可在交互流畅度、协作、语义缩放、可视化上实现代际超越。

---

## Key Findings（关键发现）

### 1. 图形画布与图编辑 UX（区域一）
- 四款主流工具均提供**拖放式图形编辑器**：从调色板/工具箱拖入 AND/OR/k-of-n（表决）门、基本事件、房屋事件、转移门，连线成树。RiskSpectrum 支持"多个故障树编辑器同时打开、拖放对象、复制粘贴事件与分支、用转移门链接故障树"。
- SAPHIRE 的 FEP 编辑器具备**图形与逻辑双向同步**这一关键特性：改逻辑则自动重绘图形，改图形则自动更新逻辑。这是值得借鉴的"模型即数据"思路。
- **事件树是表格式（电子表格）布局**：功能事件（顶事件）作为顶部列标题，分支向上为成功/向下为失败，行展开为序列，末列为后果/末态分箱。事件树标题列链接到故障树顶门取概率——即"小事件树/大故障树"链接范式。Isograph 官方称其事件树模块 "unique in its ability to handle large scale problems and to fully handle success logic"，支持 primary/secondary 事件树、多分支与多后果类别（其故障树引擎可高效求解 "fault trees of the order of 20,000 gates and 20,000 basic events"）。
- **大模型导航**靠转移门分页、子树折叠/展开、概览图（overview/minimap）、搜索过滤。SAPHIRE 有 "table events" 特性把多达 8 个基本事件压缩显示以节省版面；CAFTA 主打"从顶到底连续滚动浏览树逻辑"。
- **FTA 图标约定标准化**：基本事件=圆，未发展事件=菱形，房屋事件=房子形，条件事件=椭圆，门=AND/OR/XOR/表决标准形状，转移门=三角形。这套符号必须严格实现以保证行业可读性。

### 2. 割集与量化结果可视化（区域二）
- **最小割集（MCS）结果表**：可排序/过滤的列表，按概率/频率排名，显示每个割集的基本事件、阶数、百分比贡献。
- **割集回溯到树**：RiskSpectrum **CutSetTracer** 展示选定 MCS 如何沿路径传播导致顶事件失效；CAFTA 提供割集路径追踪、割集编辑器中可做"what-if"（改事件概率、设 TRUE/FALSE）而无需重算全部割集。
- **重要度可视化**：Fussell-Vesely、Birnbaum、RAW、RRW——常用排名表 + 条形图/龙卷风图，并可按重要度给树上节点着色。Isograph 提供 FV、Birnbaum、Barlow-Proschan 等。
- **不确定性/敏感性**：蒙特卡洛输出直方图、概率分布图、误差棒、龙卷风图、百分位显示。
- Web 图表库以 **Apache ECharts** 最适合仪表盘（大数据集表现优异、声明式配置、Apache 许可；6.0.0 已于 2025 年正式发布，官方公告称带来 "12 major upgrades"，截至 2026 年最新稳定版为 6.1.0，2026-05-19 发布）；D3 用于高度定制；Recharts/visx 适合 React 标准图但 SVG 渲染在万点以上变慢。

### 3. 可靠性数据库与参数管理 UI（区域三）
- **逻辑与数据分离**是核心原则：CAFTA 把所有事件数据存于"多级数据库"，单个事件与事件组数据分开存储以最小化更新工作量；事件名加入树时自动入库。RiskSpectrum 同样以共享参数对象供基本事件引用。
- **CCF 组管理 UI**：定义共因失效组，选择 Alpha 因子 / MGL / Beta 因子模型并输入参数（如 Alpha1–4，且总和不超过 1）。CCF 组可在对话框中选事件，或在故障树图上框选事件加入组。
- **参数库需支持**：失效率 λ、PFD、MTTR、测试间隔、任务时间的存储/检索/批量编辑；不确定性分布（对数正态误差因子等）录入；数据源（T-Book、NUREG/CR-6928、OREDA、IEEE）管理与版本化。
- Web 数据网格库：**AG Grid**（行/列虚拟化，处理十万行级，企业版需授权）最适合大参数表；TanStack Table（无头、MIT、需自建 UI + 虚拟化）灵活；Glide Data Grid（Canvas 渲染、高性能）适合电子表格式编辑。

### 4. 模型版本控制 / 差异 / QA 工作流（区域四）
- **模型差异对比**：RiskSpectrum **Model Compare** "用颜色展示两个模型之间新增、修改、删除的内容"；CAFTA 提供"割集过滤与并排差异视图"。这是安全关键 QA 的核心能力。
- **审计追踪与可追溯性**：核电 PSA 受 ASME/ANS PRA 标准与监管要求约束，需变更跟踪、审计日志、未审查变更标记。
- **协作与多用户**：成熟桌面工具普遍弱（单机为主），这正是 Web 方案的最大机会点。参照系：Isograph 官网称其软件 "used in over 1900 companies, across 12,000 sites in 75 countries"、"in continuous development since 1986"，符合 ISO 26262、IEC 61508、ARP 4761、IEC 61709、ISO 21434 等标准——装机量与合规性是其壁垒，但协作能力恰是短板。
- Web 方案：结构化节点-边图差异比对、CRDT/Yjs 协作、类 git 模型版本管理、可视化 diff。Yjs 自称 "the fastest CRDT implementation by far"，已有针对 React Flow 和 GoJS 的成熟协作集成方案（注：2026 年 Rust 系 Loro 在部分基准已超越 Yjs）。

### 5. 现代 Web 前端实现（贯穿四区域）
- **图编辑库选型**（见下方 Details 详表）：React Flow（MIT、React 原生、SVG/DOM 渲染、需配 Dagre/ELK 布局、社区最大）；AntV X6（MIT、专为 DAG/ER/流程图设计、内置布局/minimap/snapline/历史等 10+ 插件、SVG+HTML）；GoJS（商业、功能最全、自带故障树示例与 TreeLayout、内置 overview/折叠）；JointJS/JointJS+（开源核心 + 商业 Rappid）；Cytoscape.js（MIT、海量布局算法、2025 年起 WebGL 渲染器）。
- **自动布局库**：Dagre（简单、速度优先、最适合树）、ELK/elkjs（功能强大、高度可配、Sugiyama 分层）、d3-hierarchy（单根树）、entitree-flex/d3-flextree（节点尺寸不一时）。
- **渲染性能阈值**：SVG/DOM 在数百节点后开始吃力（React Flow 在 ~100 节点未优化即可能掉帧，需 memo/virtualization/onlyRenderVisibleElements）；Canvas 适合数千；WebGL（Sigma.js、Cytoscape WebGL）适合上万。
- **状态/序列化**：节点-边模型 + 命令模式撤销重做（Immer / Zustand + zundo）；序列化对接 **Open-PSA Model Exchange Format（MEF，XML/XML Schema）**，这是 SCRAM/OpenPRA 等开源工具的事实标准。

---

## Details（分区详述）

### 区域一：图形画布与图编辑 UX

**拖放建模与调色板。** 行业标准交互是左侧调色板（palette/toolbox）陈列门与事件符号，拖放到画布，自动吸附（snap）到网格，连线（wiring）建立父子逻辑关系。RiskSpectrum PSA 官网描述其故障树编辑器"易于理解、提供最先进的编辑特性"，支持多编辑器并行、拖放、复制粘贴事件与分支、转移门链接。Isograph FaultTree+ 强调"门、事件和失效模型只需几次点击即可添加"，并提供 Grid Control（网格视图）与图形视图双模式编辑。

注意 Isograph 揭示的一个重要 UX 陷阱：复制粘贴 vs 选择性粘贴会因同名识别为同一事件而意外引入或消除 CCF——其官方 Tech Tuesday 博客逐字警告 "If used incorrectly this feature can unintentionally be introducing Common Cause Failures (CCF) which can kill the reliability of a system"，并说明 "When 2 gates or events have the exact same name the software recognizes those gates or events as the same gate or event"。这提示**同名即同事件**的数据模型语义必须在 UI 上显式提示（如复制时弹出"作为同一事件引用 / 作为新独立事件"选项）。

**双向同步（图↔逻辑）。** SAPHIRE 自 1980 年代 IRRAS 起即提供图形编辑器与层次逻辑编辑器两种机制，二者自动同步。这对现代实现的启示：底层应是单一的节点-边数据模型（single source of truth），图形视图与文本/表格视图都是它的投影。

**自动布局。** 故障树是层次化 DAG，天然适合 Sugiyama 分层布局。Web 实现中 Dagre 是"近乎拖入即用"的树布局首选（rankdir 设 TB 顶向下或 LR 左向右）；ELK 更强大可配但复杂（React Flow 官方坦言因其复杂性不轻易推荐，但能力上限更高）；d3-hierarchy 要求单根。BESS QRA 的故障树通常单顶事件、规模中等，**Dagre 顶向下 + 必要时 ELK** 是务实组合。

**大模型导航。** 关键模式包括：minimap/overview（GoJS、AntV X6 内置）、缩放/平移、语义缩放（LOD，缩小时只画轮廓）、子树折叠展开（GoJS TreeExpanderButton）、转移门分页、搜索高亮、模块化。React Flow 可用 onlyRenderVisibleElements 做视口虚拟化，但其官方文档与社区一致指出：DOM 渲染下数千节点需配合虚拟化与 LOD，否则缩小时浏览器绘制引擎会卡死。

**事件树专属 UX。** 事件树本质是表格：顶部功能事件列标题，二叉分支（成功向上、失败向下，按惯例 Yes/成功上、No/失败下），序列行枚举，末列后果分箱与频率。每个标题的分支条件概率之和须为 1。功能事件可链接到故障树顶门取值（小 ET/大 FT），也可直接挂基本事件。RiskSpectrum 支持边界条件（boundary conditions）下传、序列再链接到其他事件树。对 BESS 热失控场景，事件树适合建模"单体热失控→是否扩散→气体探测→灭火/泄爆→消防响应"等屏障序列。

**视觉编码与校验高亮。** 除标准符号外，应实时高亮建模错误：循环逻辑、未连接节点、未定义参数的事件。CAFTA 内置语法与逻辑检查、循环逻辑检查、独立性检查。

### 区域二：割集与量化结果可视化

成熟工具把结果组织为**可排序表 + 图上回溯 + 重要度排名/图表 + 不确定性图**四类。RiskSpectrum 的结果"用颜色码和图形展示，组织直观"。CutSetTracer 让用户点选一个 MCS，在事件树/功能事件上下文中高亮其传播路径并在右侧面板显示选中事件信息。CAFTA 的割集结果编辑器支持灵敏度/重要度研究与免重算的 what-if。

**Web 实现建议**：MCS 表用 AG Grid（虚拟化 + 排序过滤 + 百分比贡献条形单元）；重要度用 ECharts 横向条形/龙卷风图，并把 FV/RAW 值映射为树节点的热力着色；蒙特卡洛结果用 ECharts 直方图/密度图与百分位标注；顶事件频率/CDF 趋势用折线。仪表盘用 ECharts 组合，导出走 SVG/PNG + CSV/Excel。

### 区域三：可靠性数据库与参数管理 UI

**逻辑-数据分离**在 UI 上体现为：故障树只放事件"引用"，真实可靠性参数（λ、PFD、MTTR、测试间隔 T、任务时间、分布与误差因子）集中在参数库，多个基本事件可引用同一共享参数。CAFTA 的"多级数据库"为每个事件存描述、可靠性与不确定性数据、来源字段与用户自定义字段，事件名随建树自动入库。

**CCF 组 UI**：列表式管理 CCF 组，每组选模型（Alpha 因子/MGL/Beta），输入相应参数。可在专门对话框选事件入组，或在树图上框选。NUREG/CR-5485《Guidelines on Modeling Common-Cause Failures in PRA》是 CCF 建模的权威指南，定义共因组（CCCG）与 Alpha/MGL/Beta 映射公式。

**Web 数据网格选型**：AG Grid 行列虚拟化、企业级、内置过滤/分组/透视（企业版授权）；TanStack Table 无头 MIT、需自配 @tanstack/react-virtual；Glide Data Grid 基于 Canvas、十万行级电子表格体验；MUI X Data Grid 集成度高。对参数库这种"大表 + 频繁编辑 + 批量操作"场景，**AG Grid** 综合最优（社区共识：1,000 行以上虚拟化成为必需，AG Grid 在十万行级有成熟基准）。

### 区域四：模型版本控制 / 差异 / QA 工作流

RiskSpectrum Model Compare 用颜色显示两模型间新增/修改/删除的门、事件、参数，是其近年新增的三大工具之一（与 CutSetTracer、MCS BDD 并列）。CAFTA 提供并排差异视图。安全关键领域（ASME/ANS PRA 标准、NRC 监管）要求审计追踪、变更跟踪、未审查变更标记、评审/批准流程。

**Web 方案**：模型存为结构化节点-边图（最好直接是 MEF），用结构化图差异算法比对版本（按节点 ID 匹配，标记增删改）；用 Yjs（CRDT）做实时多人协作与离线合并，配 awareness 显示他人光标/选区；类 git 的版本快照与分支；可视化 diff 用并排 + 着色。Yjs 已有面向 React Flow / GoJS 的成熟协作集成（专业团队如 Synergy Codes 提供定制集成），其 awareness 协议天然支持显示协作者光标与选区。

### 区域五：现代 Web 前端实现详表

**图编辑库对比**（截至 2026 年中，版本可能滞后于知识库，需自行核实）：

| 库 | 许可 | 渲染 | 自动布局 | React/TS | 大图性能 | 适配度 |
|---|---|---|---|---|---|---|
| React Flow (xyflow) | MIT（Pro 付费组件） | SVG/DOM | 需配 Dagre/ELK/d3 | React 原生、TS | 数百节点需虚拟化/memo | 高（OpenPRA 已用） |
| AntV X6 | MIT | SVG+HTML | 复用 G6 布局，内置 | 框架无关，TS | 异步/视口渲染 | 高（专为 DAG/流程图） |
| GoJS | 商业（按人/年授权，个人版约 $3,495/年含支持） | Canvas | 内置 TreeLayout 等 | 有 gojs-react | 强，自带 overview/折叠 | 高（自带故障树示例） |
| JointJS / JointJS+ | 开源核心 / 商业 Rappid | SVG | 基础（商业版更多） | 可集成 | 中 | 中高 |
| Cytoscape.js | MIT | Canvas（2025 起 WebGL 预览） | 海量（dagre/klay/elk 等） | 有 React 封装 | WebGL 后可上万 | 中（偏网络分析） |
| maxGraph（mxGraph 继承） | Apache 2.0 | SVG | 有 | TS | 中 | 中（draw.io 同源） |

**自动布局库**：Dagre（最简、树首选）、elkjs（Sugiyama 分层、强但复杂）、d3-hierarchy（单根树）、entitree-flex/d3-flextree（节点尺寸不一）。React Flow 官方对各布局库的定位：dagre 接近"拖入即用"、elkjs 是"全功能高度可配的布局引擎"、d3-hierarchy 要求单根且对所有节点用相同宽高。

**渲染性能阈值经验**：DOM/SVG 数百节点起需虚拟化；Canvas 数千；WebGL 上万。React Flow 在 ~100 节点未做 memo 即明显掉帧（社区实测，60 FPS 基线下未优化会显著下降），优化手段为 React.memo 节点、useCallback/useMemo 稳定引用、onlyRenderVisibleElements 视口虚拟化、LOD。Cytoscape.js 实测：约 3,200 节点/68,000 边在 Canvas 渲染器约 3 FPS，切到其新 WebGL 渲染器提升到约 10 FPS——印证渲染层选型对超大图的决定性影响。

**状态与序列化**：Zustand + zundo（或命令模式 + Immer）做撤销重做；序列化对接 Open-PSA MEF（XML/XML Schema），它是 SCRAM、OpenPRA 等的事实标准，能保证与其他 PSA 工具互操作。Open-PSA 官方文档指出 MEF "is defined as an XML document type"，目的是让不同软件能共用同一 PSA 模型。OpenPRA 自定义了 JSON 版 MEF（mef-schema，README 称 "OpenPRA MEF JSON Schema definitions, generated using the shared-types package"，即从 TypeScript 类型生成），同时维护 Open-PSA XML 与 SAPHSOLVE JSON 的互操作模型库。

**OpenPRA 标杆（与本项目最接近的开源现代 Web PRA 平台）**：其 frontend-web-editor 为 **React 18.3.1 + TypeScript 5.9.3**，图编辑用 **React Flow**（故障树 store 接口名为 RFState，含 onNodesChange/onEdgesChange 等 React Flow 标准受控 API；React Flow 官方文档逐字确认其内部状态即用 Zustand："React Flow uses the library Zustand to manage its internal state"，故 OpenPRA 经 React Flow 至少间接使用 Zustand），UI 组件库用 **Elastic UI（EUI）** 而非 MUI，路由用 React Router、数据获取用 SWR，单用户撤销/重做用 past/future 历史；量化引擎为 **SCRAM C++** 经 Node.js 包装（scram-node），分布式队列用 **RabbitMQ（raptor 包）**，后端为 NestJS + MongoDB；模型序列化为 **JSON 版 OpenPRA-MEF**。值得注意：OpenPRA 的"协作"目前指基于角色/邀请的共享云模型（CASL 权限），**并无证据表明已实现 CRDT 式实时同步编辑**——这恰是本项目可差异化超越之处。

---

## Recommendations（分阶段建议）

**阶段 0：架构与数据模型（先做对）**
- 以单一节点-边数据模型为 single source of truth，故障树视图与事件树视图都是其投影；从一开始就严格执行逻辑-数据分离（事件引用共享参数）。
- 序列化直接采用 Open-PSA MEF（XML）或其 JSON 等价物，确保与 SCRAM/Python 量化引擎及其他 PSA 工具互操作。基准线：能无损导入/导出一个含 CCF 组、转移门、链接事件树的中型模型。

**阶段 1：MVP 建模画布**
- 故障树用 **React Flow + Dagre（顶向下）** 自定义节点实现标准 FTA 符号；事件树用表格式组件（功能事件列 + 分支行）。实现拖放调色板、连线、属性检查器面板（右侧 inspector）、撤销重做（Zustand + zundo）。
- 实时校验高亮：循环逻辑、未连接节点、未定义参数。
- 触发升级阈值：当单树节点数稳定超过约 500、或缩放卡顿时，引入 onlyRenderVisibleElements + LOD；若仍不足，评估迁移渲染层到 Canvas（AntV X6 或 GoJS）。

**阶段 2：参数库与 CCF**
- 用 **AG Grid** 建参数库（λ/PFD/MTTR/T/任务时间/分布/误差因子 + 数据源/版本字段），支持批量编辑、共享参数引用、导入导出。
- CCF 组管理 UI：选模型（Beta/MGL/Alpha）、输入参数、在树图框选事件入组。

**阶段 3：量化结果可视化**
- MCS 表（AG Grid，排序/过滤/贡献条）+ 图上割集回溯高亮（仿 CutSetTracer）；重要度用 ECharts 龙卷风/条形图 + 树节点热力着色；蒙特卡洛直方图与百分位。

**阶段 4：QA、差异与协作**
- 模型版本快照 + 结构化图 diff（并排 + 着色，仿 Model Compare）；审计日志、未审查变更标记。
- 用 **Yjs** 实现实时多人协作（awareness 光标/选区）+ 离线合并——这是相对成熟商业工具的差异化优势。基准线：两人同时编辑同一故障树不产生冲突、可离线后合并。

**改变建议的触发条件（阈值）**
- 若团队无 React 经验或需 Vue/Angular：选 **AntV X6**（框架无关，内置布局/minimap/历史，省去自配布局）。
- 若预算允许且要最快拿到全功能（自带故障树示例、TreeLayout、overview、折叠）：选 **GoJS**（商业授权，个人版约 $3,495/年）。
- 若单模型节点数将达数万：渲染层用 WebGL（Cytoscape.js WebGL 或 Sigma.js 类方案），放弃纯 DOM。

---

## Caveats（注意事项）

- **版本/能力时效性**：React Flow、AntV X6、Apache ECharts（6.0.0 于 2025 年发布，6.1.0 于 2026-05-19 发布）、Cytoscape.js（2025 年起 WebGL 预览）、AG Grid 等库版本迭代快，本报告所述版本与能力可能滞后于其当前状态，落地前须核实最新文档与许可条款。
- **许可风险**：GoJS、JointJS+、AG Grid 企业版为商业授权，需评估按用户/分发的成本；React Flow、AntV X6、Cytoscape.js、TanStack Table、ECharts、Yjs 为开源（多为 MIT/Apache），但 React Flow 部分高级组件（Pro）付费。
- **OpenPRA 细节未尽核实**：其具体自动布局库（Dagre/ELK/d3）、图表库未能从公开文档完全确认；"Zustand"虽经 React Flow 官方文档间接确认（React Flow 内部即用 Zustand），但 OpenPRA 是否另行直接依赖 Zustand 未逐字证实。
- **成熟工具 UI 一手资料有限**：RiskSpectrum、CAFTA 的界面细节多来自厂商营销页与较旧的用户手册（CAFTA 2.0 手册、SAPHIRE FEP 手册），部分截图级交互细节无法完全核实；厂商页含营销措辞（如"直观""最先进"），应批判看待。
- **本报告聚焦 UI/UX 与前端实现**，不覆盖 PSA 方法论与量化数学（如 BDD 算法、MCUB 近似、重要度公式推导），这些由用户另行处理。
- **BESS 热失控 QRA 的领域适配**：标准核电 PSA 范式可迁移，但热失控的时序/扩散动态、气体/温度连续量、屏障部分有效等可能需要在二叉事件树之外补充建模手段，纯静态 FT/ET 可能偏保守。
- **CRDT 选型**：Yjs 仍是 Web 端主流且自称最快，但 2026 年 Rust 系 Loro 在部分基准已超越 Yjs，若协作为核心诉求可一并评估。