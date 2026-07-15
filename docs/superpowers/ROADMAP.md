# BESS PSA 工具 — 路线图与交接文档

*更新:2026-07-07 · 分支 `main` · 主平台 macOS(`~/Documents/projects/PSA_BESS`,Git 仓库);Windows `D:\PSA_BESS` 为遗留基线*

一套面向储能(BESS)热失控的 SOTA 概率安全评价(PSA/QRA)工具,三层:**引擎**(`psaengine/`)+ **领域应用**(`bess/`)+ **Web 前端**(`backend/` FastAPI + `frontend/` React)。蓝图来自目录里三个技能:`bess-tr-event-tree`、`fta-eta-quantification-engine`、`etafta-frontend`。

---

## 0. 2026-07-07 最新基线(macOS 主平台 · Phase 0 奠基)

- **平台切换**:macOS 成为主开发平台;本目录初始化全新 Git 仓库(分支 `main`,基线 commit `ba01b12` 为 Windows 迁移快照)。**遗留资产迁移**:① ✅ 已拷回原仓库(`git-archive repo/`,含全部历史 feat/* 分支,已 gitignore,作归档保存);② ✅ 已拷回前身模板 → `docs/reference-assets/templates-eta-claude.ts`(538 行 EventTree v2,「模板/场景库」迁移的前置输入);③ **仍待办**:在 GitHub 创建远程仓库并 push,CI 才会开始运行。
- **工具链(全部用户级安装,无 sudo/brew)**:uv → Python 3.12.13 `.venv` + editable install;nvm → Node 20.20.2(原 `frontend/node_modules` 为 Windows 二进制,已 `npm ci` 重建);新增 `Makefile` 为 macOS 日常入口(`make setup/test/benchmark/check/backend/frontend/run/bundle`),`run.ps1` 保留为 Windows 遗留。nvm 安装脚本已按官方默认在 `~/.zshrc` 追加初始化行。
- **本机验证(2026-07-07)**:Python 156 通过、2 跳过(12.7s;跳过为 CUDD,留待 Linux CI);benchmark 24 通过(25s);前端 vitest 165 通过(2s);`tsc -b && vite build` 通过(仍有 >500kB chunk 警告,已知问题)。
- **CI(`.github/workflows/ci.yml`,push 后生效)**:四个 job——Python 测试;**benchmark 常态回归门**(从按需运行升级为每次推送必跑的门禁);CUDD parity(Linux 编译 `dd.cudd`,补上 ROADMAP 待办 D 的验证缺口,初期 `continue-on-error`,跑通后收紧);前端测试+构建(Node 20)。
- **预览**:重建 `.claude/launch.json`(backend :8000 / frontend :5173,uvicorn 走 `.venv`)。
- **AI 模型策略**:新增 `docs/design/ai-model-strategy.md`——开发面(各 Phase 用模分层:Fable 5 只用于 ADR/引擎数学/安全关键评审,Opus 4.8 为实现主力,Sonnet 5/Haiku 4.5 递降)与产品面(AI 生成 ETA/FTA:Fable 5 起草 + refusal fallback 到 Opus 4.8、Sonnet 5 解释性表面、Haiku 微任务、**确定性校验不走模型**、Batch API 评测门、模型版本/工具调用留痕入分析档案)。Phase 2 的 AI 管线 ADR 在此基础上细化。
- **Phase 1(2026-07-08 完成)—— `.claude/` 技能/代理结构**:新增根 `CLAUDE.md`(已知约定:架构/命令/硬约束/流程/模型策略);`.claude/skills/` 13 个技能——**领域 4**:`bess-tr-model`(蓝图迁移+指向真实 `bess/` 数据文件)、`psa-engine`(从"如何写引擎"改写为"如何维护已验证引擎":真实架构/既定偏离/验证门,理论 references 保留)、`psa-frontend`(按真实代码全新撰写,蓝图 architecture 弃用)、`eta-reference-data`(合并 4 个 `.agents` 数据技能:当前机制+分级/口径/贝叶斯,原文带迁移横幅入 references);**流程 9**(Thariq“寻找未知”方法论落地):`blindspot-pass`/`interview-me`/`design-directions`/`reference-hunt`/`plan-feature`(沿用 specs+plans 命名)/`verify-psa`(分级验证门)/`change-quiz`(合并前数值抽查)/`riskspectrum-parity`(活对标台账:已达/超越 vs 差距排序)/`regulatory-traceability`(证据链清单)。`.claude/agents/` 3 个:`engine-reviewer`(fable,对抗性数值评审)、`frontend-dev`(sonnet,按规格实现)、`domain-reviewer`(fable,方法论/数据出处评审)。清理:删除空脚手架目录(`skills/ agents/ hooks/ mcp/ memory/`)、三个 `.skill` 蓝图归档至 `docs/skill-blueprints/`、`.agents/` 移除(内容已并入)。
- **Phase 2(2026-07-08 完成)—— 关键 ADR 三份 + 数据出处评审**:①**数据出处评审**(domain-reviewer 代理,`docs/reviews/2026-07-08-reference-data-provenance.md`):97 条逐条核查+8 项网络核验;要害发现——5 条初因频率**无单位无 grade**且推导链未落纸(全序列公共乘数)、B_OFFGAS 0.01 较 Sandia 实测族非保守 5–7 倍且与 SC_ISC 分解树自相矛盾、`scenarios.py` 4 个硬编码参数绕过库治理(接触器拒动 60 倍矛盾)、5 条厂商来源违规、B_DEFLAG 的 η=0.953 挂错屏障且量化器静默忽略;结论:演示/筛查可辩护,正式 QRA 今天过不了评审;Top-5 修正已立独立任务。②**ADR-1 统一 ProjectDocument**(`specs/2026-07-08-adr1-*`):现状盘点(6 表面/4 形状)+ 访谈定 D1 绞杀者迁移 / D2 边界(分析相关入档、纯视图态出档,checkedKeys→aggregate_scope)/ D3 MEF 对齐核心+工作台命名空间 / D4 UUID 身份+人读 ref+强制溯源块;骨架设计含规范序列化/哈希、验收含"quantify 逐位一致+MEF 投影等价"。③**ADR-2 存储/版本化/审计**(`specs/2026-07-08-adr2-*`):D5 单文件 SQLite(stdlib,零依赖)/ D6 保存即版本+分析自动钉扎;projects/versions/audit_log(只增触发器)/analysis_cases 四表;`/api/saved` 绞杀兼容;报告页脚带 case id+版本哈希+引擎版本。④**ADR-3 AI 生成管线**(`specs/2026-07-08-adr3-*`):D7 ghost-diff 逐元素接受;输出=规范模式片段(origin:'ai-draft'+grade D 强制);tool-use 接地(库检索/模板/语料,数值必引 uuid 或显式 ungrounded)+ 确定性校验修复环(schema→lint→引擎 dry-run,≤3 轮)+ ai_drafts 落库(model_id/prompt_version/served_by/tool_trace)+ 金例评测门(6 例,Batch API,换模型/提示词不得回退)。
- **Phase 3 设计(2026-07-08)**:前端结构评审(App.tsx 982 行/52 hooks;活动页签双真相、派生 PFD 回写纠缠、副作用内联)→ 重构蓝图 `specs/2026-07-08-phase3-frontend-refactor-design.md`(projectStore/viewStore/derivedStore 三分、六步渐进、canonical 切换点预留);**外壳/IA 经 4 个 mockup(`docs/design/mockups/2026-07-08-shell-{a,b,c,d}.html`)访谈选定:C 画布至上为主体 + A 项目树抽屉 + B 驾驶舱落地页 + D 证据文档报告页**(决策记录在蓝图内)。实施当时受控暂缓,后经用户解禁。
- **ADR-1 实现(2026-07-08,commit eb9a99e)**:`backend/canonical/` 落地——严格 Pydantic 模式(additionalProperties:false 全树)、确定性 uuid5 身份(同内容同哈希,ADR-2 幂等前提)、payload-v2 ↔ canonical **无损互转**(绞杀者 sidecar:view/derived/passthrough 在位标记)、规范序列化+剥易变字段哈希、canonical→引擎请求(镜像 toEngineRequest);`GET /api/schema/project-document/1.0`。验收:真实存档+富合成例逐字段 round-trip、引擎请求与手写请求逐字段相等且 quantify 逐位一致(共享事件 0.109 锚)、5 场景全部转换+校验+round-trip、哈希确定且时间戳不变式。py 165(+9)。
- **数据出处 Top-5 修正(2026-07-08,评审第六节'修正后'含前→后全表)**:IE×5 补 unit(/unit·yr)/grade(D)/推导链与 F9 互引;**B_OFFGAS 0.01/C → 0.05/D 重锚 Sandia JES 2024**;`scenarios.py` 四硬编码收编入库(新条目 CFR_BMS_SENSOR/CFR_BMS_LOGIC/CFR_OFFGAS_DET,接触器归 CFR_CONTACTOR 1e-3——60× 矛盾解除,余量显式归逻辑档;B_BMS 分解 ≈0.099、offgas ≈0.05 跨场景一致);η=0.953 从 B_DEFLAG 移至 B_SUPPRESS 备三结果建模(未建模方向声明);厂商引用 5 处清理(Honeywell→Sandia 第三方);C→D 诚实化 9 条(库 100 条:C 22 / D 78)。守护测试 +3(IE 治理/分解参数入库/OFFGAS 锚+eff 移除);py **168** passed、vitest 165、`make bundle` 重建(2.67MB)。遗留 F8/F11/F12/F13/F15 随 ADR-2 数据 pedigree 附录落实。
- **ADR-2 实现(2026-07-08,commit 4488235)**:`backend/store.py` 落地——单文件 stdlib SQLite(`data/projects.db`,WAL,gitignore)四表:projects / **内容哈希幂等版本**(同哈希返旧、parent 链;canonical_json+sidecar_json 成对存,**经库往返逐字段无损**已测)/ **audit_log 只增**(无改写代码路径 + RAISE(ABORT) 触发器,属性测试拒改写)/ analysis_cases(绑定 version_id NOT NULL)。绞杀者接线:`/api/saved` 双写(旧行为不变,非 v2 载荷静默跳过,响应新增 `version` 键);sid→项目 uuid 走 uuid5 恒等映射;`backend/import_legacy.py` 一次性导入(pre-v2 按前端语义包裹,幂等)且**真实存档已导入**(1 项目 1 版本);只读面 `GET /api/projects{,/versions,/versions/{id},/audit,/cases}`。**证据链**:`ReportRequest` 可选 `project_uuid+project_payload` → auto_pin 版本 + 分析案例(settings/results/事后 artifacts 含报告 sha256)→ 三格式页脚「分析案例 # · 版本哈希8 · 引擎版本」;审计 report.export。测试 +9(conftest 逐测隔离 db),py **177** passed / 2 skipped。**范围注**:uncertainty/importance 钉扎与读路径切版本库随 Phase 3 前端接线;diff 端点归 parity #5。
- **Phase 3 实现完成(2026-07-09,commits 94a83d4→ab78977,六步各一提交)**:①**viewStore**(zustand 新依赖):tab/ftEditTarget/selected/heatOn/treeH/seqW 出组件,布局子集 persist localStorage(ADR-1 D2 前端落点)。②**persistence 出组件**:`features/persistence/{scenarioLoader,projectIo}` 可单测(mock api),App 处理器瘦身。③**projectStore 统一(双真相删除)**:全部 ETA + userFts 单一来源、**文档级单历史**;`snapshotActive` 与跨页签三元清零(grep 验收);复合编辑(attachFt/AI 应用/复制)= 单条历史;ETA 删除变可撤销。④**derived 分离(L425 之坑消解)**:`stores/derived.ts` compose(内容×pfds 缓存→展示/引擎/序列化)+ stripDerived(回写剥离 linkFt failProb 与 FT 源 initFreq);**pfds 缓存移出撤销历史**(store 顶层侧表,undo/redo 永不回滚派生值——蓝图验收测试在);detachFt/源切换时物化。⑤**编辑器拆分**:EventTreeEditor 837→268 行容器,`components/eta/{EtCanvas,EtInspector,EtKpiStrip,EtaSummaryList,types}` 纯拆分。⑥**复合外壳落地(C+A+B+D)**:App.tsx **180 行壳**(验收 ≤200);工作台入 `features/{fta,eta}/`,业务态入 hooks(`useProjectPersistence` 含 FMEA+证据上下文、`useAiDraft`、`useLibrary`、`useExampleModel` 跨页签保示例模型);**B 驾驶舱=总览落地页**(KPI 带/ETA 卡片/汇总矩阵/版本·案例活动流)、**D 证据文档=报告页**(案例/版本台账,哈希+引擎徽章,导出即钉扎)、**A 项目树抽屉**(persist)、**C ⌘K 命令板**。**报告钉扎接线**:`GET /api/saved/{sid}` 返回稳定 project_uuid(已测)→ 持久化 hook 捕获 → 导出请求带 `project_uuid+project_payload`。**preview_eval 全链冒烟实测**:驾驶舱落地→ETA 编辑器→引擎精确量化→FTA 页→抽屉/⌘K→保存(footer 现 uuid)→报告页 CSV 导出→**案例 #1 即时上台账**(后端核验:2 版本 auto_pin,case 绑 settings/results/artifacts sha256)。vitest **186**、py **202**、`make check` 绿、`make bundle` 重建(2.70MB)。**范围注**:uncertainty/importance 钉扎与读路径切版本库仍待(编辑器内不确定性入口在 EtInspector 深化时接);数字溯源气泡/ghost-diff 宿主已就位,随 ADR-3 实现。
- **Phase 4 双轨完成(2026-07-09,commits 77fad12→0c54f13 + 74e46a9,逐任务一提交)**:
  **(a)引擎 parity——账本缺口 #1–#6 本地侧全部关闭**(`.claude/skills/riskspectrum-parity` 已把六行移入"达标"区,附证据与日期):
  ①**alpha/MGL/phi CCF 多层展开**(77fad12):reference-hunt 语义规格(NUREG/CR-5485 Tables 5-11/5-12,**SCRAM ccf_group.cc 源码当日核验**)→ `q_levels()` 公式唯一出处 + 全子集展开(beta 保留集总旧路径);错峰 alpha;手推数值锚 rel 1e-12 + 一致性恒等式 property(m 2–4 × 两方案)+ 2oo3 穷举==BDD;MEF define-CCF-group I/O(嵌套/无 level 顺次/staggered 经 attributes 无损);**ETA 合并 PDAG 上展开——跨屏障共享共因事件参与精确成功否定**;ET 请求与 toEngineRequest 透传;ParamLibrary 动态因子表单。**engine-reviewer 两轮**:首轮 FAIL(6 缺陷:嵌套组丢失 5.4× 低估、无标签因子层错配、staggered 往返丢失、Σα 无守卫、部分在场静默重归一、异质成员静默取首)→ 全修 + 编号锁定测试(`test_ccf_review_fixes.py`)→ 次轮 **PASS**(独立探针 26 查,成功分支×共享 CCF 事件树对穷举逐位)。
  ②**house 事件/边界条件集**(0f49626):命名 bc_sets + house_states 覆盖贯穿 quantify/ET/不确定性/重要度;副本上生效(模型本体不可被分析改写);未知目标响亮 400。
  ③**割集后处理**(24105ed):互斥组/删除/恢复规则**只作用于 MCS 列表**——精确 BDD 概率通道不动(守护测试),处理后列表给 REA/MCUB;恢复规则幂等。
  ④**分析案例纵深**(b26bd7b):不确定性/重要度运行带项目上下文即 auto-pin 版本+案例(kinds uncertainty/importance,审计 analysis.*)——Phase 3 范围注就此关闭。
  ⑤**模型 diff**(a4c17a4):canonical 版本结构化对比(列表按人读身份键对齐、易变字段剥离)+ 报告页版本对比区(默认最近两版,增/删/改徽章,preview 实测)。
  ⑥**CUDD 本地验证**(6d784d3):dd 0.6.0 `--fetch --cudd` 在 macOS arm64 编译成功;parity 测试从 SKIPPED 转实跑(套件 0 skipped);千级事件闭式锚;规模探针暴露真实缺陷——`exact_probability` 递归深度上限 → 改显式栈后序(基准 24/24 逐位不变);**评审附带发现并修复 dd 适配器补标记缺陷**(74e46a9:NOT/XOR/成功分支在 dd 后端曾静默出错——纯 Python 内核各交付路径不受影响;非相干对拍锁定)。CI Linux 任务仍待 GitHub 远程(账本 6b)。
  **(b)AI 管线(ADR-3 实现)**:
  ⑦**lint+接地+试运行+修复环**(0a4cfa1):`backend/canonical/lint.py` 确定性域规则(AI 自评 A/B=error、library_ref 未知=error、ungrounded=warning、环检测、id 卫生);`backend/ai_pipeline.py` AiClient 协议(AnthropicClient 钉 `claude-fable-5`+服务端回退 beta→opus-4.8,Legacy 单发包装)、`search_reference_library` 接地工具(真库,带 citation)、**引擎试运行**(草案不能量化就不能通过)、≤3 轮修复环;既有 9 AI 测试原样绿 + 6 FakeClient 管线测试。
  ⑧**ai_drafts 溯源表**(c7d1130):生成即落库(model_id/served_by/prompt_version/rounds/工具与修复轨迹/校验全文)+ ai.draft/ai.apply 审计 + 应用回执端点。
  ⑨**ghost-diff 逐元素接受(D7)**(61336d4):draftElements/filterDraftByAcceptance(拒屏障=delFe 折叠、拒树连独占参数剔除)、AiDraftPanel 幽灵清单(虚线半透明+划线拒绝+父子置灰)+ 溯源行、应用即回执。
  ⑩**金例评测门**(0c54f13):6 个 BESS 域金例 + 确定性 rubric(结构/可量化/接地声明/含糊必问)+ 本地 run_cases 走全管线 + **Batch API CLI**(`python -m backend.ai_eval submit|status|fetch`,custom_id 携带 PROMPT_VERSION 2026-07-09-p1)= 模型/提示词升级门。
  收口:py **239**(0 skipped)、fe **190**、benchmark 24/24、`make check` 绿、bundle 2.71MB;preview 实测版本对比与驾驶舱。
- **UX 报障收口(2026-07-10)**:①**默认 ETA 不显示/存档不加载**——早于本轮已在 `1d03d36` 修(bootstrap 竞态覆盖用户内容、静默失败死路、archive-select 回弹);本轮 preview 复验通过(总览落地即含 1 个引导 ETA、ETA 页直出树 55 文本节点/7 序列、无需「+」;存档下拉重载后可加载,footer 带项目 UUID)。②**新窗口加载慢**(`c893550`):根因 = dev server 首个请求触发 esbuild 依赖优化 + 整页刷新(~18s),且 ETA 关键路径**急切**导入 reactflow(≈1MB/FtaWorkbench)、ag-grid(≈900KB/ParamLibrary·FMEA)。修:`optimizeDeps.include` 启动即预打包(Vite ready 108ms、ETA 页 <100ms 出树);`React.lazy`+Suspense 拆分 FTA/参数库/参考库/FMEA/后果/报告/BarrierFtModal(ETA 关键路径仅 340KB 主块,reactflow/ag-grid 点击对应页签才拉);`bundle` 改 `--mode singlefile` 保离线内联(单块 2.71MB 不变)。preview 实测:8 页签均正常渲染、无 stuck、reactflow 点 FTA 才载(305ms)、无 console error。已知留存:FTA 三栏布局在 <~500px 视口会把 reactflow 画布挤成 0 宽(仅本工具窄预览窗可见;桌面 ≥1024px 画布 800px+ 正常)——非本改动引入,留待响应式扫尾。
- **Phase 4 收尾三缺口(2026-07-10)**:①**分析设置面板 UI**(4c1,`ef5b5d0`):FTA 工作台右列可折叠
  「分析设置」= house 覆盖(边界条件)+ 割集后处理规则(互斥/删除/恢复);`quantify()` 增可选 opts,
  ResultsPanel 加后处理段(removed/recovered + REA/MCUB,与精确顶值分列)。preview 实测:互斥规则删
  同现割集 1 条、REA 落 1.12e-2、**精确顶值 1.364e-2 不变**(卖点守护)。②**模板迁移**(4c2,`a6592f6`):
  前身 7 个 ETA 模板逐条迁入 `features/templates/etaTemplates.ts`+ converter +「从模板…」选择器;
  初因溯源(initSource/initGrade/initEvidence)两层贯通——EventTreeModel + 检视器显示 + **canonical 层写入
  频率参数 Provenance 块**(ADR-1 D4 正位,无损往返、参与哈希);模板带 consequences 建页即正确文字;
  可见免责横幅。**domain-reviewer 首轮 FAIL**(揪出我把 LOPA 模板**杜撰**成 4 屏障/改 SIL2 vent 0.01→0.1/
  C→D,自测因编码了杜撰值而漏检)→ 逐字复原 + 证据链两层修 + R1 展示路径修 → **复评 PASS**;缺陷#3
  (手改值不清置信快照)与开放问题④(模板 IE 频率与 scenarios 口径差)诚实留跟进。③**AI 上线联调**
  (4c3,`768aa1c`):管线离线全绿(FakeClient 端到端、门控、Batch 构建 6 例钉 claude-fable-5/
  PROMPT_VERSION 2026-07-09-p1),真模型首跑 + 金例 Batch 首提为**用户持 key 的运营步**,runbook 交付
  (`docs/design/ai-live-run-runbook.md`)。收口:fe vitest 全绿、py 240、`make check` 绿、bundle 2.73MB。
  账本缺口 #2(house/边界)/#3(后处理)UI 落地;#8 分析设置面板成形。
- **Phase 5 状态(2026-07-12 起)**:✅ **已全部完成**(见下方两条 2026-07-12 详细收口
  条目)——评审/签发工作流 + 认证层(本地账户/三角色/乐观并发/迁移)均已实施,
  约束 #0(单用户不降级)全程未破。**下一步**:**GitHub 远程仍待建**(CI 与 CUDD
  Linux 任务未激活;全部提交仍仅在本机,~60+ commits)——这是当前唯一的用户阻塞项;
  其余候选见 §5 待办清单(D 项 CUDD CI、Phase 6 候选:CRDT 实时并发/OIDC/项目级 ACL)。
  背景跟进:FTA 三栏响应式(task_bee07b95)、手改值清置信快照含 IE 字段(task_7dcd9495)。
- **Phase 5 设计收口(2026-07-10~12)**:blindspot 报告(`145db9e`,领地实况:actor=OS 用户、
  CORS \*、api.ts 401 静默回退地雷、LWW 但版本库保双方)→ interview 锁定 D-P5-1..4
  (共享项目+评审流,**CRDT 移出 Phase 5**;内网+本地账户 argon2id;三角色全局可见;
  乐观保存+409 冲突三路径)→ ADR-4(`bfcd9aa`)→ D-P5-5 评审/签发 UX 出 4 方向 mockup
  (`9769dc6`:台账签发式/PR 式评审/审批门看板/签章文档式,真实 BESS 数据)→
  **用户选定方向 A 台账签发式(2026-07-12)**;实施规格
  `2026-07-12-phase5-review-signoff-spec.md`:reviews 状态机(送审中/已签发/退回,签发终态
  触发器 + 单送审部分唯一索引)、五端点、**导出门 = 内容寻址幂等**(改动即新哈希即工作稿,
  零冻结机制)、页脚签发行、ReportDossier 台账列增量;与认证解耦(只依赖 actor(),
  PSA_AUTH=off 全流程可用 —— 约束 #0)。待用户排期动工。
- **Phase 5 评审/签发落地(2026-07-12,规格 §6 全六步)**:①store 层 reviews 状态机 +
  版本评论(签发终态触发器、单送审部分唯一索引、审计 kinds review.submit/sign/return/comment,
  10 测)`29e8ca0`;②API 五端点(LookupError→400 / ReviewStateError→409 / 裸 ValueError→422
  类型化映射,中文 detail)`+3 测`;③**导出门**:`_evidence_line` 签发行/工作稿后缀 +
  docx/pdf 标题区工作稿标识 + csv 首行注释 + artifacts.signed,门 = auto-pin 内容寻址幂等
  (核心测试:签发版原样导出带签发行 → 改一个 PFD 即回工作稿);④api.ts 评审客户端
  (显式抛错,**不入** localStorage 回退家族,4 测);⑤ReportDossier 台账增量:状态徽章
  (送审中/已签发·签发人/退回+理由悬浮)、最新行送审、签发确认弹窗(完整哈希+终态警示)、
  退回 prompt、案例正式性列(纯前端 join)、版本评论面板(默认选中送审中版本),既有导出/
  对比控件零改动(4 组件测);⑥bundle 2.73MB 重建 + make check 全绿(py 255 / fe 218)。
  **preview 实测全流程**:保存项目 → 台账出版本行+送审按钮 → 送审中徽章 → 签发弹窗
  (哈希+只增审计文案)→ 已签发·root 徽章 → 版本评论落列表;审计链
  project.create→version.create→review.submit→review.sign→review.comment,console 零错误。
  剩余(auth 层,另排期):修复项 1-3(api.ts 401 地雷/actor 会话身份/CORS 白名单)+
  accounts/sessions + 三角色守卫 + 签发口令复核 + 409 冲突对话。
- **Phase 5 认证层落地,Phase 5 全部收官(2026-07-12,规格 5 批)**:`e0e6c6c`..`ac83512`
  (18 commits,跨 Opus/Fable/Sonnet 按批次切模型,安全关键簇钉在 Fable)。B1(Opus):
  `PSA_AUTH=off|local` 唯一判据模块 + CORS 白名单(off 模式恒 `*`,约束 #0)。
  B2(**Fable**,安全关键):argon2id 账户(库默认参数 + `check_needs_rehash` 透明升级)+
  会话(库中只存 `sha256(token)`,256-bit token,12h TTL 滑动续期,停用即撤销在途会话,
  未知用户走等时 dummy-hash 防枚举)+ provider 抽象(local 是第一个实现,预留 OIDC)+
  actor contextvar 贯通(server 模式签发人=会话身份,off 模式=OS 用户不变)+ api.ts
  `AuthRequiredError`(401/403 显式登录提示,**绝不**回退 localStorage;网络不可达才回退,
  地雷排除)。domain-reviewer 轻扫 PASS(0 blocker;落码:每行审计携带 `auth:off|local`
  标记区分认证/OS-用户行、签发行禁删触发器;3 项文档化决定含"off 模式签发=自审非独立
  评审,正式提交须 local 模式")。B3(Opus):三角色路由守卫(`require_role`,off 模式
  透明放行)+ 签发口令复核 + 签发/退回审计快照 role(移交自 domain-review)+
  `base_version_hash` 乐观并发 409。B4(**Sonnet**,主会话直做未走子代理):App.tsx
  拆认证门(`App`)+ 应用壳(`AppShell`)——local 未登录时壳与壳内**全部**数据获取
  effect 一律不挂载(零预登录网络噪音);`needsLogin` 严格取 `getMe()` 确凿 401
  (`StatusError`),网络异常/离线单文件永不触发(约束 #0 最易踩的坑);409 冲突三路径
  对话(查看 diff/另存副本/确认覆盖);ReportDossier 送审/签发/退回按钮角色呈现层隐藏
  (`identity===null` 失败开放=全权,off 模式不变);精简账户管理面。B5(Sonnet):
  探针 P1(LWW 事实固化为回归:工作区头覆灭但版本库双方俱在)/P3(SQLite 并发写
  基准:10 写者×20 次,1211 writes/s,p50=1.2ms,零锁错误,给"单进程够用"一个实测
  数)——**P3 强撞车变体意外揪出 `create_version` 的真竞态**(check-then-insert 在
  并发下让后到者崩溃而非幂等退让,违反 ADR-2 D6 承诺)→ 当场修(捕获
  IntegrityError→按幂等命中处理)+ 16 线程 Barrier 回归;补上规格 §9 点名但 B4
  漏做的**会话过期草稿暂存**(`sessionDraft.ts` 纯模块 + `useProjectPersistence` 接线 +
  App 顶部横幅恢复/丢弃)——自查时又抓到一个真 bug(新项目首存分支里用户输入的名字
  活在 catch 摸不到的块作用域,草稿会存成兜底名)当场修;**迁移验收**用手搭
  Phase-5-前三表库证明"拷 db 文件就是迁移"确实成立(uuid 派生身份 + 内容哈希版本 +
  `_conn()` 幂等重跑全量 DDL 三者合力,零专门导入代码)。收口:py 255→307、
  fe 218→239,bundle 2.75MB,off 模式回归全程绿(每批次都跑)。**Phase 5 至此全部
  完成**:共享项目+评审签发工作流 + 本地账户认证 + 三角色 + 乐观并发全部落地,
  单用户/离线模式逐位未降级。
- **初因事件故障树(手动/FTA 双通道,2026-07-13,用户点题)**:`0430730`..`0a00baf`(5 commits)。
  盲区读揪出**在产量纲 bug**:'ft' 初因源三层预留(enum/canonical/UI 按钮)但把 `__init__`
  树喂给**概率**端点、无量纲结果标成 /yr(OR 按 1−Π(1−q)、AND 得 1/yr²、封顶 1)。
  修复 = 建正规频率通道:引擎 `fault_tree_frequency`(每割集恰好一个频率事件,
  F=Σ 率×Π使能概率——RS/SAPHIRE/CAFTA 同法,违规响亮 FrequencyRuleError)+ 双向量纲
  护栏(`unavailability()` 对 frequency kind raise)+ `/api/ft/frequency`(400 中文 detail)+
  前端频率模式模态(频率初因按钮/量纲切换/频率不钳位≤1)+ 独立性 lint(IE 树与屏障树
  共享基本事件 → 双侧编辑路径均拒绝并解释)+ 种子树=单频率事件=当前手动值(迁移零意外,
  preview 实测 0.004 逐位不变)。canonical **契约零改动**(kind 三值与全树存储已就位,
  往返+哈希锁测)。**engine-reviewer 两轮**:round-1 FAIL 6 项(F1 HIGH 非相干门静默错数
  +67% UI 可达 → 规范化图上拒绝 NOT/XOR,审查确认比原始树扫描语义更优;F2 limit_order
  先截断后校验致规则逃逸+头条静默低估 → 整体移除;F3 lint 单侧 → 双侧;F4/R-1 负 λ 与
  负时间参数 q<0 同门吞没 → 源头拒绝;F5 保守性归因写反 → 共享**初因**才超算,共享使能
  精确;F6 后最小化语义成文)→ round-2 **PASS**(审查人复跑自家探针+对拍逃逸攻击,
  round-2 还抓到我"已记录于规格"的声明未落地——已补真)。对标账本新行 + Gap #9
  (逐初因精确模式/完整 LFT 集成)。py 326、benchmark 24/24、fe 246、bundle 2.75MB。
  preview 实测:Σ=7×10⁻⁴ 精确、AND(f,f)→400 点名割集、console 零错误。

- **Explorer 壳重设计 + 多项目(2026-07-13~14,R1–R5 五批四模型)**:规格
  `2026-07-13-explorer-redesign.md`,mockup 8 页两轮用户反馈定稿(树保留瘦身/4·5 不合并/
  画布主导可缩放/ETA 直角走线)。R2 多项目状态层(Fable):方案 C 绞杀者——顶层字段**就是**
  活动项目,非活动项目整槽停放(undo 历史/pfds/身份/FMEA 随槽迁移),隔离结构给定,
  8 锁测;聚焦≠重载(保未存编辑)。R3 壳替换(Opus):MenuBar/ExplorerTree/StatusBar,
  auth 门不动;踩 useSyncExternalStore 快照契约(fresh-array 选择器无限渲染 → 稳定切片
  +useMemo)。R4 逐页迁移(sonnet·frontend-dev 三只后台子代理,串行防冲突):ETA 画布
  缩放平移(useCanvasZoom 纯数学 16 测:钳位/fit/指针不动点;React onWheel passive 陷阱
  → 原生非 passive 监听)、FTA 页(zoom 工具组/结果坞折叠/⚙ 设置弹出)、五页换皮;
  R4b 撞会话上限零损失重启;协调者门禁纠正:`tsc --noEmit` 比构建的 `tsc -b` 松,漏 4 错
  (f3c5921 清账,后续门禁一律 tsc -b)。Vite 依赖缓存损坏伪象(双 React → 白屏
  "Invalid hook call")清 .vite 重启根治——**非代码回归**。R5 组合总览(Opus 实现、
  Fable 落审):`GET /api/portfolio` 数字**只取已钉扎案例**绝不现算,无案例=「未量化」;
  矩阵频带/评级与报告矩阵同源(risk_placement 复用 _freq_band/_risk_level);
  review_state 锚**最新版本**防旧签发误读。**domain-reviewer 轻扫抓 F1 真错误**
  (uncertainty 案例真实形状 {"point","bands"},只读 consequences 会把已量化显示成
  "未量化"——反保守,且测试夹具伪造形状遮蔽)+ 5 项裁决全落:双读 point、场景口径
  披露(脚注可见,不藏 tooltip)、"数字非当前版本"琥珀徽章(不靠肉眼比对哈希)、
  open_review 字段(在审行钉旧版本时队列不消失,"看不见还能签"堵死)、25 格金表
  双侧镜像锁(单侧锁只防单侧漂移)、列名弃"C≥3"缩写用公式(与单项目"≥III"=C4+C5
  异口径)。py 169+、fe 276、bundle 重建。**开口子记账**:聚合范围钉扎(案例只覆盖
  单棵事件树,跨项目排序须按勾选集合并导出——F2 最小披露已做,聚合钉扎为候选)。
  **收尾审查(2026-07-14)**:change-quiz 用户明确免试(本轮无引擎/数据改动,合规),
  七题答案卷存档 `docs/reviews/2026-07-14-explorer-redesign-quiz.md`。**R2 隔离层独立
  对抗审查(Fable 冷读 + 时序探针):FAIL,9 项发现,全部落修(`503748b`)。**
  裁决书要义:store 本身结构健全(单次同步 set(),XOR 布局中间态不可观测),缺口全在
  **钩子层的 await 之后**——身份写回落在"当时活动的槽"而非发起槽。两项 CRITICAL 均以
  服务端跨项目存档覆盖收场(F1 保存期间切换 → 身份绑错槽 → 下次保存 B 内容进 A 存档;
  F2 409 对话切换后到达 → A 内容强写 B 存档);F3 会话草稿身份拼接 + 去重键复制;
  F4 另存后原存档被 wid 去重锁死;F5 AI 草案跨项目可应用;F6 FMEA 镜像跨会话渗染;
  F7 列表过期把原地保存降级新建(版本链分叉);F8/F9 轻。修法主干:`setIdentityFor`
  (槽定向,槽关闭即丢弃)+ `rekeyWorkspace`(槽键随新 savedId 迁移)+ conflict 携带
  发起 wid/savedId + 草稿按 savedId 归位 + AI 态随 workspaceId 清空。5 条新回归锁,
  fe 281 全绿。**方法论复证(第三次)**:同作者自测放过的,独立对抗审查抓得住——
  8 条锁测全绿的隔离层,冷读探针 40 分钟判 FAIL。审查者已核清白项(双击竞态/关闭回退/
  载荷跨槽/bootstrap 覆盖等)记录在案,不再重复质疑。

- **技术文档 Rev C + 技能/文档体系刷新(2026-07-14,用户点题)**:TD-001 大改版
  (`aa5f96d`:新 §3 方法基础两图两表 / §4.13–4.14 / 手册扩写含 AI 指南与组合总览 /
  §8.4 AI 生成输入调研(MBSA vs LLM 两路线,ETA 生成侧空档结论)/ 能力矩阵 +Isograph
  列 +评审签发行 / 参考文献 21–26 / 补 meta charset;Word 版 1.0MB 自建管线:
  lxml+python-docx,SVG 浏览器浅色 2x 栅格,同 URL Artifact 更新)。技能结构重设计:
  **域技能 4→5,新增 `psa-evidence-chain`**(版本库/评审签发/认证/组合总览的不变量
  与已付学费清单——该子系统不变量密度已配得上独立技能);`psa-frontend` 按探索者
  多项目架构全量重写(槽钉定规则/双 React 伪象/tsc -b 门);`verify-psa` 升级
  (基线 py366·fe281、`tsc -b` 取代 --noEmit、**对抗审查升级规则**:隔离/状态机/并发
  类改动绿了也要冷读审查、夹具镜像真实管线、开发环境假警报清单);`psa-engine` 补
  频率通道与量纲护栏;parity 账本 +评审签发/组合总览两行 + Isograph 情报;
  frontend-dev 代理同步(槽钉定/tsc -b/vite 缓存)。docs/ 重组:新 `README.md`
  地图 + `research/`(RiskSpectrum 调研、compass ×3 自根目录迁入)+ `archive/`
  (USER_GUIDE/ALGORITHM_DESIGN 加迁移注记归档——内容已并入 TD-001;skill-blueprints;
  早期样例报告);CLAUDE.md 架构表/现状/门禁刷新。**续(同日):TD-001 增 §10
  开发方法与质量保障**(图 9 多代理工作流:三档模型分派/独立评审带/验证门;表 13
  技能与代理 17 行清单;图 10 规格驱动七站流水线 + 两轮制回路;评审拦截实录四例成文
  ——SQA 章节,监管问"工具本身怎么保证质量"时的应答点),原 §10/11 顺延,Word 同步
  重建(10 图/12 章),Artifact 同 URL 更新;根目录收尾:run.ps1 归档 docs/archive、
  清除误生成的根级 node_modules/.vite,根现仅存 6 个 tracked 配置/文档文件。

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
- 领域/算法/对标调研:`docs/research/compass_artifact_*.md`、`RiskSpectrum_PSA_ETA_调研报告.docx`。
- 技能蓝图:`bess-tr-event-tree.skill`、`fta-eta-quantification-engine.skill`、`etafta-frontend.skill`。
