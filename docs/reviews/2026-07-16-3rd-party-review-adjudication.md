# 第三方评审(GPT-5.6)裁定与修复 backlog

*2026-07-16 · 源:`review_3rd_party/2026-07-16-engine-backend-code-review.md`(只读评审,
引擎+后端,12 发现)· 裁定人:Fable 5(逐条对代码核实,非照单全收)· 状态:已裁定,待执行*

## 0 · 总裁定

评审质量高(自证了 Windows 环境 30 失败为缺依赖非回归)。12 条中 **8 条属实值得修、
2 条部分成立、2 条已知/低价值**。最有价值:**EB-04 是本仓库 LFT 评审自己漏掉的同类
碰撞缺陷**(护栏只挡了 IE↔屏障轴,屏障↔屏障轴仍裸)。评审的"阶段 A 先统一执行与
重放契约"排序正确,采纳。

## 1 · 逐条裁定

| ID | 评审级 | 裁定 | 核实要点 | 归属 |
|---|---|---|---|---|
| EB-01 报告绕过集成 LFT + 忽略 house/bc | P0 | **确认** | report_export.py:75 只走 `event_tree_sequences`,无 ie_fault_tree/house 入参;quantify 有集成分支(app.py:124)报告没有 | **Fable 规格 F3** → Opus 实现 |
| EB-02 钉扎与计算解耦 | P0 | **确认** | `_pin_case` 独立 canonicalize `project_payload`,与计算请求零校验(app.py:139-154)——PFD=.9 的结果可钉到 PFD=.1 的版本 | **Fable 规格 F3** → Opus 实现 |
| EB-03 签发/退回非原子 | P1 | **确认** | store.py:607-612 SELECT-check 后无条件 UPDATE(无 `AND state='in_review'`、无 rowcount 检查);与 auth-B5 修过的 create_version 竞态同族 | **Fable F2** |
| EB-04 屏障↔屏障 ID 碰撞静默覆盖 | P1 | **确认(本仓库评审漏项)** | `_merged_barrier_pdag` 合并裸 `if nid not in big.nodes`(sequence.py:33-36);LFT F1 护栏只覆盖 IE↔屏障轴(:148/157);两屏障同名 `TOP` → 第二棵静默丢弃;CCF 生成名 `CCF_{gid}`/`{m}__I` 与用户命名空间也无冲突检查(ccf_expand.py:82-134) | **Fable F1** |
| EB-05 静默语义回退 | P1 | **确认(多处)** | method 裸 str(schemas.py:8)+ 未知值落 REA(analysis.py:36-39);branch 非 `failure` 一律 success(sequence.py:78,`'FAILURE'` 得 .8 非 .2);init_frequency 无非负校验;samples=0→500;EF<1 静默退化 | **Opus O1**(口径已定:全部响亮拒绝) |
| EB-06 local/off 认证与 CORS | P1 | **部分成立** | off 模式 `"*"`+credentials 为约束 #0 明文设计(无 cookie,代码注释已论证)——**不改**;但 local 模式开认证后读接口不设防(api_saved_list 无守卫,app.py:273 等)+ 本地恶意页可读删,属实 | **Opus O2**(口径已定,见 §3) |
| EB-07 CAS 与双写不原子 | P1 | **确认** | app.py:283-297:hash 检查/legacy 写/canonical 写三段分离;canonical 失败 `except: pass` 吞掉;storage.py:24 无 temp+rename | **Fable F2** |
| EB-08 canonical/replay 丢现代语义 | P1 | **确认** | canonical 只认三 kind(models.py:62);engine_request 只重建 `{value}`(:72);et_builder 强制 probability(:29);beta-CCF 重放 .01≠.018019;engine_version 恒 0.1.0 | **Fable 规格 F3** → Opus 实现 |
| EB-09 共享 ref 点值/抽样矛盾 | P1 | **确认(已裁决规则未执行)** | uncertainty.py:82 同 ref 取首中值;canonical 允许同 ref 异值——违反 spec A(2026-07-14)"同 ref 名=同认识论参数"前提 | **Opus O3**(执行既有裁决:load 边界点名拒绝) |
| EB-10 非相干模型返回相干割集 | P1 | **确认(窄)** | cutsets 只枚举正文字;app.py:82 无条件返回;`A∧¬B`:精确 .1 vs 割集 [A]/REA .2 | **Opus O4**(口径已定:PDAG 含 NOT/XOR → MCS/REA/MCUB 点名拒绝,提示 prime_implicants 通道) |
| EB-11 CUDD/ZBDD 非生产路径 | P2 | **已知,账本已诚实标注** | make_manager 存在但生产入口用 Python 内核——设计如此(CUDD=CI 正确性门);评审自己也建议只校能力声明 | **Opus O5**(声明措辞核对) |
| EB-12 交付缺口 | P2 | **混合** | CUDD importorskip 无前置断言(确认,值得加);make check 不含 benchmark(**设计**,CLAUDE.md 口径明确——补一行文档说明即可);wheel 不含 backend(确认,低优先——§5 部署为源码路径);异常响应 charset(确认,便宜);`.agents/skills` 指控为**读了不存在的旧路径,不成立** | **Opus O5** |

## 2 · Fable 批(禁独改类,须 Fable 亲做或规格先行)

### F1 — 屏障↔屏障合并碰撞护栏(EB-04)【小,先做】
- 规格要点:`_merged_barrier_pdag` 屏障合并施加与 LFT F1 同款判据(同 id 仅限
  同 param_ref 的 basic;门/异构 → 带树名+节点 id+双方定义的 ValueError);CCF 生成
  id(`CCF_*`/`*__I`)生成前查 node+parameter 双命名空间,冲突响亮。
- 锚点:评审两算例(TOP 撞名 .02/.08、CCF_G 覆盖 .901→.018019)转为先红锚;
  合法共享(同 param_ref 跨屏障)逐位不扰动锁;`make benchmark` 24/24。
- 门:engine-reviewer 轻扫(合并语义类)。

### F2 — 状态机与保存原子性(EB-03 + EB-07)【小,同批】
- sign/return:`UPDATE … WHERE id=? AND state='in_review'` + rowcount==1,失败映射
  ReviewStateError→409;转换+角色快照+审计同事务。
- 保存:CAS 检查与 create_version 同一 SQLite 事务(store 层新入口);legacy 文件
  temp+`os.replace`;canonical 失败不再吞——v2 载荷失败即 4xx,非 v2 载荷显式分型
  放行并打标(不静默)。
- 锚点:sign/sign、sign/return、return/sign、save/save 四组 Barrier 时序探针
  (B5-P3 同法);审计序与终态一致断言。
- 门:冷读对抗审查(状态机/并发类,套件全绿不豁免)。

### F3 — 「分析执行与证据重放 v2」规格(EB-01+02+08 同根)【重,规格先行】
- 单一 executor:quantify/report/uncertainty/importance 消费同一规范化执行输入;
  报告接集成 LFT 与 house/bc/CCF 设置并落卷;integrated 的 MC/importance 在
  受控规格前返回稳定 4xx(不回退普通 ETA)。
- 钉扎一致性:执行请求哈希入案例;payload↔request 不一致 → 409/422;或首选
  "从钉扎快照派生执行输入"。
- canonical v2:typed parameters(四精确 Q(t) 全字段)、CCF/BC/LFT 完整往返;
  engine 指纹 = semver+git SHA+schema version+benchmark corpus version。
- 黄金锚点:LFT anchor C 三表面逐位(quantify/CSV/docx);house 报告对拍;
  beta-CCF replay .018019;payload/request mismatch 拒绝;Q(t) 往返。
- 实现:规格+锚点(Fable)→ 机械实现(Opus)→ engine-reviewer + domain-reviewer
  (监管口径)两轮。

## 3 · Opus 批(可放行,口径已在本文定死)

- **O1(EB-05)**:method 改 `Literal["exact","mcub","rea"]`;branch 在 load 边界
  严格枚举 `success|failure`(其余点名拒绝);init_frequency/数值 finite 且非负;
  samples≥1、error_factor≥1;domain 校验错误统一 400/422 + UTF-8 charset。
  引擎文件被触碰 → `make benchmark` 必跑(应零差异)。
- **O2(EB-06)**:local 模式读接口至少 authenticated、删除 analyst+;off 模式 CORS
  维持 `"*"`(约束 #0)但在 TD-001 §5/安全注记写明威胁模型;补跨源预检/未认证读/
  越权删测试。
- **O3(EB-09)**:模型 load 边界执行 spec A 规则——同 ref 名跨树参数法则不一致 →
  点名树/ref 拒绝;锚点用评审算例(.1/.9 同 ref)。
- **O4(EB-10)**:PDAG 含 NOT/XOR 时 cutsets/REA/MCUB 请求 → 点名拒绝并提示
  prime_implicants;exact 概率不受影响;补 `A∧¬B` 锚点。
- **O5(EB-11+12)**:CI CUDD 作业加 `python -c "import dd.cudd"` 前置断言;异常
  handler 补 charset + 测试;TD-001/技能能力声明核对(CUDD=验证门、ZBDD=列表最小化
  的表述);make check 与 benchmark 分工在 README/TD-001 补一句口径;wheel 打包
  backend 记低优先待办。

## 4 · 顺序与冻结口径

采纳评审建议的精神但不全盘冻结:F1/F2/O1(便宜+高价值)即刻;F3 规格随后;
O2-O5 与 F3 实现并行。F3 收口前,**报告口径类新功能**冻结(报告/钉扎/导出);
引擎内核新算法本就无排期,不受影响。修复完成定义沿评审 §7(增补:每项修复
入 ROADMAP,锚点进回归)。
