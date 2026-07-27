# 规格:站级评估 v1(功能②;C′ 画布 + D 骨架)

*2026-07-27 · Fable 5 · 依据:调研 §2/§7/§8(MU-PSA 复用单元结果 + 跨单元依赖清单;
C′ 增补清单即数据需求)。数值语义新增 ⇒ 本规格先行 + 手算锚点 + engine-reviewer 门。
按易变序排列。*

## 0 · 铁律(继承对比页)

产品 = 系统项目的**已钉扎 report 案例**(舱级频率直读案例,绝不现算,版本哈希续接证据链);
站级量化只做**站层组合**(新代码,不触 psaengine)。上游模型出新版 ⇒ 舱标"有更新版本",
不自动漂移。

## 1 · 数据实体(station_models,服务端)

```
{ id, name, created_*, modified_at,
  products: [{ key:'A', label, project_uuid, case_id }],          // 2–4 个,复用对比页校验
  rows: [{ id:'Z1', label, cabins:[{ id:'A-01', product:'A' }],   // 行=排=防火分区
           walls:[int] }],                                         // 墙位:cabins[i]|cabins[i+1] 之间
  edge_defaults: { intra_p: 0.10, wall_p: 0.03, inter_row_p: 0.02,
                   refs: { intra:'B_SPACING', ... } },             // 参考库快照(grade/note/url 随边走)
  edge_overrides: [{ from, to, p, note }],                         // 个别边改写(留痕)
  station_barriers: [{ key, label, pfd, grade, scope, basis }],    // 站级链(C′ 底条)
  ccf_groups: [{ key, label, member_products:['A'], beta, basis }],// 申报清单(v1 只登记显示)
  offsite: { p_fence: 0.10, basis } }
```

## 2 · v1 量化语义(点值;公式即锚点,改式必改锚)

记舱 i 火灾频率 f_i = 案例 C3+ 尾和(consPlus 同式);f4_i = C4+ 尾和。
边 p_ij:同排相邻 = intra_p(有墙取 wall_p);跨排同列 = inter_row_p;其余 0。
站级链闸:G_sup = 站级消防 PFD;G_er = 应急响应 PFD(链上其余项 v1 并入二者的 basis,
不重复相乘——就绪⊕条件有效在 pfd 内已分解,防双计)。

- **任一舱**:F_any = 1 − Π_i (1 − f_i)(精确,非稀有近似)
- **≥2 舱**:F_2 = Σ_i f_i · esc_i · G_sup,esc_i = 1 − Π_{j∈adj(i)} (1 − p_ij)
- **≥k 舱(k≥3,连片蔓延模型)**:火沿排内**连续区间**扩展,左右两向独立:
  P(左扩 a 舱) = Π 前 a 条左向边 p × (1−p_下一边,若存在)——**墙只是把该边 p 换成 wall_p
  (衰减),不截断分布**;右同;
  chain_i(k) = Σ_{a+b ≥ k−1} P(L=a)·P(R=b)(逐向枚举,精确);
  F_k = Σ_i f_i · chain_i(k) · G_sup · G_er。跨排贡献 v1 不入 ≥k 链(仅入 F_2 的 esc),
  记为已声明的**非保守简化**之一。
  **双指标(评审 BLOCKING-1 裁定)**:`ge5` = 固定 k=5(排长 <5 的排贡献 0——排内模型下
  literal ≥5 不可达,响应申报);`ge_row` = 整排(k=每排长,响应逐排携带 k)。前端标签
  必须与指标一一对应:「≥5 舱」只许绑 ge5,「整排」只许绑 ge_row——8 舱排下二者相差
  数量级(0.1⁷ vs 0.1⁴ 尺度),错绑即静默低估。
- **站界外**(不嵌套舱数链):F_off = [1 − Π_i (1 − f4_i)] · p_fence。
- **跨舱 CCF**:v1 **只申报与显示,不入点值**——组内联动的正确通道是引擎级(SOKC 同族,
  禁独改类),页面明示「点值未计入跨舱 CCF(低估方向),计入通道见 v2 规格」。
  方向声明:连续区间模型忽略跳跃蔓延(飞火/爆炸抛射)与跨排链式——两者均**非保守**,
  与 CCF 缺席同向,页面同一句口径承载;时间相位不给消防增信(保守);
  ≥3 排时跨排邻居按 (排数−1) 计,对边排属**保守**高估(评审 NOTE-7,申报);
  any/offsite 为年概率变换、ge* 为速率线性和——量纲约定「/站·年」,f≪1 时差异 <0.05%
  (评审 NOTE-8,申报)。per_source_rank 以 f×chain5 排序(整排链在排内不区分源)。

**手算锚点(3 舱一排,f=1e-4,f4=1e-5,p=0.1 无墙,G_sup=0.5,G_er=0.5,p_fence=0.2)**
- F_any = 1−(1−1e-4)³ = 2.99970001e-4
- esc = [0.1, 0.19, 0.1] ⇒ F_2 = 1e-4·0.39·0.5 = 1.95e-5
- chain(3):端舱单向 0.01;中舱需两向各 1 = 0.01 ⇒ F_3 = 3e-6·0.25·… = 1e-4·0.03·0.25 = 7.5e-7
- 墙插在 1|2:esc=[0.03,0.13,0.1]… 锚点表在测试内逐位。
- F_off = [1−(1−1e-5)³]·0.2 = 2.99997e-5 × 0.2 ≈ **5.99994e-6**(评审 R-3:初稿此处把已乘过闸的结果又乘 0.2,写低 5×;实现一直正确)

## 3 · API

- station_models CRUD(compare_groups 同款:引用不复制、审计三动作、悬空响亮);
- **输入校验(评审 R-4/5/6)**:所有 p/pfd/p_fence ∈ [0,1] 否则 422;`edge_overrides`
  必须命中某条排内相邻对(**无序匹配**,任一方向写法均生效),否则 422 点名——禁止静默
  空转;墙位越界(∉[0, 排长−2])422;`edge_defaults.intra_p` 必填,≥2 排时 `inter_row_p`
  必填,`offsite.p_fence` 必填(显式 0 合法,隐式缺省不合法——零默认是风险抹除方向);
  产品案例 `consequences` 为空 ⇒ 422 响亮(与悬空案例 404 同律)。
- `GET /api/station/{id}/quantify`:装载产品案例 + §2 公式 ⇒
  `{ metrics{any,ge2,ge5,ge_row,offsite}, rows:[{id,k,…}], per_cabin[{id,f,f4,esc,chain5}], per_source_rank,
     products[…对比页 member 同形], declared{ccf_groups, simplifications[]} }`;
  产品案例校验复用 compare._load_case(404/422 点名)。

## 4 · 前端(全局区「站级评估」,C′ 版面收敛版)

选择器(站型列表 + 新建向导:选产品→行×列/配比→墙位)→ KPI 条(quantify.metrics)→
画布(行=分区,舱格=供应商色+f 值,墙红条;v1 无拖拽,编辑走表单)→ 底条站级链
(chips 点开侧栏卡)→ 产品配置表(§C′ 全列)→ 舱检视器(产品参数段+IE 推导行+边列表)。
口径行常驻:铁律 + CCF/跳跃蔓延未计声明。

## 5 · 锚点

py:§2 五式逐位(含墙截止/中舱两向/跨排不入链);CRUD/审计/悬空;quantify 端到端。
fe:向导建站型→quantify 渲染;推导行数值=后端 per_cabin;链 chips/CCF 申报显示。
**engine-reviewer 门**:§2 公式与实现(数值语义新增)。

## 6 · 非目标(v1)

跨舱 CCF 入值(v2,引擎级)· 跳跃/跨排链式蔓延 · 拖拽画布编辑 · 验收准则判定(L,v2)·
站型对比(K,依赖本实体版本化)· 不确定带(需站级 MC,v2)。
