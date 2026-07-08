# BESS PSA 工具 — 路线图与交接文档

*更新:2026-07-07 · 分支 `main` · 主平台 macOS(`~/Documents/projects/PSA_BESS`,Git 仓库);Windows `D:\PSA_BESS` 为遗留基线*

一套面向储能(BESS)热失控的 SOTA 概率安全评价(PSA/QRA)工具,三层:**引擎**(`psaengine/`)+ **领域应用**(`bess/`)+ **Web 前端**(`backend/` FastAPI + `frontend/` React)。蓝图来自目录里三个技能:`bess-tr-event-tree`、`fta-eta-quantification-engine`、`etafta-frontend`。

---

## 0. 2026-07-07 最新基线(macOS 主平台 · Phase 0 奠基)

- **平台切换**:macOS 成为主开发平台;本目录初始化全新 Git 仓库(分支 `main`,基线 commit `ba01b12` 为 Windows 迁移快照)。**遗留资产迁移待办(仅用户可在 Windows 机上完成)**:① 拷回 `D:\PSA_BESS\.git`(本 ROADMAP 引用的历史 feat/* 分支只存在于那里;拷回后作归档仓库保存即可,无需合并);② 拷回 `D:\ETA_claude\eta-tool\src\data\templates.ts`(「模板/场景库」迁移的前置输入);③ 在 GitHub 创建远程仓库并 push,CI 才会开始运行。
- **工具链(全部用户级安装,无 sudo/brew)**:uv → Python 3.12.13 `.venv` + editable install;nvm → Node 20.20.2(原 `frontend/node_modules` 为 Windows 二进制,已 `npm ci` 重建);新增 `Makefile` 为 macOS 日常入口(`make setup/test/benchmark/check/backend/frontend/run/bundle`),`run.ps1` 保留为 Windows 遗留。nvm 安装脚本已按官方默认在 `~/.zshrc` 追加初始化行。
- **本机验证(2026-07-07)**:Python 156 通过、2 跳过(12.7s;跳过为 CUDD,留待 Linux CI);benchmark 24 通过(25s);前端 vitest 165 通过(2s);`tsc -b && vite build` 通过(仍有 >500kB chunk 警告,已知问题)。
- **CI(`.github/workflows/ci.yml`,push 后生效)**:四个 job——Python 测试;**benchmark 常态回归门**(从按需运行升级为每次推送必跑的门禁);CUDD parity(Linux 编译 `dd.cudd`,补上 ROADMAP 待办 D 的验证缺口,初期 `continue-on-error`,跑通后收紧);前端测试+构建(Node 20)。
- **预览**:重建 `.claude/launch.json`(backend :8000 / frontend :5173,uvicorn 走 `.venv`)。
- **AI 模型策略**:新增 `docs/design/ai-model-strategy.md`——开发面(各 Phase 用模分层:Fable 5 只用于 ADR/引擎数学/安全关键评审,Opus 4.8 为实现主力,Sonnet 5/Haiku 4.5 递降)与产品面(AI 生成 ETA/FTA:Fable 5 起草 + refusal fallback 到 Opus 4.8、Sonnet 5 解释性表面、Haiku 微任务、**确定性校验不走模型**、Batch API 评测门、模型版本/工具调用留痕入分析档案)。Phase 2 的 AI 管线 ADR 在此基础上细化。
- **下一步**:Phase 1 —— `.claude/` 技能/代理结构(CLAUDE.md、领域技能迁移改写、流程技能、三个 agent 定义)。

---

### 0.1 上一基线:2026-06-30(Windows,历史记录)

- **目录与环境**:`D:\PSA_BESS` 是唯一有效工作区;`D:\PSA_Opus_Chatgpt` 已做目录联接指向 `D:\PSA_BESS`。Python 运行依赖和测试依赖已写入 `pyproject.toml`;`.venv` 已按 editable install 指向本项目。
- **项目文件一致性**:项目 payload v2 已覆盖 ETA 页签、活动页、勾选集合、用户自建 FTA、FMEA 行数据和 FMEA 映射配置。保存、另存、导出、打开和导入均走统一 payload 构造/恢复流程。
- **FMEA 工作台**:`FmeaWorkbench` 支持受控 `rows/mapping`;App 统一把 FMEA 状态持久化到 localStorage,同时随 `.psaproj.json` 项目文件迁移。旧项目文件缺少 FMEA 字段时保持兼容。
- **中文编码/展示**:源码与文档按 UTF-8 保存;FastAPI 默认 JSON 响应显式声明 `application/json; charset=utf-8`,避免 Windows PowerShell 等客户端把中文 JSON 显示为乱码。CSV 报告已继续使用 `text/csv; charset=utf-8`。
- **验证口径**:常规收口命令为 `git diff --check`、`npm --prefix frontend run test`、`npm --prefix frontend run build`、`.\.venv\Scripts\python.exe -m pytest -q --ignore=tests/benchmark`。benchmark 套件单独按需运行。
- **已知提醒**:Vite 仍有主 chunk 大于 500 kB 的体积警告;FastAPI TestClient 仍有 Starlette/httpx deprecation warning;`dd.autoref` 在 Windows 下可能打印析构 warning;CUDD 完整验证仍建议放到 Linux/WSL。
- **下一优先级**:迁移 `D:\ETA_claude\eta-tool\src\data\templates.ts` 的 ETA 模板,补齐模板/场景库能力;随后再做 benchmark regression 常态化、参考数据来源校核、CUDD 大规模验证和前端拆包。

---

## 1. 现状快照(已完成)

**引擎 `psaengine/`(Phase 1 + 1.5)**
- 模型层(PDAG / 参数 / 故障树 / 事件树 / CCF / MEF 对齐 JSON);预处理(常量传播 / coalescing / k-of-n / CCF 展开)。
- 平凡 ROBDD 内核(ITE + 唯一表 + 计算表;**不用补边** — 计划草图的补边方案有终端/LSB 冲突 bug)。
- 精确 Shannon 概率(默认)+ REA/MCUB;ZBDD 割集 + 截断;重要度(Birnbaum/FV/RAW/RRW/DIM);蒙特卡洛不确定性 + 龙卷风;事件树序列定量(**成功分支精确否定**)。
- Phase 1.5:Open-PSA MEF **XML** 读写、独立 MOCUS、截断误差估计(ΔP_k)、Dutuit-Rauzy 模块化、非相干**素蕴涵**(Coudert-Madre)、beta 因子 **CCF 接入 Analysis**(`preprocess/ccf_expand.py`)。
- 正确性背书:解析解 + 不变量 + 属性测试(vs 暴力真值表)+ `dd` 库对拍(1e-12),纯 Python 无运行时编译依赖。
- **外部基准对标(2026-06-24,分支 `feat/engine-benchmark-validation`)**:`tests/benchmark/` 用 17 个标准 PSA 基准对标精确顶概率/MCS 数——3 个闭式锚点(`voting_2of3`/`bridge`/`shared_event`,≤1e-16)+ 14 个命名基准,参考值取自 **SCRAM 同行工具 test 断言 + OpenFTA 报告**(pinned commit b85b789),含真实 Aralia 基准 `chinese`/`baobab1`/`cea9601`(精确 BDD 规模验证至 201 门/186 BE),全部在公布精度内。复现:`.venv/Scripts/python.exe -m pytest tests/benchmark`;报告 `docs/benchmark/engine-benchmark-validation.md`;spec/plan `docs/superpowers/{specs,plans}/2026-06-2{3,4}-engine-benchmark-validation*`。

**领域 `bess/`**:热失控级联事件树(数据驱动自 `bess/tr_model_data.json`,源自技能)→ C1–C5 频率 + 不确定性带 + 屏障重要度。
- **预置参考库**(`bess/reference_data.json` + `library.py`):器件基础失效率 / 防护措施有效性 PFD / 初因频率,每条带 `source.citation` + `grade`(C/D)+ 可选 `url`,`GET /api/bess/library`。**已并入 `D:/ETA_claude` 内置库**(2026-06-21):屏障 43 条 / 器件 15 条(SIL/LOPA/NFPA 分型/细水雾/浸没/电芯老化分档/多初因器件等);前端「参考库」三表 + 置信列 + 来源链接。
- **多场景 ETA**(`bess/scenarios.json` + `scenarios.py`):5 个内置事件树(内短/过充/液冷/外火/机械进水),`GET /api/bess/scenarios`、`/api/bess/event-tree?scenario=`。
- **FTA 挂载在 ETA**:屏障可挂真故障树(B_BMS=传感∨逻辑∨接触器拒动;离气联动与 BMS 共享接触器拒动基本事件),引擎精确否定使共享事件下序列频率 ≠ 独立积式。
- **风险矩阵**(前端 `riskmatrix.ts` + `RiskMatrix.tsx`):**6×5 中电联安全矩阵**(对齐 `D:/ETA_claude`:6 频率档 频发…几乎不可能 × 5 严重度 无事故…电站起火,单元 A/B/C 区域子等级 + 最终评价);后果映射 C1→I/C2→II/C3→III/C4·C5→IV。仅在「多 ETA 汇总」展示(ETA 单树侧栏已移除后果频率/风险矩阵,深化分析精简为屏障 FV/RAW 重要度)。
- **ETA 为中心(2026-06-21 迭代)**:ETA 作主页(默认首标签、加载即显示);ETA 下拉含 5 预置 + 「新建 ETA」(自定义,内存态);**每个屏障可挂载/编辑故障树**(`BarrierFtModal` 全屏模态复用 `FaultTreeCanvas/Palette/Inspector`),其顶事件概率经 `/api/quantify` 自动作为该屏障 PFD(有效性=1−PFD);`FuncEvent.linkFt` + 第二个 `useModel` 持 `fts`。
- **深化 QRA(2026-06-21)**:`psaengine/eta/sequence.py` 抽 `_build_event_tree`(BDD 建一次)+ `quantify_event_tree(fe_overrides=)`;`psaengine/eta/uncertainty.py`:`event_tree_uncertainty`(蒙特卡洛只重采样概率 → C1–C5 的 p05/p50/p95)+ `barrier_importance_exact`(扰动法屏障级 FV/RAW,按后果)。`POST /api/event-tree/{uncertainty,importance}`;前端「深化分析」按钮 → 带表 + 条形图误差棒 + 按后果 FV/RAW 表。
- **持久化(2026-06-21)**:`backend/storage.py` 把 ETA 工作台(`etModel`+各屏障 `fts`+名称)当不透明 JSON 命名存档于 `saved/*.json`(gitignore);`/api/saved` 存/列/读/删;前端工具栏 保存/存档下拉/删除,加载即恢复并重算 PFD。
- **报告导出(2026-06-21)**:`backend/report_export.py`(python-docx/reportlab/csv)由当前 ETA 重算生成 Word/PDF/CSV——后果频率(点+p05/p50/p95)、彩色风险矩阵、屏障 FV/RAW、嵌入事件树图(前端 `svgToPng` 上传)、免责声明;PDF 用内置 `STSong-Light` CJK 字体。`POST /api/report?format=`;前端「导出报告」三按钮下载。
- **库驱动编辑(2026-06-21)**:`LibPicker` + `addBarrierFromLib`(eventtree)/`addBasicFromLib`(model);ETA「从库加屏障」(barrier_effectiveness → 功能事件带 PFD+来源)、故障树标签与模态「从库加基本事件」(component_failure_rates → 基本事件带 rate+来源,单位入 source 标注不擅自换算)。
- **ROADMAP E 小项(2026-06-21,全部完成)**:① ETA 事件树 undo/redo(`useModel`→泛化 `useHistory<T>`);② 故障树基本事件按 FV 重要度**热力着色**(可开关);③ 事件树图一键导出 **PNG/SVG**;④ UI 内 **MEF/Open-PSA XML 导入**(`POST /api/import/mef` 复用 `load_mef_xml`);⑤ 故障树**手动拖拽位置会话内持久化**(`layoutFaultTree` 位置覆盖 + `onNodeDragStop` + 重置布局)。
- **多 ETA 汇总(2026-06-21)**:ETA 标签「多 ETA 汇总」折叠面板,勾选多个 ETA(默认/预置/自定义/存档)并行取后果频率,按 C1–C5 **求和**汇总到一张风险矩阵(全站总风险)+ 贡献明细表;复用 `RiskMatrix`。
- **ETA 灵活分支(2026-06-22)**:事件树分支改为「有序可跳过」—— `EtNode` 分支显式记 `feId`,选中叶可继续到**任意更靠后**屏障(跳过中间者),`layout`/`toEngineRequest` 按 feId 定列/出子集路径(引擎 `quantify_event_tree` 本就逐 `path` 处理,新增守护测试 `tests/test_event_tree_skip.py`);**屏障可删除**(未引用直删,被引用确认后折叠为末态、取子树最严重后果);**初始事件布局修复**(`LEFT` 加宽 + 截断长名 + `<title>` 悬浮,消除与首屏障列重叠)。旧存档经 `normalizeEta` 补 feId 兼容。spec/plan:`docs/superpowers/{specs,plans}/2026-06-22-eta-flexible-branching*`。
- **进度**:用户 2026-06-21 指定的「深化 QRA → 持久化 → 报告导出 → 库驱动编辑」四项 + ROADMAP E 小项(除拖拽位置持久化)均已完成并 merge 入 main。

**Web 前端(Phase 2 + 迭代)**
- `backend/`:FastAPI 包装 psaengine(`/api/examples`、`/api/model/{id}`、`/api/quantify`、`/api/bess/thermal-runaway`、`/api/bess/event-tree`),静态托管 `frontend/dist`。
- `frontend/`:故障树**可编辑**(React Flow + 自定义 FTA 符号 + dagre + 调色板/属性面板/连线/删除/撤销重做)、**割集回溯**(点 MCS 高亮激活路径)、**AG Grid 参数库 + CCF 组 UI**、**事件树可编辑**(`EventTreeEditor`,**直角连接器**、成功分支可续接屏障、改后果/PFD/加屏障)、结果可视化(自写 `EChart` 直接调 echarts)。
- **ETA/FTA 建模增强(2026-06-24,分支 `feat/eta-fta-modeling-enhancements`)**:① 初始事件频率三来源(手工/FTA `__init__`/产品维度 电芯数×失效率)② 后果页签(叶绑定具体后果条目,一级多条)③ FTA 页左栏列 ETA 挂载 FTA 可编辑联动 ④ FTA 中间事件(门带描述)⑤ 产品维度 cell→初因映射。spec/plan:`docs/superpowers/{specs,plans}/2026-06-24-eta-fta-modeling-enhancements*`。
- **ETA 编辑器交互(2026-06-24,分支 `feat/eta-editor-interactions`)**:分支节点完整屏障检视器(改名/PFD/挂载FTA/重新指派 setBranchFe(有序不变式守护)/删除)+ 成功·失败分支条件概率(1−PFD / PFD)。撤销/重做本就具备。spec/plan `docs/superpowers/{specs,plans}/2026-06-24-eta-editor-interactions*`
- **ETA 易用性 + 项目文件 + 可编辑参考库(2026-06-24,分支 `feat/eta-ux-and-editable-library`)**:① ETA 页签名跟随初始事件名(实时刷新,可双击改名覆盖,`renamed` 持久化)② 删除 ETA(页签 ✕ + 确认,删活动页切相邻,末个禁删)③ 项目文件导出/导入(`projectFile.ts` 信封 `bess-psa-project`,保留原快速存档,离线可用)④ 参考库可编辑/可扩展(`libraryStore.ts` localStorage 覆盖层叠加内置基线,三段增删改 + 导出/导入/恢复内置,有效库经 `applyOverlay` 全站生效,库可随项目文件迁移)⑤ FTA 侧栏按 ETA 分组(组标题=ETA 显示名)。多 agent 实现(W2/W3 模块并行 → W1 集成);前端 57 测试绿 + 后端 169 绿;重建 `bess-eta-standalone.html`。spec/plan `docs/superpowers/{specs,plans}/2026-06-24-eta-ux-files-and-editable-library*`
- **ETA 屏障次序调整 + 屏障名中文(2026-06-24,分支 `feat/eta-barrier-reorder-cn-names`)**:① 屏障列表 ↑/↓ 调整次序(`reorderFe` 按新次序重建级联,后果按深度保留、屏障属性随屏障移动;`isCascade`/`cascadeConsequences` 守护;`id`/`feId` 稳定 → 挂载 FTA/`pfds`/序列化全兼容;非级联先确认规整)② 事件树列头突出可编辑中文 `label`(英文 `id` 退为小字次要)+ `addFe` 新屏障默认中文名「屏障N」;分支检视器/「继续到屏障」亦显示 `label`。**不改 `id`/初始事件名,引擎/MEF 契约不变**。多 agent(frontend-dev + code-reviewer)+ preview 实测(↓ 重排列序变、无误确认、列头中文、新屏障屏障N);前端 65 vitest 绿 + 后端 169 绿;重建 `bess-eta-standalone.html`。spec/plan `docs/superpowers/{specs,plans}/2026-06-24-eta-barrier-reorder-cn-names*`
- **ETA 工作台布局对齐 + 矩阵填空(2026-06-25,分支 `feat/eta-barrier-reorder-cn-names`)**:① 统一右栏宽 `SIDE_W=300`(末态序列表 ↔ 参与汇总 ETA 上下右缘对齐,检视器 356 一致右轨)修正先前 300/330/356 参差;② 风险矩阵 `section` 内并排 `RiskSummary` 卡填充原约 600px 空白(新纯函数 `riskmatrix.ts::riskSummary` 与 RiskMatrix 同口径:分区评价 A/B/C/各区计数/最严重后果/≥C4 累计;`RiskSummary.tsx` 复用现有样式)。**暂不改界面风格**,`RiskMatrix`/引擎/数据/状态不变。preview 实测对齐(右缘 1323≈1324)+ 摘要卡 636px 填充 + 显示「B 风险缓解·需控制」;前端 72 vitest 绿(+5 riskSummary)+ 后端 169 绿;重建 `bess-eta-standalone.html`。spec/plan `docs/superpowers/{specs,plans}/2026-06-25-eta-professional-layout*`
- **ETA 事故序列路径图(2026-06-25,分支 `feat/fta-standalone-and-quantify`)**:底部坞重排三栏 `[事故序列路径图 | 风险矩阵+摘要 | 参与汇总 ETA]`(树/底部 `flex 4.5:4`),新 `SequencePaths.tsx` 纯展示组件——每序列一行 `初因 →[屏障 ✓/✗ 中文名]→ 分级(0–IV)+ 频率`,按频率降序,点行联动事件树高亮(复用 `seqRows`/`gradeLabel`/`C_COLOR`/`psa-chip`,**无新纯函数、不改数据/引擎**)。preview 实测:底部三栏无溢出、7 序列行、首行=最高频 grade0、点击联动。前端 75 vitest + 后端 169 绿;重建 `bess-eta-standalone.html`。spec/plan `docs/superpowers/{specs,plans}/2026-06-25-eta-sequence-path-diagram*`
- **FTA 自建工作区 + 全目标量化(2026-06-25,分支 `feat/fta-standalone-and-quantify`)**:① **量化按钮 + 结果**(割集/FV 重要度/热力)对**所有 FTA 目标**(示例/ETA 挂载/自建)开放——`onQuantify`/`onCutsetClick` 改走活动 `cvModel`/`cvFtName` 并下移到 cv* 之后(原写死 `model`/`ftName` 且仅 `!ftIsEta` 显示);② **自建 FTA 工作区**:新纯函数 `model.ts::addFaultTree`/`deleteFaultTree`(OR 门+基本事件起始树,name 去重,uid 干净节点 id,删树清独占参数),App 增 `userFts`(一份模型多棵树)+ `ftEditTarget` 第三态 `standalone` + `cv*` 三路由;侧栏「自建 FTA」分组 + ＋新增/✕删除;③ **持久化** `ProjectPayload.userFts`(serialize/deserialize,旧存档缺省空,`projectFile.ts` 不改),保存/读取/导出导入并入。**不改 id/feId/引擎/MEF**。多 agent(frontend-dev + code-reviewer);preview 实测:自建 FTA 分组+新增按钮、新建树渲染 2 节点、量化出结果无错、重置布局对自建隐藏。前端 84 vitest(+addFaultTree 6 +userFts 3)+ 后端 169 绿;重建 `bess-eta-standalone.html`。spec/plan `docs/superpowers/{specs,plans}/2026-06-25-fta-standalone-and-quantify*`
- **ETA 布局可调 + 事件树冻结表头(2026-06-25,分支 `feat/eta-layout-resizers-frozen-header`)**:① 底栏宽度 事故序列路径图 `flex 1.6→1`、风险矩阵 `1→2`(矩阵更宽),矩阵列内 `RiskMatrix`/`RiskSummary` 由并排改**竖排**(摘要不再被挤窄、无横向溢出,`RiskSummary` 根 `borderLeft→borderTop`);② **竖向分隔条** `.psa-vsplit`:拖拽改事件树画布高度(`treeH` 固定 px、底部坞 flex 自适应变矮),双击复位;③ **横向分隔条** `.psa-hsplit`:左右拖拽改风险矩阵区宽度(`seqW` 固定事故序列列宽、矩阵自适应),双击复位;④ **事件树冻结表头**:画布外层 `relative` + 滚动层 `absolute inset:0` + 顶部不透明表头层,纵向下滑时屏障列头(事件序列)固定可视、横向滚动经 `headerSvgRef` 直接改 `transform` 与列同步(免重渲染);表头文字抽 `renderColumnHeadings()` 在主 SVG 与表头层各渲一次,**主 SVG 仍含表头 → 导出不受影响**。拖拽均直接改 DOM、松手提交 state。**不改 id/feId/引擎/MEF**;preview 实测(竖拖 345↔479、横拖矩阵 416↔676、冻结表头纵向固定 + 横向 `translateX` 同步)、前端 85 vitest 绿、`tsc -b` + `vite build` 通过;重建 `bess-eta-standalone.html`。
- **FTA 页签项目保存(2026-06-26,分支 `feat/fta-tab-save`)**:FTA 工具栏末尾加「保存项目 / 导出文件」两个按钮,复用 ETA ribbon 现有 `onSaveWorkspace` / `onExportFile`(纯 UI 接线,无新 state / 引擎 / 序列化改动);`serializeProject` 本就含 `userFts`,故在 FTA 页保存即把自建故障树随整个项目存档/导出。preview 实测:FTA 页两按钮 enabled、点「保存项目」触发 `POST /api/saved`(stub 验证未写真存档);前端 85 vitest 绿、`tsc -b` + `vite build` 通过。
- **ETA_claude 参考库迁移(2026-06-26,分支 `feat/migrate-eta-claude-library`)**:把 `D:\ETA_claude/eta-tool/src/data` 的 `components.ts`(41)+ `barriers.ts`(48)迁入 `bess/reference_data.json`,按 id 去重后新增 **31 器件(15→46)+ 15 屏障(43→58)**;schema 映射 `failureMode→failure_mode`、**`successProb→pfd=1−successProb`**、`applicability→source.note`、丢 `origin`。**多 agent 工作流**:2 个 general-purpose 并行只读产出 → 编排器合并(`scratchpad/merge_refdata.py` 保留文件行尾 + 紧凑格式,diff +48/−2)。重生成离线 `embeddedData.ts`(`capture-data.mjs`)并重打包 `bess-eta-standalone.html`(单文件离线亦含新库)。验证:`library.py` 加载 46/58、后端 pytest 169 passed、前端 85 vitest、`tsc -b` + `vite build` 通过。**模板(templates.ts)未迁**。**后续语义去重(2026-06-26)**:删 12 条迁移近重复(保留 PSA 原生 `CFR_*`/`B_*`——经核 migrated id 仅见于 docs/skills,引用安全;`test_library` 仍守 `B_OFFGAS/B_BMS/B_THERMAL/B_DEFLAG/B_SPACING/B_RESPONSE`)、BMS/PCS/液冷改年化 `/unit·yr` 值、`B_RESPONSE`→active/0.30、`CFR_CELL_TR`/`B_AI_WARN`/`B_THERMAL` 并入更详 note;**器件 46→41、屏障 58→51**;两数组重排为单行/条。验证:`library.py` 41/51、后端 pytest 169 passed、前端 85 vitest、重生成 `embeddedData.ts` + 重打包。`templates.ts` 模板迁移仍待评估。
- **参考库置信分级 A/B/C/D 标签 UX(2026-06-26,分支 `feat/reflib-grade-tagging`)**:`ReferenceLibrary.tsx` 中 `grade/置信` 列由自由文本改为**彩色 A/B/C/D 下拉**(A 项目实测·B 厂商·C 行业统计·D 文献推断,语义 tooltip;绿/蓝/琥珀/灰),新屏障默认 D;顶部加**置信分级图例 + 按级筛选**芯片(关 D 实测 97→37 行,IE 无 grade 不受影响),表头计数显示「筛后/总」。手动增删改本就有(`libraryStore` 覆盖层)。preview 实测 92 个 grade 下拉、筛选生效、无 console 错误;`tsc -b`+`vite build`+前端 85 vitest 通过。下一步 #2「现场贝叶斯更新 PFD」入口拟放参考库屏障行(主)+ ETA 屏障检视器(次)。
- **参考库·现场贝叶斯更新 PFD(2026-06-26,分支 `feat/reflib-field-bayes`)**:新 `frontend/src/bayes.ts`(纯前端、离线)——`betai`(NR 连分式正则化不完全 Beta)+ `betaQuantile`(二分反函数)+ `posteriorPfd`(Beta-二项:先验=当前 PFD·强度 n₀ 或 Jeffreys;数据 N 次需求 k 次失败 → 后验 Beta(a0+k,b0+N−k);返回均值/90%/95% 上限)。`bayes.test.ts` 10 例(黄金锚点 `betaQuantile(0.9,1,22)≈0.0994`、betai/分位互逆、后验不变量)。`ReferenceLibrary` 屏障行加「现场更新」按钮 → 弹层(N/k/先验/n₀ → 后验均值·90/95%上限·Beta 参数)→「采用后验均值/95%上限」写回 `pfd`、`grade→A`、`source.note` 追加证据链。preview 实测:B_OFFGAS(0.01,n₀2)N=22 k=0 → 均值 8.333e-4、采用后该行置信变 A、弹层关闭、0 错误。`tsc -b`+`vite build`+前端 **95 vitest**(+10 bayes)。器件 rate / IE freq 的 Poisson-Gamma 更新与 ETA 屏障检视器就地入口为后续。
- **ETA 内联现场贝叶斯 + 参考库探测维度 + Poisson-Gamma(2026-06-27,多 agent wave 1,隔离 worktree 并行)**:**②** `EventTreeEditor` 屏障检视器内嵌「现场更新 PFD」折叠面板(复用 `posteriorPfd`;`FuncEvent` 加 `grade?`/`evidence?` + 纯函数 `applyFieldUpdate`;`grade`/`evidence` 不入 `toEngineRequest`,MEF 契约不变)。**#4** `bayes.ts` 加 `posteriorRate`(Poisson-Gamma:先验 Gamma α0=rate·n₀/β0=n₀ 或 Jeffreys;数据 T 曝露 k 失效 → 后验 Gamma(α0+k,β0+T))+ `gammaQuantile`(NR `gammp`+二分,黄金锚点 `gammaQuantile(0.9,1,1)≈2.302`);`api.ts` 加 `detection?{difficulty,silent,precursor}`;`ReferenceLibrary` 屏障表加探测维度列(探测难度 1–5 / 静默 / 前兆信号)+ 器件/初因行「现场更新」(Poisson-Gamma 弹层,采用写回 rate/freq_prior、grade→A、证据链);`reference_data.json` 15 条 warning 屏障补 `detection`。两 agent 文件不重叠并行 → 合并 main:build 通过、前端 **105 vitest**(②+2 / #4+8)、JSON 合法。**#3 FMEA 工作台(含 S×D 矩阵 + S/O/D↔ETA 映射)为 wave 2。**
- **#3 FMEA / RPN 工作台(2026-06-27,多 agent wave 2,分支 worktree)**:新标签「FMEA」(`App.tsx` tab `'fmea'`)+ `fmea.ts`(`FmeaRow{S,O,D∈1–10}`、`rpn=S×O×D`、`ap`(≥200 高 / 80–199 中 / <80 低)、`mustPrioritize`(S≥9)、`sxdCell`、可配置 `MAPPING`:`consequenceToS`/`freqToO`/`detectionToD`)+ `fmea.test.ts` 26 例 + `fmeaStore.ts`(localStorage `bess-eta:fmea:v1`)+ `FmeaWorkbench.tsx`(汇总卡 + S/O/D 可编辑表 + RPN/AP 上色 + S≥9 红标 + 从参考库导入 / 从当前 ETA 取数自动填 S/O/D + 导出 CSV + S×D 矩阵)。与 ETA(`layout`/`consLevel` 读末态)+ 参考库(rate→O、`detection`→D)联动;独立 localStorage 持久化、MEF 不变。合并 main:build 通过、前端 **131 vitest**(+26 fmea);preview 实测 FMEA 标签渲染(RPN/AP/S×D)、参考库探测列 + 97 个现场更新按钮、0 console 错误;重生成 `embeddedData.ts`(含 detection)+ 重打包 `bess-eta-standalone.html`(2.64MB)。**注**:某 worktree 的 `npm` 操作曾清空 main 的 `frontend/node_modules`,已 `npm install` 恢复(314 包,缓存命中)。
- **FMEA 映射可配置 + category→S(2026-06-27,分支 `feat/fmea-mapping-config`,单线内联)**:把 `fmea.ts` 的 `MAPPING`(对象+方法)重构为**数据化** `MappingConfig` + `DEFAULT_MAPPING` + 纯函数 `consequenceToS/freqToO/detectionToD/barrierS/componentS`(均取 `cfg` 形参);新 `mappingStore.ts`(localStorage `bess-eta:fmea-mapping:v1`,`applyOverlay` 叠加默认补全旧存档缺键,全局范围非项目文件)。**①** 「从参考库导入」按屏障 `category`(warning/active/passive→6/8/9,缺省 7)推断 S;器件库无 category → 可配置 `componentDefaultS`(6)。**ETA 回填更精细**:每个屏障(功能事件)行 S 取「该屏障失败分支可达末态的最重后果严重度」(无则按 category/缺省),叶节点行仍用精确 `consequenceToS`。**②** FMEA 标签新增可折叠「⚙ 映射配置」面板(5 组 22 输入:后果→S / 频率→O / 探测→D / 屏障类别→S / 器件缺省 S)+ 即时本地保存 + 「恢复默认」+ 「按映射重算导入行」(只重算 `lib-*`/`eta-*` 行的 S/O/D,保留手动行与名称,confirm 守门)。`MAPPING` 导出移除,所有调用点改函数式;`fmea.test.ts` 26→**36 例**(含 `barrierS`/`componentS`/乱序分档/`applyOverlay`)。验证:`tsc -b`+`vite build` 通过、前端 **141 vitest**、preview 实测面板渲染 + 库导入 S 按类别(passive 9/active 8/warning 6,器件 6)+ 面板改值持久化 + 重算仅动导入行(动态 import 证实模块仅导出 `DEFAULT_MAPPING`+5 函数、无 `MAPPING`)、0 真实 console 错误。MEF/后端不涉。**后续(同分支 `feat/freq-threshold-and-psa-docs`)**:频率分档**阈值也改为可编辑**(`FreqBinEditor`,text + 草稿缓冲,支持键入 `1e-3` 科学计数法,`onBlur` 提交;`freqToO` 已按 th 降序求解故乱序安全)——至此整个 `MappingConfig` 全部可在面板编辑;preview 实测(dispatch `focusout` 触发 onBlur)阈值改 `1e-1→4e-2` 后 `freqToO(0.05)=9 / freqToO(0.03)=7`。`templates.ts` 模板迁移仍待评估。

---

## 2. 如何运行 / 恢复

```powershell
# 测试(后端 85 绿)
.\.venv\Scripts\python.exe -m pytest -q

# 引擎 CLI
.\.venv\Scripts\python.exe -m psaengine.cli quantify examples\bess_bms_ft.json --fault-tree BMS --importance FV,RAW
.\.venv\Scripts\python.exe -m psaengine.cli bess --samples 5000 -o report.md

# Web 应用 → http://127.0.0.1:8000
.\run.ps1                              # 必要时自动构建前端
# 前端改代码后需重新构建:
npm run build --prefix frontend
```

---

## 3. 架构地图

```
psaengine/            通用 FTA/ETA 引擎(领域无关,纯 Python)
  model/   pdag·parameters·fault_tree·event_tree·ccf·model·json_io(load_model_from_dict)
  preprocess/  normalize·expand(CCF 概率)·modules(Dutuit-Rauzy)·ccf_expand(beta 接入)
  ordering/ heuristics(DFLM/WDFLM/RDFLM)
  bdd/      kernel(ROBDD+build_from_pdag)·zbdd
  quantify/ probability·cutsets·mocus·truncation·prime_implicants
  importance/measures   uncertainty/montecarlo   eta/sequence
  analysis.py(Analysis 门面;CCF 在此接入)   cli.py
bess/     tr_model·tr_model_data.json·consequences·report
backend/  app.py(FastAPI)·examples·schemas
frontend/src/
  model.ts(可编辑故障树模型+纯操作+activatedNodes 割集回溯)  useModel.ts(撤销/重做 reducer)
  eventtree.ts(可编辑二叉事件树模型+积式频率+直角布局)
  layout.ts(dagre)  api.ts
  components/ FaultTreeCanvas·nodes·Palette·Inspector·ResultsPanel·EChart·EventTreeEditor·ParamLibrary
  App.tsx(三标签:故障树 / 参数库·CCF / BESS 事件树)
tests/    unit·analytical·property·benchmark·cross·e2e·backend
docs/superpowers/  specs/ plans/ 本 ROADMAP.md
run.ps1   .claude/launch.json(预览)
```

---

## 4. 约定与已知坑

- **流程**:TDD(先写失败测试)、频繁提交(每任务一 commit,结尾 `Co-Authored-By: Claude Opus 4.8`)。
- **环境**:Node 20.12 → 必须 **Vite 5 / React 18 / echarts 5 / ag-grid 32**(不可用 Vite8/echarts6,rolldown/init 不兼容)。`pip` 写 `C:\Python312\Scripts\*.exe` 因权限失败 → fastapi/uvicorn 等装在 **`.venv`(--system-site-packages)**;引擎 CLI 用 `python -m psaengine.cli`(非 `bpsa`)。
- **前端验证**:`preview_screenshot` 对这个重前端包**超时**;用 `preview_eval` 查 DOM 核实交互(已成惯例)。
- **已做的偏离**:平凡 ROBDD(非补边);`echarts-for-react` 无法 init canvas → 自写 `EChart`;可编辑事件树用**前端积式频率**(独立屏障下=精确)。

---

## 5. 待办清单(按价值排序;每项可冷启动)

### A. 把可编辑事件树接回引擎精确定量 ✅ 已完成(2026-06-21)
- **目标**:`EventTreeEditor` 目前前端积式算频率(独立屏障精确);当功能事件链接到**共享基本事件**的故障树时,需引擎精确否定定量。
- **实现**:后端 `POST /api/event-tree/quantify`(`backend/et_builder.py` 复用 `load_model_from_dict` 构 `Model` → `quantify_event_tree`);前端 `eventtree.ts::toEngineRequest` 序列化 + `EventTreeEditor` 「引擎精确量化」按钮,差异高亮。
- **验收**:✅ `tests/backend/test_event_tree_quantify_api.py` — 含共享事件 X 的算例,精确 LL=0.109 ≠ 独立积式 0.0361;前端显示引擎精确值。

### B. 模型版本 diff(仿 RiskSpectrum Model Compare)
- **目标**:对比两个模型版本,着色显示新增/修改/删除的门、事件、参数。
- **位置**:前端纯函数 `diffModel(a: ModelJson, b: ModelJson)`(按节点 id 匹配)+ 一个 diff 视图(并排或在画布着色);可加"快照"按钮存当前 `model` 入历史。
- **验收**:改一个 PFD + 删一个节点后,diff 视图正确标出 1 改 + 1 删。

### C. Yjs 实时协作
- **目标**:多人同时编辑同一模型(CRDT)。
- **位置**:前端 `yjs` + `y-websocket`(或 `y-webrtc`),把 `model`/`etModel` 绑到 `Y.Doc`;后端起 y-websocket 中继(或独立进程)。`useModel` 需改造为基于 Y.Doc 的共享状态。
- **验收**:两浏览器编辑同一故障树不冲突、可离线合并;awareness 显示协作者光标/选区。
- **注**:调研报告提到 2026 年 Loro(Rust CRDT)在部分基准超 Yjs,可一并评估。

### D. 引擎 CUDD 后端(上万事件规模) 🟡 抽象+适配器已完成,CUDD 验证待 Linux(2026-06-21)
- **目标**:纯 Python ROBDD 在数百事件舒适;上万事件需 `dd.cudd`(CUDD)。
- **已完成**:① `BddManager` 暴露遍历协议(`is_terminal/terminal_value/top_var_index/cofactor/var_name`),`exact_probability` 改走协议(后端无关,104 测试不变);② `psaengine/bdd/dd_backend.py::DdBddManager` 包 `dd` 高层 API(`dd.autoref` / `dd.cudd` 接口一致);③ `make_manager(order, backend="python"|"autoref"|"cudd")` 工厂;④ `tests/test_dd_parity.py` 对拍。
- **本机验证**:`dd.autoref`(纯 Python)与内核顶值一致(含 k-of-n),**已实跑通过** → 证明适配器与协议逻辑正确;`dd.cudd` 因 Windows 无编译扩展 → **SKIPPED**。
- **待办(Linux/WSL)**:`pip install dd --install-option=--fetch --install-option=--cudd`(或源码 `setup.py --fetch --cudd`)后跑 `pytest tests/test_dd_parity.py`,`cudd` 用例应自动转为通过;再以万级事件模型压测。
- **注**:`dd.autoref` 在解释器关闭期会打印「nodes still referenced」断言(其 `__del__` 诊断,非测试失败),仅影响该验证后端。

### E. 小项(锦上添花)
- 事件树 undo/redo(故障树已有,`EventTreeEditor` 还没)。
- 手动拖拽节点位置持久化(目前每次结构编辑重跑 dagre 自动布局)。
- UI 内 MEF XML 导入(文件上传)+ 模型保存/加载(持久化编辑后的模型)。
- 故障树节点按 FV/RAW 重要度热力着色;结果导出(CSV/PNG/SVG)。

---

## 6. 参考文档
- 引擎设计/计划:`docs/superpowers/specs/2026-06-20-bess-psa-engine-design.md`、`docs/superpowers/plans/2026-06-20-bess-psa-engine.md`、`...-phase1.5.md`、`...-frontend-v1.md`。
- 领域/算法/对标调研:仓库根目录 `compass_artifact_*.md`、`RiskSpectrum_PSA_ETA_调研报告.docx`。
- 技能蓝图:`bess-tr-event-tree.skill`、`fta-eta-quantification-engine.skill`、`etafta-frontend.skill`。
