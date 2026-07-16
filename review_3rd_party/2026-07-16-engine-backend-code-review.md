# Engine & Backend 代码审查与修复交接

- 日期：2026-07-16
- 范围：`psaengine/`、`backend/`，以及与报告、canonical、持久化相关的跨层契约
- 性质：只读审查；本文档不包含代码修改
- 目标：供另一环境按优先级制定规格、补锚点测试并实施修复

## 1. 结论

Engine 在合法、无冲突输入下的核心数学能力已经较成熟：精确 ROBDD/Shannon 概率、成功分支精确否定、初因频率通道、CCF 数学以及集成 LFT 点计算均有较强测试基础。

当前主要风险不在“缺少新算法”，而在以下跨层闭环尚未统一：

1. 实际参与计算的请求；
2. 报告展示的结果；
3. analysis case 固定的 canonical 版本；
4. 持久化的有效设置与 Engine 构建身份；
5. 评审、签发和并发保存的原子状态。

因此，在 P0/P1 问题关闭前，建议冻结新的 Engine/Backend 功能开发。优先建立统一的执行记录与证据重放契约，再修复具体入口。

## 2. 修复约束

以下约束来自项目既有规则，修复时不可绕过：

- Engine 数值语义、ID 合并语义、LFT/CCF/Q(t) 语义改变，必须先有 Fable 级规格和解析锚点测试。
- `psaengine/` 数值改动必须运行 `make test-py`、完整 property/parity 套件和 `make benchmark`；单元测试全绿不构成收口。
- `backend/store.py` 状态机、乐观并发、认证和证据链绑定属于高风险路径，必须有独立时序探针和 fresh-context 对抗审查。
- 不得通过回退普通 ETA、丢弃 Q(t) 字段或静默采用默认值来“兼容”不支持的分析。无法保证语义时必须明确拒绝。
- 不要修改“ROBDD 不采用 complement edge”和“ETA 成功分支使用精确否定”这两个有意设计。

## 3. 发现总览

| ID | 严重度 | 发现 | 主要影响 |
|---|---|---|---|
| EB-01 | P0 | 报告绕过集成 LFT，并忽略部分分析设置 | 监管报告可能发布错误频率 |
| EB-02 | P0 | 结果可绑定到无关 canonical 版本 | 证据链无法证明结果来自所固定模型 |
| EB-03 | P1 | 签发/退回采用非原子状态转换 | 并发下可出现非法签发顺序 |
| EB-04 | P1 | 屏障 FT 与 CCF 自动 ID 冲突会静默覆盖 | 合法请求可得到数量级错误结果 |
| EB-05 | P1 | API/Engine 输入存在静默语义回退 | 拼写错误、非法值可能被当作有效分析 |
| EB-06 | P1 | local/off 模式的认证与 CORS 暴露 | 本机项目可能被未认证或跨源页面读取/删除 |
| EB-07 | P1 | 乐观并发检查与双存储写入不原子 | 两个过期保存可同时成功，证据库与文件可分叉 |
| EB-08 | P1 | canonical/replay 契约丢失 Q(t)、CCF、BC、LFT | 已固定版本不能完整重放实际分析 |
| EB-09 | P1 | 聚合不确定性共享 ref 契约矛盾 | 点值与分位带可能基于不同模型 |
| EB-10 | P1 | 非相干模型仍返回相干 MCS/REA 结果 | API 同时返回互相矛盾的概率与割集 |
| EB-11 | P2 | CUDD/ZBDD 能力尚未接入生产路径 | 能力声明和规模预期可能超过实际实现 |
| EB-12 | P2 | CI、打包、错误响应与文档存在交付缺口 | 绿色门禁不能完整证明可部署、可复现 |

## 4. 详细发现

### EB-01 — 报告绕过集成 LFT，并忽略部分分析设置

**位置**

- `backend/app.py:117-137`：点计算会根据 `ie_fault_tree` 进入集成求解器。
- `backend/app.py:177-245`：`/api/report` 重新构造普通 ETA，并调用普通报告路径。
- `backend/report_export.py:71-77`：报告使用普通 `event_tree_sequences`、`event_tree_uncertainty` 和 `barrier_importance_exact`。
- `frontend/src/components/EventTreeEditor.tsx:166-177`
- `frontend/src/features/report/ReportDossier.tsx:64`

**已复现证据**

使用集成 LFT 规格 anchor C：

- `/api/event-tree/quantify`：C3 = `2.0e-4`，C1 = `0`
- `/api/report?format=csv`：C3 = `5.6e-5`，C1 = `1.44e-4`

报告低估约 3.6 倍，并生成物理上不可能的成功序列。另一个探针显示，点计算应用 house event 后 C5=`1e-3`，报告仍输出 C5=`0`。

**期望修复**

- 建立唯一的 analysis executor，quantify/report/uncertainty/importance 均消费同一规范化执行输入。
- 报告直接使用集成 LFT 点结果。
- integrated LFT 的 MC uncertainty 和 barrier importance 在完成受控规格前，应返回明确的 unsupported 错误，不能回退普通 ETA。
- 报告必须保存并展示有效的 house event、boundary-condition、CCF 和 LFT 设置。

**最低验收测试**

- anchor C 在 quantify、CSV、Word/PDF 报告中的点结果逐位一致。
- house event 与 boundary-condition 的报告/点计算对拍。
- 未支持的 integrated uncertainty/importance 返回稳定的 4xx 域错误。

### EB-02 — 结果可绑定到无关 canonical 版本

**位置**

- `backend/app.py:139-154`：`_pin_case` canonicalize 独立的 `project_payload`。
- `backend/app.py:186-214`：报告先按请求计算，再固定 payload。
- `backend/app.py:351-358`：不确定性同样分离计算输入与固定 payload。
- `backend/app.py:367-374`：重要度同样分离。

**已复现证据**

固定 payload 的 PFD=`0.1`，分析请求的 PFD=`0.9`。接口返回 HTTP 200，结果 C2=`0.9`，但 analysis case 的版本哈希指向 PFD=`0.1` 的模型。

**期望修复**

- 首选：从已固定的 canonical snapshot 派生唯一执行请求。
- 备选：保存并比较规范化的实际 engine-request hash，payload 与请求不一致时拒绝。
- analysis case 持久化 `model_hash`、`request_hash`、resolved settings、request schema version 和 build fingerprint。

**最低验收测试**

- 不同 payload/request 的对抗用例必须返回 409 或 422。
- 从 analysis case 重放后结果与原结果逐位一致。
- CCF、LFT、house/boundary、Q(t) 都包含在 hash 与重放测试中。

### EB-03 — 签发/退回采用非原子状态转换

**位置**

- `backend/store.py:599-613`：sign 先 SELECT/check，再无条件 UPDATE。
- `backend/store.py:616-630`：return 使用同一模式。
- `backend/store.py:99-104`：触发器只阻止 `OLD.state='signed'` 的后续更新，不能防止过期读取。

**已复现证据**

强制交错：退回事务先提交，持有旧 `in_review` 读取的签发随后仍成功；审计顺序出现 `review.return -> review.sign`。

**期望修复**

- 使用 `UPDATE ... WHERE id=? AND state='in_review'`，检查 `rowcount == 1`。
- 状态更新、角色快照和审计写入处于同一事务。
- 对 SQLite 锁、重试和异常映射给出明确策略。

**最低验收测试**

- sign/sign、sign/return、return/sign 三组 Barrier 并发探针。
- 每次最多一个转换成功，失败方得到稳定 409。
- 审计顺序与最终状态一致。

### EB-04 — 屏障 FT 与 CCF 自动 ID 冲突会静默覆盖

**位置**

- `psaengine/eta/sequence.py:27-32`：屏障树合并仅保留首次出现的节点。
- `psaengine/preprocess/ccf_expand.py:82-95`
- `psaengine/preprocess/ccf_expand.py:127-139`

**已复现证据**

- 两棵屏障树中的 `TOP` 分别表示 `A(q=.1)` 与 `B(q=.2)`，实际得到 `FF=.1、FS=0`，正确结果应为 `.02、.08`。
- 用户已有 `CCF_G(q=.9)` 时，beta CCF 展开将其覆盖为 `.01`，顶事件从 `.901` 变为 `.018019`，没有异常。

**期望修复**

- 抽取唯一 PDAG merge 函数，统一处理 barrier↔barrier、IE↔barrier。
- 只有相同 `param_ref` 的 basic，或结构完全一致且规格明确允许的节点才能共享 ID。
- CCF 内部生成 ID 使用不可歧义编码；生成前同时检查 node 与 parameter 命名空间。
- 所有冲突都应带树名、节点 ID 和双方定义响亮拒绝。

### EB-05 — API/Engine 输入存在静默语义回退

**位置**

- `backend/schemas.py:5-15`：method 为任意字符串。
- `psaengine/analysis.py:34-39`：未知 method 落入 REA。
- `psaengine/eta/sequence.py:78-80,198-200,255-257`：非 `failure` 一律视为 success。
- `psaengine/model/event_tree.py:12-16`：初因频率无 finite/range 校验。
- `psaengine/eta/uncertainty.py:29-30,89-90`：samples 与 EF 缺少约束。

**已复现证据**

- `method='excat'` 返回 HTTP 200，并执行 REA。
- `branch='FAILURE'`、q=`.2` 时返回 `.8` 而不是 `.2`。
- `init_frequency=-1` 产生负频率。
- `samples=0` 进入内部异常并返回 500。
- `error_factor<1` 静默退化为确定性结果。

**期望修复**

- method 使用严格枚举 `exact|mcub|rea`。
- branch 集中解析并严格枚举 `success|failure`。
- 所有数值要求 finite；频率非负、samples≥1、EF≥1。
- gate arity、k 范围、空门、重复定义和链接完整性在加载边界统一校验。
- domain validation error 统一映射为带 UTF-8 charset 的 400/422 JSON。

### EB-06 — local/off 模式的认证与 CORS 暴露

**位置**

- `backend/app.py:20-31`：off 模式允许任意 Origin 且启用 credentials。
- `backend/app.py:272-324`：saved list/get/delete 未完整守卫。
- `backend/app.py:440-518`：项目、版本、审计、案例和评审读接口未完整守卫。
- `backend/app.py:653-656`：AI drafts list 未守卫。

**已复现证据**

在 local 模式下，未认证访问 `/api/projects`、`/api/portfolio`、`/api/saved`、`/api/ai/drafts` 均返回 200。off 模式从 `https://evil.example` 请求 `/api/saved`，响应反射该 Origin 且 `Access-Control-Allow-Credentials: true`。

**期望修复**

- local 模式私有读取至少要求 authenticated；删除要求 analyst 或更高角色。
- off 模式保持离线零摩擦，但 CORS 默认只允许受信任本地前端 Origin。
- 增加跨源预检、未认证读取和越权删除测试。

### EB-07 — 乐观并发检查与双存储写入不原子

**位置**

- `backend/app.py:283-297`：base hash 检查、legacy 文件写入、canonical 写入相互分离。
- `backend/storage.py:20-27`：文件直接写入，无 temp+atomic replace/锁。
- `backend/app.py:291-297`：canonical 失败被广泛吞掉。

**已复现证据**

两个并发请求携带相同 `base_version_hash` 时可同时通过检查并返回 200。合法 Q(t) payload canonicalize 失败时，legacy 保存仍可返回成功，但 evidence store 中没有对应版本。

**期望修复**

- 选择 SQLite canonical store 为权威真源，或设计明确的 transactional outbox；避免无事务双写。
- CAS 检查与新版本创建必须位于同一数据库事务。
- legacy-only 兼容必须通过明确类型/版本识别；canonical 失败不可静默吞掉。

### EB-08 — canonical/replay 契约丢失现代 Engine 语义

**位置**

- `backend/canonical/models.py:60-68`：只接受 probability/rate/frequency。
- `psaengine/model/parameters.py:12-24`：Engine 还支持 exponential、glm、weibull、periodic_test。
- `backend/canonical/engine_request.py:72-80`：参数重建仅输出 `{value}`。
- `backend/et_builder.py:28-30`：请求参数被强制为 probability。
- `backend/store.py:128-133`：engine identity 仅依赖安装包版本。
- `pyproject.toml:3`：版本长期为 `0.1.0`。

**已复现证据**

- canonical 对 Weibull、periodic-test payload 抛 ValidationError。
- beta-CCF 模型重建后 C2=`.01`，正确结果为 `.018019`。
- 当前 `engine_version()` 返回 `0.1.0`，不能区分重大数值实现变更。

**期望修复**

- 建立 versioned engine-request contract v2，完整保存 typed parameters、Q(t) 系数、distribution、CCF、BC、LFT 和时间设置。
- Engine 构建指纹至少包含 semver、git SHA/build ID、dirty marker、request schema version、benchmark corpus version。
- JSON/MEF 暂不支持某种模型时明确拒绝导出，不能将 Q(t) 静默固化为当前概率。

### EB-09 — 聚合不确定性共享 ref 契约矛盾

**位置**

- `psaengine/eta/uncertainty.py:81-83`：相同 ref 只记录首次中值。
- `backend/canonical/models.py:12-14`：当前 canonical 允许不同树中同 ref 具有不同值。

**已复现证据**

两棵树使用同一 ref，参数中值分别为 `.1/.9`，EF=1。点结果 C2=`.001`，但 p05/p50/p95 均为 `.0002`。

**期望修复**

规格必须明确 ref 是全局身份还是树内身份。若为全局身份，完整参数法则必须一致；不一致应点名树/ref 拒绝。若为树内身份，应显式命名空间化。

### EB-10 — 非相干模型仍返回相干 MCS/REA 结果

**位置**

- `psaengine/quantify/cutsets.py:12-30`：仅枚举正文字路径。
- `backend/app.py:80-97`：所有模型无条件返回 cutsets。

**已复现证据**

模型 `A AND NOT B`，qA=`.2`、qB=`.5`：精确概率=`.1`，接口 cutset=`[A]`、cutset probability/REA=`.2`；prime implicant `{A:true,B:false}` 才与模型一致。

**期望修复**

- 规格明确非相干模型的 API：拒绝 MCS/REA/MCUB，或改为显式 prime implicants/literal cut sets。
- 响应中不得把仅含正事件的结果标为该非相干模型的最小割集。

### EB-11 — CUDD/ZBDD 尚未接入生产路径

**位置**

- `psaengine/bdd/kernel.py:101-111`：存在 `make_manager` factory。
- `psaengine/analysis.py:29`
- `psaengine/eta/sequence.py:54,162`
- `psaengine/quantify/frequency.py:119,150`

以上生产入口仍直接构造 Python `BddManager`。MCS 路径还直接读取 Python manager 内部节点；当前 ZBDD 主要用于 BDD 路径枚举后的 Python 列表最小化，而非完整符号化 ZBDD 构造。

**处理建议**

近期只需校正能力声明。待有真实规模需求和性能基线后，再设计 backend selection、MCS abstraction 和 10k-event 压测，不要先于 P0/P1 正确性问题。

### EB-12 — 交付与文档缺口

- `.github/workflows/ci.yml:37-57`：CUDD 测试使用 `importorskip`，CI 没有 skip-count/preflight 守卫，可在 CUDD 未加载时仍绿色。
- CI 与 Makefile 使用浮动依赖，未以 `uv.lock` 为唯一安装来源。
- `Makefile:37` 的 `make check` 未包含 benchmark，与“完整门禁”描述不一致。
- `pyproject.toml:30` 包发现只包含 `psaengine*`、`bess*`，构建 wheel 不包含 backend；editable 安装掩盖问题。
- 默认异常响应缺少 `application/json; charset=utf-8`。
- `AGENTS.md`、`.agents/skills/psa-engine/SKILL.md` 和旧 ROADMAP 段落对已关闭/未关闭 parity gap 的描述不一致。

**处理建议**

- CI 显式 `import dd.cudd` 并拒绝意外 skip。
- 使用 locked dependency sync；构建 wheel 后在干净环境 smoke-import `backend.app`。
- 将 benchmark 纳入明确的 Engine gate。
- 增加 HTTPException/validation exception handler 的 charset 测试。
- 以 parity ledger 为 live source，旧路线图标记为历史快照。

## 5. 建议实施顺序

### 阶段 A — Analysis Execution & Evidence Replay v2 规格

先写规格和失败测试，不直接改实现。定义：

- 单一 `AnalysisRequest` / `ExecutionRecord`；
- 从 pinned canonical snapshot 派生执行输入；
- normalized request hash 与 resolved settings；
- model/version/build/schema/benchmark 指纹；
- quantify/report/uncertainty/importance 的统一模式分发；
- unsupported integrated 分析的错误契约。

首批黄金锚点：LFT anchor C、house/boundary 报告一致性、beta-CCF replay、payload/request mismatch、Q(t) roundtrip。

### 阶段 B — 状态机、并发与安全

修复 EB-03、EB-06、EB-07。必须包含 SQLite 真实时序探针、角色矩阵和跨源浏览器测试；完成后做独立对抗冷读。

### 阶段 C — Engine 信任边界

修复 EB-04、EB-05、EB-09、EB-10。优先增加严格拒绝与碰撞锚点，再修改合并/量化行为。数值语义变化必须跑完整 benchmark。

### 阶段 D — Canonical v2 与可复现交付

修复 EB-08、EB-12，并补全 JSON/MEF semantic roundtrip、wheel smoke、locked CI、build fingerprint。

### 阶段 E — 新能力

仅在上述闭环稳定后推进：

- integrated LFT MC uncertainty；
- integrated barrier importance；
- periodic-test Complete 与 regime-A 已裁决规格的激活；
- configuration-risk delta cases；
- checked-set uncertainty UI 触发；
- CUDD 生产选择与规模测试。

不要重新实现或退化已经正确的 exact BDD point、exact success-branch negation、exact IE frequency、beta-CCF 数学和 integrated LFT point core。

## 6. 审查验证记录与限制

执行过的针对性跨层命令：

```text
python -m pytest -q \
  tests/benchmark/test_tier1_closed_form.py \
  tests/test_sequence_lft_integration.py \
  tests/unit/test_qt_models.py \
  tests/unit/test_ie_frequency.py \
  tests/backend/test_et_integrated_api.py
```

结果：`57 passed`。

额外 Engine 审查套件结果：`93 passed, 3 skipped`；3 项为 CUDD 未加载时的 skip。完整 Python 非 benchmark 执行结果为 `367 passed, 30 failed, 60 skipped`。30 个失败均发生在当前 Windows 全局 Python 缺少 `argon2-cffi`、`reportlab` 的路径，不能据此认定为代码回归。

完整 `tests/benchmark` 在本审查 Windows 环境约 124 秒后超时，因此本文不声明 benchmark 全绿。仓库内 `.venv` 是从 macOS 复制的环境，不能在 Windows 直接作为可信验证环境。修复环境应重新执行 locked install 和完整门禁。

本审查没有修改 Engine 或 Backend 源码，也没有提交任何变更。

## 7. 修复完成定义

只有同时满足以下条件，才可宣称本轮收口：

1. P0/P1 每项都有失败测试先行和明确的规格引用；
2. quantify、report、analysis case replay 在黄金模型上逐位一致；
3. 状态机与保存通过真实并发时序测试；
4. local/off 的认证、CORS 和角色矩阵通过接口与浏览器验证；
5. `make test-py`、property/parity、完整 `make benchmark` 全绿；
6. wheel 在干净环境可安装并启动 backend；
7. fresh-context 对抗审查没有新增 P0/P1；
8. 更新当前 ROADMAP/parity ledger，清楚区分 Engine-core parity 与 end-to-end regulator delivery。
