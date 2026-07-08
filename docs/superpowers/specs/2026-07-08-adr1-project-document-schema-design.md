# ADR-1:统一 ProjectDocument 规范模式(设计,草案)

*状态:已定向草案 — D1–D4 经访谈选定,骨架设计完成;待用户通读确认后进入实现计划(plans/) · 2026-07-08*

Phase 2 关键 ADR 之一。目标:用**一个规范的、带版本与溯源的项目文档模式**取代当前并存的多种模型表示,作为 RiskSpectrum 对标(analysis case/模型对比)、存储/审计(ADR-2)、AI 生成(ADR-3 结构化输出目标)与未来多用户 CRDT 的共同基座。

## 一、现状盘点(2026-07-08,基于逐文件核对)

同一个"项目"今天存在于 **6 个表面、4 种形状**:

| # | 表面 | 文件 | 形状要点 |
|---|---|---|---|
| 1 | 前端 ETA 模型 | `frontend/src/eventtree.ts` | `EventTreeModel{initEvent(名字兼显示名), initFreq, functionalEvents[{id,label,failProb,linkFt?,source?,grade?,evidence?}], root(EtNode 二叉,分支记 feId), consequences[{id,desc,level}], initFreqSource, product{…}}`;id 为人工短名(FE1…),仅页签内唯一 |
| 2 | 前端 FTA 模型 | `frontend/src/model.ts` | `ModelJson{model_data.parameters[{id,kind,value,source?}], fault_trees[{name,top,nodes[{id,basic/house/op/args/k/state/param_ref,label}]}], ccf_groups}`;**故障树以 name 为身份**(改名=换身份);节点 id 用时间戳 uid;每个 ETA 页签一份 fts + 全局一份 userFts |
| 3 | 项目存档 payload v2 | `frontend/src/project.ts` + `projectFile.ts` | `{v:2, etas[{key,name,renamed,model,fts,pfds}], activeKey, checkedKeys, userFts?, fmeaRows?, fmeaMapping?}`;信封 `{kind:'bess-psa-project',version:2,exportedAt,payload,libraryOverlay?}`。**这是今天事实上的 ProjectDocument** |
| 4 | 引擎 JSON | `psaengine/model/json_io.py` | 参数含 `mttr/test_interval/mission_time/distribution{family,params}/source/version`;含 house 事件、CCF 组(beta/mgl/alpha/phi 已声明);event_trees 含 sequences(显式 path)与 consequence_bins |
| 5 | ET 定量线协议 | `api.ts::EtQuantifyRequest` ≡ `backend/schemas.py` → `et_builder.py` | 扁平化:functional_events[{id, pfd\|link_ft}] + sequences + bins;et_builder 给直接 PFD 屏障造平凡 FT(null 门) |
| 6 | MEF XML | `psaengine/model/mef_xml.py` | 仅故障树+基本/house 事件;不确定性摊平为点值;无事件树/CCF/溯源(交换格式,天然子集) |

另:**AI 草案目标形状**(`AiDraftResponse.etas/fts`)= 形状 1+2 的组合。

## 二、问题清单(规范模式必须消除的)

1. **同一概念三个名字**:屏障 = FuncEvent(failProb) = functional_event(link_ft) = 以 feId 命名的平凡故障树;PFD 同时活在 failProb、参数 value、页签级 `pfds` 缓存三处。
2. **身份制度不统一**:FE 用人工短名(页签内唯一)、FTA 节点用时间戳 uid、故障树用 *name* 当身份(重命名即断链)、ETA 页签用 key+display name(且 initEvent 兼作显示名)。全局无 UUID,无跨页签唯一性。
3. **溯源不均匀**:FE 有 source/grade/evidence(为贝叶斯加的),参数有可选 source 字符串,引擎 Parameter 有 source+version;**后果、序列、树、页签一概没有**;无 created/modified 时间戳(仅信封 exportedAt)、无内容哈希、无审计轨迹。
4. **UI 态混入文档**:activeKey/checkedKeys/renamed 与分析内容同层;libraryOverlay 骑在信封上。
5. **引擎能力从文档不可达**:分布(EF!)、rate 参数(mttr/τ/mission)、house 事件、CCF 组在引擎 JSON 里存在,但 ETA 路径 `toEngineRequest→et_builder` 把一切参数强制成 `kind:probability` 点值 —— 不确定性只能用全局 error_factor=3.0 兜底,而不是按参数分布。
6. **线协议有损**:标签在 quantify 请求中丢弃、又在 `ReportRequest.labels` 里补发(补丁式);grade/evidence 全丢(对算数无害,对报告/审计有害)。
7. **前端 `null` 门用 `state` 字段复用作透传语义**(`activatedNodes` 中 null 门看 state)——与 house 的 state 语义撞名,规范化时须厘清。

## 三、规范模式要同时服务的四个主子(设计约束)

- **对标**:analysis case(模型快照+设置+结果)与 Model Compare 需要稳定身份 + 可哈希快照(parity 台账 #4/#5)。
- **审计/监管**(ADR-2):`报告数字 → 分析案例 → 模型元素 → 数据条目 → 来源` 链条中"模型元素"一环需要每实体 UUID + 溯源块(见技能 regulatory-traceability)。
- **AI 生成**(ADR-3):规范模式即结构化输出 schema;须可被 JSON Schema 严格校验(additionalProperties:false)。
- **多用户/CRDT**(Phase 5):文档须是"一个可绑定的整体",UI 瞬态在外。

## 四、待决策清单(访谈中逐条定,一次一问)

| # | 决策 | 选项 | 推荐 |
|---|---|---|---|
| D1 | **迁移策略**(本 ADR 的第一决定) | A 绞杀者式:规范模式服务端落地+新旧无损互转,前端 Phase 3 才原生采用;B 一次性:新模式+一次性迁移工具+前端立刻重写;C 仅文档/校验层:payload v2 仍是真格式 | **A**(理由:B 把 ADR-1 与整个前端重构耦合成大爆炸;C 给不了 ADR-2/3 真基座;A 让 ADR-2/3 立即有落点、Phase 3 渐进) |
| D2 | 文档范围:UI 态(activeKey/checkedKeys/布局)入否 | 入文档 / 出文档(留 localStorage)/ 出文档但入"视图配置"独立节 | 待问(倾向:分析内容+报告相关配置入;瞬态 UI 出) |
| D3 | MEF 对齐度 | 引擎侧实体沿 MEF 命名与语义,工作台扩展独立命名空间 / 前端自然命名+仅边界转换 | 待问(倾向:MEF 对齐核心) |
| D4 | 身份与溯源策略 | 每实体 UUID+人读别名+溯源块{origin: human\|ai-draft\|import\|library, source, grade, evidence[], modified_at} | 待问(倾向:是;MEF 导出用别名) |

## 五、非目标(初稿)

- 不在本 ADR 实现存储引擎(ADR-2)、不改引擎算法、不动参考库 schema(独立数据层,文档只引用+快照 grade)。
- 不为 Phase 5 预实现 CRDT 类型;只保证"单文档、瞬态在外、实体稳定身份"三个 CRDT 前置条件。

## 六、规范模式 v1(骨架设计,依 D1–D4)

### 6.1 信封与文档

```
信封 v3: { kind:'bess-psa-project', version:3, exported_at, document:ProjectDocument }
ProjectDocument {
  schema_version: '1.0'
  project: { uuid, name, description?, created_at, modified_at, meta?{analyst,org,site,…} }
  model_data: { parameters: Parameter[] }          # ── MEF 对齐核心 ──
  fault_trees: FaultTree[]
  ccf_groups: CcfGroup[]
  event_trees: EventTree[]
  house_event_sets?: […]                            # 预留(parity #2 边界条件集)
  workbench: {                                      # ── 工作台命名空间 ──
    aggregate_scope: uuid[]                         # 原 checkedKeys(D2:分析相关,入档)
    fmea?: { rows[], mapping }                      # 行内条目引用改 uuid
    risk_matrix?: 校准包
    report_meta?: …
    library_overlay?: unknown                       # 便携携带;文档自足性不依赖它(见 6.3 快照)
  }
}
```

纯视图态(活动页签/分栏/折叠)出档 → localStorage 按 project.uuid 键控(D2)。

### 6.2 身份与引用(D4)

- **每实体**:`uuid`(身份,稳定)+ `ref`(命名空间内唯一的人读短名,B_BMS/FE1/IE_ISC;MEF 导出与报告用它)+ `label?`(中文显示名,自由改)。
- **一切跨引用走 uuid**(门 args、param_ref、分支 fe、叶 consequence、聚合范围)——改 ref/label 永不断链;故障树身份不再是 name。
- v2→canonical 转换时铸造 uuid 并重写引用;ref 取现有 id/name,冲突时后缀去重。

### 6.3 溯源块(强制于载值实体)

```
provenance: { origin: human|ai-draft|import|library, source?{citation,url?,note?},
              grade?: A|B|C|D, unit?, evidence?: […], created_at, modified_at }
```

- 参数、初始事件、功能事件、(自定义)后果**必带**;树/门可选。
- 从参考库引用时**快照** value/unit/grade/citation 入本块(库后续变化不追溯改档);手改数值 → grade 清为 D 并记 origin 变化。评审报告指出的"IE 无单位无 grade"在本模式下**结构性不可能**。
- AI 草案落地即 `origin:'ai-draft'` + grade D(与既定 AI 规则一致,ADR-3 消费)。

### 6.4 概念归一(消除问题清单 #1/#5/#7)

- **屏障 PFD 单一来源**:`FunctionalEvent.pfd = {param: uuid} | {fault_tree: uuid}`——直接值也走参数(带溯源);页签级 `pfds` 缓存是派生量,出档(重算或入 ADR-2 分析案例)。
- 参数全量表达引擎能力:kind probability|rate|frequency + mttr/τ/mission + distribution{family,params}(EF 不再只能全局兜底)。
- 门 op 枚举 and|or|atleast|xor|not|null;`state` 仅存在于 house-event 实体——v2 里 null 门借用 state 的写法由转换器拆分。
- 初始事件成一等实体:`{uuid, ref, description, frequency:{param: uuid}, freq_source: manual|ft|product, product_dims?}`。

### 6.5 绞杀者落地(D1)

- 实现位置:`backend/canonical/`——Pydantic 模型 + 导出 JSON Schema(`GET /api/schema/project-document/1.0`,ADR-3 的结构化输出直接引用)+ 双向转换器 `payload_v2 ↔ canonical`。
- 现有端点不动;**新能力只说规范话**:ADR-2 存储/版本/审计、ADR-3 AI 输出、未来 diff/analysis case。
- 前端 Phase 3 store 重构时原生采用;届时 v2 序列化留作旧档读入路径。

### 6.6 规范序列化与哈希(ADR-2 挂钩)

规范 JSON 序列化(键排序、UTF-8、LF、不含易变字段)由 canonical 层定义;content_hash 由存储层对"文档减 modified_at 类字段"计算——同内容必同哈希(Model Compare 与审计的基础)。

### 6.7 验收标准

1. round-trip 测试:真实 fixtures(5 内置场景各存档 + 既有示例项目)v2→canonical→v2 **逐字段无损**;property 测试:任意合法 v2 经往返不变。
2. canonical→引擎:quantify 数值与现行 v2 路径**逐位一致**(基准:现有 169 后端断言不动)。
3. JSON Schema 严格(additionalProperties:false)且 `bess/scenarios.json` 5 场景转换后全部校验通过。
4. MEF XML 导出经 canonical 投影与现行导出等价(byte-diff 或语义 diff 为空)。

## 决策记录

- **D1 迁移策略 → A 绞杀者式**(2026-07-08,用户选定):规范模式在服务端落地(Pydantic + JSON Schema),配 payload-v2 ↔ 规范的无损互转;ADR-2 存储/审计与 ADR-3 AI 输出立即以规范模式为目标;前端保持现状,Phase 3 store 重构时原生采用;旧存档永远加载即升级。**排除**:B 一次性迁移(把 ADR-1 与整个前端重构耦合成大爆炸)、C 仅校验层(给不了 ADR-2/3 真基座)。**推论**:转换器是一等公民,须有双向 round-trip 测试(v2→canonical→v2 逐字段无损)。
- **D2 文档边界 → B 内容+分析相关配置入档,纯视图态出档**(2026-07-08,用户选定):入档=分析内容 + 一切改变计算/报告结果的配置——聚合范围(今 checkedKeys,更名为 aggregate scope)、后果内涵定义、矩阵校准、报告元数据;出档=纯视图态(活动页签、分栏位置、折叠态)→ localStorage 按项目 id 键控。**理由**:可审计数字必须仅凭文档可复现(多 ETA 场站总风险依赖聚合范围);**排除**:A 严格切割(聚合结果脱离文档不可复现,弱化证据链)、C 全入档带 view 节(schema 面积大且逐字段边界须永久维护)。
- **D3 MEF 对齐度 → A 对齐核心 + 工作台命名空间**(2026-07-08,用户选定):引擎侧实体(basic event/gate/house event/CCF group/参数表达式)沿 Open-PSA MEF 命名与语义;无 MEF 对应物的工作台概念(feId 有序可跳过二叉 ETA、FMEA、风险矩阵、库引用、溯源块)入独立扩展命名空间。**理由**:MEF XML 导出近似投影、parity 特性(house 事件集/alpha CCF)落地无需改模式、评审者与 AI 草案说标准 PSA 词汇;**排除**:B 自然命名(每个 parity 特性都要自定义映射)、C 字面 MEF 超集(XML 惯用法不适合作为编辑器/CRDT 工作格式)。
- **D4 身份与溯源 → A UUID 身份 + 人读别名 + 溯源块**(2026-07-08,用户选定):每实体 uuid(身份)+ ref(人读短名,MEF/报告用)+ label(中文显示);跨引用走 uuid(改名永不断链,故障树身份脱离 name);载值实体强制溯源块(origin/source/grade/unit/evidence/时间戳)。**理由**:数据出处评审(docs/reviews/2026-07-08)发现的"IE 无单位无 grade"类缺陷被模式结构性杜绝;diff/合并/审计获得稳定锚点;**排除**:B 人读 id 当身份(重命名重写全部引用,diff 噪声、合并弱)、C 纯 UUID(报告/MEF 可读性不可接受)。
