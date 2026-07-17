# Frontend 代码审查报告（2026-07-16）

- 审查范围：`frontend/src/`，重点覆盖多项目状态、ETA/FTA 工作台、报告与证据链、持久化、参考库、导入导出、可访问性和前端门禁
- 审查基线：`main@96d2c03bbb1d`
- 审查方式：静态冷读、调用链对拍、并行专项审查、TypeScript/测试/lint/依赖审计
- 交付目的：供另一个隔离环境按优先级修复；本次不修改前端源码
- 关联报告：`docs/reviews/2026-07-16-engine-backend-code-review.md`

## 1. 结论

前端整体架构方向是清楚的：React 18 + TypeScript、Zustand 多项目槽、ETA/FTA 纯模型函数、探索者壳、懒加载工作台和证据链页面已经形成较完整的产品骨架。`npx tsc -b` 当前通过，320 个前端测试中有 318 个通过。

但当前不能把前端视为“监管交付已收口”。最重要的问题不是样式，而是分析上下文没有成为一个不可分割、可追溯的对象：

1. 屏幕量化、重要度、报告导出和报告页导出构造了不同的请求；
2. 异步回调没有绑定发起项目、目标树、模型版本和分析设置；
3. 初因频率在一条 FTA 编辑路径上走了概率端点；
4. 会话过期草稿恢复会丢失乐观并发基线；
5. 参考数据和外部文件的运行时校验不足。

这些缺口会造成错误项目被写入、旧结果伪装成当前结果、报告数字与屏幕不一致、服务端新版本被无 409 覆盖，以及无来源/错单位数据进入分析。建议先冻结新增前端能力，优先完成 FE-01～FE-05 的规格和锚点测试。

## 2. 发现总览

| ID | 优先级 | 发现 | 主要后果 |
|---|---:|---|---|
| FE-01 | P0 | 屏幕量化与报告导出请求语义漂移 | 报告、案例和屏幕可能给出不同数字 |
| FE-02 | P0 | ETA/FTA 异步结果写入“当前项目”而非发起项目 | A 的 PFD/场景可污染 B 并进入存档 |
| FE-03 | P0 | FTA 页编辑初因树调用概率端点并吞错 | 初因频率错误或保持旧值且用户不知情 |
| FE-04 | P0 | 会话草稿恢复丢失 CAS 基线 | 可绕过 409 覆盖服务端更新 |
| FE-05 | P1 | 结果与分析设置未绑定完整分析上下文 | 陈旧结果、跨树/跨项目设置泄漏 |
| FE-06 | P1 | 证据链页面异步竞态且 401 被渲染为空数据 | 页面可显示另一项目台账或伪装“暂无数据” |
| FE-07 | P1 | HTTP 失败、离线回退和静态降级未区分 | 服务端拒绝可被呈现为离线成功 |
| FE-08 | P1 | 保存、读档和冲突处理缺少统一并发协议 | 重复项目、焦点抢占、冲突 diff 名不副实 |
| FE-09 | P1 | “参数库 / CCF”实际编辑全局示例模型 | 用户以为修改项目，实际不保存也不作用于项目 |
| FE-10 | P1 | 参考库和项目文件缺少严格运行时校验 | 无来源、错单位、越界值或坏模型进入分析 |
| FE-11 | P1 | AI 草案应用回执为不校验状态的 fire-and-forget | 项目已应用 AI 内容但审计记录缺失 |
| FE-12 | P1 | FMEA CSV 未正确转义且存在公式注入 | 导出损坏；打开 CSV 时可能执行单元格公式 |
| FE-13 | P2 | 核心画布/导航/弹窗不满足键盘和 ARIA 语义 | 键盘及辅助技术用户无法完成核心操作 |
| FE-14 | P2 | 测试、lint、Node 下限和依赖审计未形成干净门禁 | CI 信号噪声大，依赖风险难以受控 |

优先级定义：

- P0：可能改变定量结果、跨项目污染模型、破坏版本并发或生成错误监管交付物；
- P1：高概率破坏证据链、数据完整性、认证语义或关键工作流；
- P2：不会立即改变数学结果，但会削弱可用性、可维护性和交付门禁。

## 3. 详细发现

### FE-01 — 屏幕量化与报告导出请求语义漂移

证据：

- `frontend/src/components/EventTreeEditor.tsx:147-162`：屏幕精确量化和重要度使用 `withIeFaultTree(toEngineRequest(...))`，并合入 `etEngineOptions`。
- `frontend/src/components/EventTreeEditor.tsx:166-177`：同一编辑器的报告导出只调用 `toEngineRequest(...)`，丢失 `ie_fault_tree`、house override 和命名边界条件。
- `frontend/src/features/report/ReportDossier.tsx:64-78`：报告页单场景导出同样不走 `withIeFaultTree`，且 `linked` 连 `ccf_groups` 也未带入。
- `frontend/src/features/report/ReportDossier.tsx:21-35`：聚合树带了 CCF，但仍不带集成 LFT 和有效分析设置。
- `frontend/src/components/EventTreeEditor.tsx:151-153,213-228`：集成量化响应已经返回 `ie_frequency`，序列使用了集成结果，但“初因事件频率（总）”KPI 仍固定显示 `model.initFreq`。

影响：

- LFT、共享事件、CCF、house event 或 boundary-condition 生效时，界面结果、Word/PDF/CSV 和自动钉扎案例可能不是同一次分析。
- 同一个结果页可同时显示集成序列频率和旧的标量初因频率。
- 该问题与 engine/backend 审查的 EB-01、EB-02、EB-08 是同一跨层缺口；仅修前端请求仍不足以完成可重放报告。

建议：

- 建立唯一、强类型的 `buildAnalysisRequestV2(context)`；量化、重要度、报告、聚合、不确定性和案例钉扎只能消费它。
- `AnalysisContext` 至少包含 workspace、ETA/FTA 身份、模型哈希、有效 PFD、LFT、CCF、house/boundary 设置、后处理规则及作用域。
- 报告后端暂不支持的语义必须显式拒绝或标为 unsupported，不能静默退回普通 ETA。
- 结果区显示分析口径和 request/model hash；集成模式 KPI 使用响应的 `ie_frequency` 并标“集成”。

最低验收：

- 拦截屏幕量化与报告请求，对 `ie_fault_tree`、CCF、house states、boundary set 和参数逐字段对拍。
- LFT anchor C、house/boundary 锚点在屏幕、CSV、Word/PDF 中逐位一致。
- 单场景与勾选集聚合都覆盖同一组契约测试。

### FE-02 — ETA/FTA 异步结果可写入错误项目或被旧请求覆盖

证据：

- `frontend/src/features/eta/EtaWorkbench.tsx:113-120`：`buildScenarioTab` 返回后通过 `P()` 向当时活动槽添加页签，没有捕获/校验发起 `workspaceId`。
- `frontend/src/features/eta/EtaWorkbench.tsx:132-149`：初因频率请求返回后向当前槽写 `setEtaPfd(active.key, ...)`。
- `frontend/src/features/eta/EtaWorkbench.tsx:156-169`：屏障量化返回后同样写当前槽。
- `frontend/src/features/fta/FtaWorkbench.tsx:101-118`：FTA 编辑后的派生 PFD 回写没有 workspace、模型 revision 或请求序号。
- `frontend/src/stores/projectStore.ts:315-316`：`setEtaPfd` 只按 key 写侧表，不校验 ETA 是否属于该槽。
- `frontend/src/App.tsx:97-107` 已有正确先例：它捕获 `wid` 并在 await 后校验；ETA 工作台未复用该模式。

确定性时序：

1. A、B 都打开相同内置场景 `sc:tr`；
2. A 发起屏障量化；
3. 请求未完成时切换 B；
4. A 响应返回，`P()` 指向 B，A 的值写入 B；
5. 保存 B 时，污染值经 `composeEta` 进入存档和证据链。

同一槽快速连续编辑也会出现 old 慢、new 快、最后 old 覆盖 new 的乱序。

建议：

- 新增槽定向 mutation，例如 `setEtaPfdFor(workspaceId, etaKey, feId, value, revision)`；槽已关闭或 revision 不匹配时丢弃。
- 所有异步分析捕获 `{workspaceId, targetId, modelHash/revision, requestId}`，响应只允许提交给原上下文。
- 复用一个 last-write-wins/request-generation 工具，避免各组件手写半套守卫。

最低验收：

- deferred promise：A 发起、切 B、resolve A，断言 B 逐位不变。
- A 请求期间关闭 A，响应必须丢弃。
- 同槽 old/new 请求按 new→old 返回，最终只保留 new。
- 场景加载、初因频率、屏障 PFD 和 FTA 编辑四条路径都要覆盖。

此项属于多项目隔离/并发禁独改范围，应先有评审规格和对抗时序测试。

### FE-03 — FTA 页编辑初因树走错端点并静默吞错

证据：

- `frontend/src/features/fta/FtaWorkbench.tsx:108-120`：目标为 `__init__` 时调用 `quantify(m, '__init__')`，即概率端点；整个派生写回使用空 `catch {}`。
- `frontend/src/features/eta/EtaWorkbench.tsx:146-151`：ETA 弹窗路径正确使用 `ftFrequency(...)`，并把 400 错误显示给用户。
- 项目硬约束规定初因频率树必须走 `/api/ft/frequency`，不能按概率端点夹断或解释。

影响：

- 同一棵初因树从两个入口编辑可得到不同语义。
- 频率参数可能被当成概率处理，或请求失败后继续展示旧初因频率。

建议：

- 抽取按目标类型分派的 `quantifyLinkedTree`，初因树只允许频率端点，屏障树只允许概率端点。
- 删除空 catch；错误进入统一错误条，并把旧派生值标为 stale，而不是继续当成当前值。
- 初因树与屏障共享事件时，明确区分“独立标量缓存”与“序列级集成结果”，不得用前者覆盖后者。

最低验收：

- 含 `kind=frequency` 参数的 `__init__` 只调用 `/api/ft/frequency`。
- FTA 页与 ETA 弹窗编辑同一模型，返回频率逐位一致。
- 400/422 必须可见，且派生值进入失效态。

### FE-04 — 会话过期草稿恢复会绕过乐观并发

证据：

- `frontend/src/features/persistence/sessionDraft.ts:10-20`：草稿只保存 `name/payload/savedId/at`，没有 `projectUuid`、`lastVersionHash` 或 payload hash；`DRAFT_KEY` 只有一个全局槽。
- 同文件 `15-20`：`localStorage.setItem` 失败被吞掉。
- `frontend/src/features/persistence/useProjectPersistence.ts:122-124,147-149`：无论实际写入是否成功，UI 都宣称“已额外暂存一份草稿”。
- `frontend/src/features/persistence/useProjectPersistence.ts:183-203`：恢复时主动把 `lastVersionHash` 清空。
- `frontend/src/features/persistence/useProjectPersistence.ts:105-106`：后续保存因此不带原基线，成为强制覆盖语义。

风险时序：

1. 本地从 H1 编辑，另一客户端把服务端推进到 H2；
2. 本地会话过期，保存得到 401 并暂存草稿；
3. 重新登录后恢复草稿，H1 基线被清空；
4. 再保存时没有 `base_version_hash`，H2 被覆盖而不产生 409。

此外，A、B 先后遇到 401 时，后一个草稿会无提示覆盖前一个；配额或隐私模式导致写入失败时，刷新后草稿实际不存在。

建议：

- 草稿 schema v2 保存 `workspaceId/savedId/projectUuid/lastVersionHash/payloadHash`。
- 以项目为键保存草稿 map/队列，不使用单全局槽。
- 恢复不能清空 CAS 基线；若确需强制覆盖，必须单独的二次确认动作并进入审计。
- `stageSessionDraft` 返回成功/失败；失败时提供立即下载项目文件的兜底。

最低验收：

- H1 草稿恢复后遇到服务端 H2，再保存必须返回 409。
- A、B 草稿可分别恢复。
- 模拟 `localStorage.setItem` 抛错，UI 不得宣称暂存成功。
- 草稿只在服务端保存确认后删除。

此项属于证据链/并发禁独改范围。

### FE-05 — 分析设置和结果未绑定完整上下文

证据：

- `frontend/src/components/EventTreeEditor.tsx:69-79`：ETA 结果只在 `model` 引用变化时清空；linked FT、CCF 或分析设置变化不会失效结果。
- 同文件 `147-164`：量化和重要度没有 request generation/abort，晚响应可覆盖新结果。
- `frontend/src/features/fta/FtaWorkbench.tsx:49-65`：FTA 结果只在示例 `current` 变化时清空；编辑 `cvModel`、切另一棵同类树、改变设置或切 workspace 都可能保留旧结果。
- 同文件 `154-159`：FTA 量化没有上下文 token。
- `frontend/src/features/eta/EtaWorkbench.tsx:51-60`：设置只按 `activeKey` 重置；不同项目常共享同一场景 key。
- `frontend/src/features/fta/FtaWorkbench.tsx:54-65`：设置重置依赖只有 `ftEditTarget.src/current`，不含 workspace、ETA key、树名。
- `frontend/src/features/analysis/analysisSettings.ts:108-118`：无效后处理规则被静默过滤；量化按钮没有因规则错误而禁用。

影响：

- A 的 house/boundary/post 设置可带到 B 或另一棵树。
- 旧概率、割集、重要度和热力图可继续显示在已经编辑过的模型上。
- 用户配置了规则并看到校验错误，但仍可量化；请求会悄悄省略坏规则。

建议：

- 引入不可变 `AnalysisRunKey = workspace + target + modelHash + settingsHash`。
- 结果必须携带并展示 run key；上下文任一部分变化立即失效。
- 设置按完整目标身份保存或明确每次清空。
- 有无效规则时禁止运行，或要求用户明确确认“排除这些规则”；不得静默过滤。

最低验收：

- A/B 相同 `activeKey`，A 设置 house override 后切 B，B 必须为默认值。
- 从一棵 `src='eta'` 树切到另一棵，设置不泄漏。
- 修改 FT、CCF、house/boundary 任一项后，旧结果立即消失或标 stale。
- deferred A/B 响应按 B→A 返回，界面只显示 B。

### FE-06 — 证据链页面会显示错误项目数据，认证过期又被隐藏

证据：

- `frontend/src/features/report/ReportDossier.tsx:55-62`：版本、案例、评审三个请求没有取消或 generation token，也未在项目切换时同步进入 loading/清空态。
- 同文件 `133-139,149-167`：版本 diff 和评论请求也可在切项目后提交旧结果。
- `frontend/src/features/home/ProjectCockpit.tsx:33-40`：项目驾驶舱存在同类竞态。
- 两处把读取失败转为空数组，401 会呈现为“暂无版本/案例”。
- `frontend/src/stores/authStore.ts:24-31` 只在 `App.tsx:49` 挂载时刷新一次；其他 API 的 401 不会全局切换到登录墙。
- `frontend/src/features/report/ReportDossier.tsx:88-110,290,391-425`：签发密码只在确认时清理；遮罩关闭、取消、切项目时仍留在组件状态中。

影响：

- A 的慢响应可以覆盖 B 的台账、评论或 diff。
- 会话过期被误解为“没有数据”，用户可能继续操作错误项目。
- 用户为版本 A 输入密码后取消，再打开版本 B 时密码仍可复用。

建议：

- 所有项目查询使用 `{projectUuid, generation}` 或 AbortController；只提交仍属于当前项目的响应。
- 401/403 进入统一 transport/auth 通道；401 更新 auth store，403 显式显示无权限，均不得转换为空数据。
- 项目切换立即清理 diff、评论、签发目标、备注和密码。

最低验收：

- A slow、B fast，最终三类台账、diff、评论都只能是 B。
- 任意证据链 API 返回 401 时出现重新认证界面，原项目编辑保留。
- 取消/遮罩/失败/成功/切项目/卸载均清除签发密码。

### FE-07 — HTTP 错误与离线降级被混为一谈

证据：

- `frontend/src/api.ts:49-58`：`jget` 对任何非 2xx 都抛错，再在同一个 catch 中使用 embedded fallback；500/422/403 与网络断开没有区别。
- `frontend/src/api.ts:226-280`：saved API 除 401/403/409 外，400/404/422/500 都回退到 localStorage。
- `_savedOffline` 是一个全局“最近一次操作”布尔值，不属于具体项目或请求，并发时可误标状态。
- `frontend/src/features/persistence/scenarioLoader.ts:7-13`：关联 FT 量化失败被逐棵吞掉，场景继续使用静态 `failProb`，没有来源/降级提示。

影响：

- canonical 校验拒绝或服务端存储失败可被 UI 表现为“离线保存成功”，绕过版本库和审计链。
- 服务端库故障可悄悄切到可能不同版本的 embedded data。
- 场景看似加载成功，实际部分 PFD 来自静态默认值。

建议：

- 只有 `fetch` 网络异常或显式 offline mode 才能离线回退；一旦收到 HTTP 响应，必须暴露 status/detail。
- 返回结构携带 `{source: server|embedded|local, syncState, reason}`，不使用进程级布尔标志。
- 离线存档提供显式同步/冲突处理，不能自动伪装成服务端版本。
- 场景加载的部分量化失败应阻断，或显著标出每个值的来源和 stale 状态。

最低验收：

- 422/500 不写 localStorage；网络 reject 才允许回退。
- embedded fallback 必须有可见 provenance。
- 一棵关联 FT 失败时，页面不能无提示显示“完整已量化”。

### FE-08 — 保存、读档和冲突处理没有统一并发协议

证据：

- `frontend/src/features/persistence/useProjectPersistence.ts:87-144`：save/save-as 没有 workspace 级 in-flight guard。
- 首存双击时，两次调用都捕获 `savedId=''`，可创建两个服务端项目；第一个响应 rekey 后，第二个响应仍写旧 workspace key。
- 已存档项目的响应也没有 revision/generation。结合 backend 审查 EB-07 的非原子 CAS，逆序响应可把较旧 head 写回前端。
- `frontend/src/features/persistence/useProjectPersistence.ts:213-237`：并发读档按响应顺序聚焦，没有 last-intent-wins。
- `frontend/src/features/portfolio/PortfolioTab.tsx:77-81`：`loadProject` 内部吞掉错误并 resolve，调用方仍切换页面。
- `frontend/src/features/shell/SaveConflictDialog.tsx:23-28`：点击“查看双方差异”先丢弃 conflict，再只进入服务器版本对比页；没有比较本地 payload 与服务器最新版本，也不保证切回冲突所属项目。

建议：

- 每个 workspace 的 save/save-as/delete/conflict mutation 串行化，所有菜单和按钮共享同一 operation state。
- 读档使用单调 request id 或取消；旧请求可后台停放，但不得抢占用户最后选择。
- `loadProject` 返回显式 success/target，不在内部把失败伪装成成功。
- 冲突 diff 保留 `{wid, localPayload, baseHash, serverHash}`，真正展示“本地工作树 vs 服务器最新”。

最低验收：

- 未存档项目双击保存只发一个请求，或第二个明确排队在新 ID 上执行。
- B slow、C fast，最终活动项目必须是 C，旧 finally 不得清空新 pending。
- 读档失败时 Portfolio 不切页面。
- A 保存、切 B、A 返回 409 后，diff 自动定位 A 并保留本地 payload。

此项属于持久化状态机/并发禁独改范围。

### FE-09 — “参数库 / CCF”编辑的是示例模型，不是项目

证据：

- `frontend/src/App.tsx:69,141-149`：参数页接收 `useExampleModel()` 的 `example.model`。
- `frontend/src/features/fta/useExampleModel.ts:7-24` 明确说明该状态是“非项目文档，独立撤销历史”。
- `frontend/src/features/shell/ExplorerTree.tsx:13-20` 却把“参数库 / CCF”放在每个活动项目下面。
- 项目序列化只保存 ETA tabs 和 `userFts`；示例参数修改不进入项目版本或证据链。

影响：

- 用户从项目树进入参数页并编辑后，会合理地认为项目参数已经变化；实际修改既不作用于活动项目，也不会随项目保存。
- 切项目后同一示例状态仍存在，进一步强化跨项目错觉。

建议：

- 明确产品语义：若这是项目参数库，必须以 workspace 为根，列出 ETA-attached FT 与 standalone FT，并要求选择作用目标。
- 若保留示例模型，只能放在“示例/教学”全局区，并明确显示“不进入当前项目和报告”。
- 参数/CCF 修改必须进入项目撤销历史、canonical hash 和版本 diff。

最低验收：

- 在项目 A 修改参数后保存/重载，修改仍存在并只属于 A。
- 切 B 不显示 A 参数。
- 报告请求与版本 diff 能追到本次参数/CCF 修改。

### FE-10 — 参考库和项目文件的运行时校验不足

参考库证据：

- `frontend/src/components/ReferenceLibrary.tsx:49-53`：数字只拒绝 NaN；负值、Infinity、PFD>1 均可进入覆盖层，空输入立即变为 0。
- 同文件 `18-29,191-214`：单位和 `source.citation` 可为空，A/B/C/D 可直接选择，每次按键即持久化。
- `frontend/src/libraryStore.ts:72-80,88-93`：覆盖层和导入文件只做浅形状检查，未校验 version、字段、范围、单位、citation、重复 ID 或文件大小。

项目文件证据：

- `frontend/src/projectFile.ts:20-31`：只检查信封 kind/payload；没有严格要求 `version===2`，也不校验 payload schema。
- `frontend/src/project.ts:97-138`：大量嵌套对象直接断言为 `EventTreeModel`/`ModelJson`。
- `frontend/src/features/persistence/projectIo.ts:22-31`：`normalizeEta` 只补旧字段，不能替代语义校验。

影响：

- 无来源数字、错单位、越界概率和坏模型可进入前端实时计算、项目文件或后续报告。
- `Infinity` 经 JSON 序列化还会变成 `null`，造成二次静默变形。
- 这违反参考库硬约束：每条数据必须有 `source.citation`，器件率/PFD/初因频率单位不得静默混用。

建议：

- 为项目文件和参考库分别建立 versioned runtime schema；先完整校验临时对象，再事务式提交。
- 数值必须有限且满足分区范围；PFD/有效性在 `[0,1]`，率/频率非负。
- `source.citation` 必填；器件率单位显式区分 `/cell·yr`、`/unit·yr`，不得自动换算。
- A/B 只允许用户层且需相应证据；内置层仍只允许 C/D。
- 设置文件大小、数组长度、节点数、字符串长度和重复 ID 限制；拒绝未知的新版本。
- 编辑器使用“文本草稿 → blur/Enter 校验 → 原子提交”，不要在用户输入中间态持续写库。

最低验收：

- 覆盖负数、Infinity、PFD>1、空 citation、空/未知单位、重复 ID、错误 version、超大文件和畸形树。
- 校验失败时原覆盖层/项目保持逐位不变。
- `/cell·yr` 不得无维度信息地映射为初因 `/yr`。

本项按 `eta-reference-data` 规则复核；修复后需要参考库专项测试，若影响离线数据还需重捕获 embedded data 并重建 bundle。

### FE-11 — AI 草案应用审计不可靠

证据：

- `frontend/src/api.ts:122-130`：`reportAiDraftApplied` 不检查 `response.ok`，并吞掉所有异常。
- `frontend/src/features/ai-draft/useAiDraft.ts:142-154`：调用方使用 `void reportAiDraftApplied(...)`，不等待回执就继续把草案应用到项目。

影响：

- 401/500、网络中断、关闭页面或切项目时，可出现“AI 内容已进入模型，但没有逐元素接受/拒绝审计”。
- 这直接违反 AI 输出必须携带来源并待人工审核的证据链要求。

建议：

- 采用可靠 outbox：本地先记录待同步回执，服务端确认后标 synced；失败状态必须可见且可重试。
- 回执绑定项目 UUID、workspace、模型基线/结果 hash 和接受元素清单。
- 不建议仅把 `void` 改成 `await` 后阻断模型编辑；应先明确离线和恢复语义。

最低验收：

- 401、500、network reject、页面卸载、切项目均不能无提示丢审计。
- 模型中的 AI 元素可反查到 draft id、人工接受者、时间和所基于的模型版本。

### FE-12 — FMEA CSV 格式与公式注入

证据：

- `frontend/src/components/FmeaWorkbench.tsx:359-376`：字符串只是包一层双引号，没有把内部 `"` 转成 `""`，换行也没有统一处理。
- 以 `=、+、-、@` 开头的用户/导入文本没有电子表格安全处理；CSV 引号不会阻止 Excel/LibreOffice 把它解释成公式。

影响：

- 对象或失效模式含引号、逗号、CR/LF 时可破坏行列。
- 打开导出文件时，恶意或意外公式可能执行外部链接/命令类电子表格行为。

建议与验收：

- 使用单一 RFC 4180 encoder：双引号翻倍，统一 CRLF。
- 对公式前缀、前导 tab/CR/LF 做安全前缀或显式文本策略，并在文档说明。
- 测试引号、逗号、CRLF、Unicode、`=HYPERLINK(...)`、`+cmd`、`-1+2` 和 `@SUM(...)`。

### FE-13 — 核心交互缺少键盘和对话框语义

证据示例：

- `frontend/src/features/shell/ExplorerTree.tsx:54-106`：主导航为大量 `div onClick`，无 tree/button 语义和键盘入口。
- `frontend/src/components/eta/EtCanvas.tsx:138-158,170-178`：可点击 SVG `g/circle` 无 focus、role、键盘事件。
- `frontend/src/components/SequencePaths.tsx:34-51`、`frontend/src/components/ResultsPanel.tsx:72-99`、`frontend/src/features/fta/FtaWorkbench.tsx:187-221`：序列、割集和树选择主要只能用鼠标。
- `frontend/src/features/shell/CommandPalette.tsx:60-89`、`AccountsPanel.tsx`、`SaveConflictDialog.tsx` 及报告签发弹窗缺少 `role=dialog`、`aria-modal`、focus trap 和焦点恢复。
- `frontend/src/components/EventTreeEditor.tsx:322`、`frontend/src/features/eta/EtaWorkbench.tsx:327`：冷加载 Barrier FT 弹窗使用 `Suspense fallback={null}`，用户点击后可暂时无反馈。

建议：

- 导航采用原生 button/treeitem；SVG 交互提供可聚焦等价控件或可访问列表。
- Enter/Space 与点击等效，焦点样式可见。
- 对话框实现标题关联、Esc、focus trap、关闭后焦点恢复。
- 懒加载页面增加 ErrorBoundary；弹窗 fallback 显示明确加载态。

最低验收：

- 仅键盘可完成项目切换、ETA 选择、分支/序列选择、FTA 选择、量化和关闭弹窗。
- 运行 axe 的交互元素、名称、对话框和焦点规则。

### FE-14 — 前端门禁目前不是干净基线

实测：

- `npx tsc -b`：通过。
- `npm test`：35 个测试文件、320 项；318 通过、2 失败。失败位于 `frontend/src/App.aiDraftVisibility.test.tsx` 的 AI 草案应用后切 FTA 场景。
- 单独运行该文件：3/4 通过；失败时 DOM 已切到 FTA，但仍停留在 `载入模块…`。
- `frontend/src/App.aiDraftVisibility.test.tsx:147-159` 自定义等待上限固定为 2.5 秒，当前失败更像冷启动懒块转换与测试超时脆弱性；在修复前仍应把全量套件视为红色，而不是忽略。
- 测试过程有 ReportDossier、LoginWall 的 React `act(...)` 警告，降低异步失败信噪比。
- `npm run lint`：218 个问题（211 errors、7 warnings），lint 不能作为有效合入门。
- 当前运行时 Node `v20.12.2`；锁文件解析到 ESLint `10.5.0` / `@eslint/js 10.0.1`，其最低 Node 为 `^20.19.0`。`package.json` 没有 `engines`。
- 版本绊线测试只检查 React/Vite/ECharts/ag-grid 主版本，不检查 Node 下限、锁文件或精确兼容组合。

依赖审计：

- `npm audit --omit=dev --registry=https://registry.npmjs.org` 报告 ECharts `<6.1.0` 一个 moderate XSS 公告：[GHSA-fgmj-fm8m-jvvx](https://github.com/advisories/GHSA-fgmj-fm8m-jvvx)。
- 当前 `ResultsPanel.tsx:30-31` 只使用 bar series，公告描述的 line-series tooltip + 不可信 `data.name` 路径当前未发现可达。
- 项目硬约束禁止直接升级 ECharts 5。应把“不得新增不可信 line tooltip name”变成回归测试/能力边界，并评估上游补丁回移；不要执行 `npm audit fix --force`。

建议：

- 先修正懒加载测试：等待语义条件或预热模块，不使用 2.5 秒墙钟判定功能；清理 `act` 警告。
- 建立 lint 减债基线或按目录收紧，使新增错误无法进入；最终目标是全量 0 error。
- 在 `package.json`/工具链文档中钉定兼容的 Node 20 下限，并让 CI 与本地一致。
- 保持 Vite 5 / React 18 / ECharts 5 / ag-grid 32 主版本硬约束。

## 4. 次要发现

- `frontend/src/features/shell/ProjectDrawer.tsx` 没有调用方，是旧导航残留；删除前先确认无动态导入。
- `frontend/src/localStore.ts:7-15` 和 `frontend/src/libraryStore.ts:21-32` 把损坏 JSON 当空库，用户看起来像“所有本地项目/覆盖层消失”；应隔离坏数据并提供恢复/导出提示。
- Portfolio 的 `fmtE` 把合法数值 0 显示为“—”，混淆“零风险”和“未量化”。
- App 级懒页只有 Suspense，没有 ErrorBoundary；chunk 加载失败可能留下空白/永久 loading。
- 未发现 `dangerouslySetInnerHTML`、直接 `innerHTML=` 或 `eval(...)` 路径；当前更主要的安全风险是 CSV、导入完整性、认证状态和跨项目异步隔离。

## 5. 建议实施顺序

### 阶段 A — 先写规格与失败锚点

先定义两个跨层契约：

1. `AnalysisContext/AnalysisRequestV2`：唯一描述项目、模型、设置、请求和结果身份；
2. `WorkspaceAsyncOwnership`：规定异步 mutation、查询、保存、读档的槽归属和 last-intent/last-revision 语义。

首批失败测试：

- 报告请求与点量化请求逐字段一致；
- A 请求、切 B、A 返回，B 不变；
- old/new 逆序返回只保留 new；
- 初因树只走 frequency endpoint；
- H1 草稿恢复面对 H2 必须 409。

FE-01～FE-05、FE-08 涉及数值语义、隔离、状态机或并发，按项目规则须有 Fable 级规格和锚点测试；没有相应评审能力时不要直接改生产实现。

### 阶段 B — 数值与项目隔离

依次修复 FE-01、FE-03、FE-02、FE-05：

- 先统一请求构造；
- 再统一频率/概率端点；
- 然后引入槽定向写回和 run key；
- 最后让所有结果显示绑定 run key。

### 阶段 C — 持久化与证据链

修复 FE-04、FE-06、FE-07、FE-08、FE-11：

- 草稿 v2 + 保留 CAS；
- transport/auth/offline 错误分类；
- 项目查询 generation；
- workspace 级 mutation 串行化；
- AI 回执 outbox。

需要与 backend 报告中的 EB-02、EB-03、EB-07、EB-08 一起收口，避免只在前端遮盖后端非原子或不可重放问题。

### 阶段 D — 数据边界与 UX

修复 FE-09、FE-10、FE-12、FE-13：

- 明确项目参数库语义；
- 引入 runtime schema 和事务式导入；
- 修复 CSV；
- 补键盘/ARIA/ErrorBoundary。

### 阶段 E — 恢复可信门禁

- `npx tsc -b`
- `npm test`
- `npm run lint`
- 相关 Python/跨层测试
- `make check`
- 使用 `preview_eval` 做真实 UI DOM 交互验证
- 影响离线包时执行 `make bundle`

若修改 Engine 数值语义，另按项目硬约束执行 `make benchmark`；本报告本身未修改 Engine。

## 6. 修复完成定义

只有同时满足以下条件，才建议宣布前端收口：

- 量化、重要度、报告和案例固定使用同一可哈希请求；
- 所有异步提交都能证明属于原 workspace、目标、模型 revision 和设置；
- 初因频率路径不再经过概率端点；
- 草稿恢复保留 CAS，任何强制覆盖都显式且入审计；
- 项目/参考库导入在提交前完成严格 schema、单位、范围和来源校验；
- AI 应用审计可恢复、可重试、可见；
- 全量前端测试、`npx tsc -b`、lint 和适用的 `make check` 全绿；
- 真实 UI 通过多项目切换、慢响应、读档失败、会话过期、键盘操作和离线恢复对抗场景。

## 7. 审查限制

- 本次是代码审查和门禁验证，没有在当前工作区实施修复。
- 没有启动完整浏览器 E2E；并发结论来自确定性调用链/状态机冷读，修复时应以 deferred promise 和真实浏览器场景固化。
- 当前工作树存在大量用户已有的文件模式/换行差异；本次未清理、覆盖或纳入这些变化。
- `npm ci` 仅重建了被跨环境破坏的 ignored `node_modules`，没有升级受约束的前端主版本。
