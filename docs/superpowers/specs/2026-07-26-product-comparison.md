# 规格:系统对比页(功能①,B′ 主视图)

*2026-07-26 · Fable 5 · 依据:调研 `2026-07-25-multi-system-station-survey.md` §1/§6、
mockup B′(`2026-07-26-compare-dashboard-radar`)+ A 下钻;用户裁决:放全局区、
对比案例组实体、结构对齐门。按易变序排列。*

## 0 · 铁律(继承组合总览)

对比**绝不现算**:每个对比成员 = 一个**已钉扎分析案例**(kind=report),其
`results_json` 携带 consequences 点值 + bands,案例锚定 version_hash——证据链闭环。
工作稿要参与,先保存生成版本并量化钉扎,与报告同规矩。

## 1 · UI(最易变)

- 全局区新树项「系统对比」(tab `compare`),组合总览兄弟页。
- 页结构:①选择器(组合总览项目列表 × 每项目 report 案例下拉,含 `#vhash` 短码;
  2–4 列,首列默认基准,可换)→ ②B′ 主视图三卡:风险矩阵落点(pin=各成员 C4+ 点值
  所在频段;riskmatrix 同色语义)、四轴雷达、不确定带并排(p05/p50/p95,直读案例
  bands)+ 汇总表(C3+/C4+/C5,Δ% vs 基准,grade 构成徽章)→ ③下钻:逐场景参数
  Δ 表(A 方向密度:FE 对齐行,PFD 双/多值 + grade/口径徽章 + Δ%)+ ◇ 隔离区
  → ④「保存为对比案例组」/「导出 CSV」。
- **雷达 v1 偏离记录**:轴 = C3+ 频率、C4+ 频率、不确定带宽(p95/p50)、数据置信
  (FE 快照 grade 构成映射 1–5,分档规则页内可见)。H 稿的"CCF 暴露/可加固性"两轴
  依赖站级模型与主观准则,**推迟**,页脚注明。分数不进证据链(H 稿黄条口径)。

## 2 · 对齐门(结构可比性)

- ETA 匹配:跨成员按 **ref**(v2 tab key;场景库出身同键)配对;仅在部分成员出现的
  ETA 进 ◇ 区(仅总量可比说明)。
- FE 匹配:配对 ETA 内按 **fe.ref** 对齐;FE ref 序列完全一致 ⇒ 「共享结构」,
  参数 Δ 行全量呈现;不一致 ⇒ 该 ETA 标 ◇(总量可比、逐屏障 Δ 仅对交集 ref,
  差集列成员专属行)。禁止静默硬比。

## 3 · 后端

- `GET /api/compare/assemble?members=<puuid>:<caseId>,...&base=<idx>`(2–4 成员):
  逐成员载案例 + `get_version(include_doc)`,返回
  `{members:[{project{uuid,name,saved_id},case{id,kind,created_at,vid,version_hash},
  consequences,bands?,grade_mix{A,B,C,D,none},etas:[{ref,name,init_freq,
  fes:[{ref,label,pfd,grade,category,url,note,citation}]}]}],alignment{...}}`。
  fes 数据源 = canonical FunctionalEvent + Provenance(屏障快照 2026-07-25 已让
  grade/url/note 进 canonical——本页是它的第一个跨项目消费者)。
  错误:成员数 <2/>4 → 422;案例不存在/kind 非 report → 404/422,消息点名成员。
- 对比案例组:`compare_groups(id,name,members_json,base_index,created_at,created_by,
  modified_at)` + CRUD `/api/compare/groups[...]`,变更走既有审计表。组保存**引用**
  (puuid+case_id),不复制数字——重开时重新 assemble,案例被删则响亮报缺。

## 4 · 锚点

- py:assemble 双成员共享结构逐字段;FE 序列不一致 ⇒ divergent + 交集 Δ;ETA 部分
  缺席 ⇒ ◇;成员数/kind 校验;grade_mix 计数;组 CRUD + 审计 + 引用失效响亮。
- fe:页面组装渲染(pin 档位、Δ%、◇ 区)、CSV 内容、案例组保存/重开、雷达分档映射。

## 5 · 非目标(v1)

Word 章节导出(G 形态,phase 2)· E 树叠加视图 · importance Δ 自动归因(需
importance 案例,phase 2)· 组的评审/签发状态机 · 不确定性现场重算。
