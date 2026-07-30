# 审计:BANKED 站级跨舱 CCF v2 规格 + 红锚(engine-review,内联 Fable 执行)

对象:`docs/superpowers/specs/2026-07-27-station-ccf-v2-banked.md` +
`tests/banked/test_station_ccf_banked.py`(8fd3d91 入库;审计时基线 424c106,
已含 ST-6/7/8)。方式:子代理五次停在权限确认无法启动,经用户明示改由本会话
Fable 内联执行——**全部数值锚点以独立脚本重推导 + 暴力枚举对拍**(不复用入库
时的推导脚本结构),契约与校验逐线攻击。

## 攻击线裁决

| # | 攻击线 | 裁决 |
|---|---|---|
| 1 | 锚点数值(R-1 四指标 / R-2 坍缩律 214× / R-3 闭包) | **CONFIRMED-OK**:规格 §3 直译独立实现,R-1 四值 rel ≤ 6.4e-8(any/offsite 为文档 7 位截断,ge2/ge_row 达 1e-16);R-2 直算 == 坍缩律逐位,ge5 比值 214×;闭包 P_{0,1}(≥3)=0.1 = p₂ 精确。 |
| 2 | 概率论健全性(守恒 / ge2 不过门 / w_r 连贯) | **CONFIRMED-OK**:守恒 Σf_I+f_C = mf−(m−1)βf 数值精确;共因点燃绕过蔓延门物理成立(门只拦蔓延);w_r 两支互斥无缝(m_r≥k 直达 vs m_r<k 补足过双门,p_edge=1 时的"必然蔓延仍过门"与 v1 同律,非缺陷);独立成员火蔓延进其他成员 ≠ 共因事件重复计数(两条独立 Poisson 流,β 拆分保证总率不重复)。 |
| 3 | 单源一致律(无向闭包 ≡ 有向链) | **CONFIRMED-OK**:非对称边 [0.3,0.07] 全 i×k 网格,闭包枚举 vs 卷积公式差 <1e-15;chain 本身另与逐状态枚举对拍一致。\|S\|=1 时左右边集不相交 ⇒ 无向=有向,严格成立。 |
| 4 | 保守方向清单 | **FINDING SHOULD-FIX(F-4)**:跨排分计(保守)、时相(保守)已申报;但「共因事件同时多舱火灾沿用单舱案例的后果分布(响应资源可能被压垮)——低估方向」**未入申报文案**。已修:§6 横幅增该句。 |
| 5 | β=0 逐位律 | **FINDING SHOULD-FIX(F-3)**:代数上 (1−0)f、×1、+0.0 全部浮点精确 ✓;但若实现把成员/非成员**拆成两个求和再合并**,累加顺序变 ⇒ 末位 ULP 破 `==`。已修:§7 增实现约束——(1−β) 因子须**就地**作用于 v1 原循环原顺序,禁止分组重排求和。 |
| 6 | 锚点卫生 / quantify_pure 契约 | **FINDING SHOULD-FIX(F-1/F-2)**:①现行 `validate_station` 含案例存在性环节(`_load_case`),banked `_doc` 无 `project_uuid/case_id`——若 quantify_pure 直接复用,得 **KeyError 而非 422**(已实证)。已修:§6 明示校验拆分(结构性校验入纯入口;案例存在性/consequences 非空留壳)。②ST-6 后 `_eval_metrics(doc, fmap)` 的 fmap 按**产品**键——v2 的 (1−β) 拆分随 `member_cabins` 收窄是**按舱**的,per-product fmap 表达不了。已修:§6 明示实现须把 fmap 泛化为按舱有效频率(或在行循环内就地拆分),并优先复用 `_eval_metrics` 而非并行路径。探针 `closure_ge_k` 先落而 quantify_pure 未落 ⇒ 门控测试 AttributeError(响亮,可接受,NOTE)。 |
| 7 | 校验完备性 V-1..V-5 | **CONFIRMED-OK + 2 NOTE**:空 `member_cabins=[]` → m=0 → V-4 422 ✓;`member_products` 缺失 → V-2「恰 1 个」✓;beta 字符串 → float() 房规(接受数值串,与 `_chk01` 一致)NOTE;`member_cabins` 内重复 id → 已修:§5 V-3 增"成员集按集合去重后计 m"。跨排成员留 m_r=1 的排 → 闭包单源正常,无洞。 |
| 8 | 当日健康 | **CONFIRMED-OK**:banked 1 passed + 7 skipped(F-0 守 v1 流);tests/backend -k station 28 passed;424c106 CI 四作业绿。 |

## 修正落地(本次提交)

- §5 V-3:成员集去重语义(F-6→NOTE 落字)。
- §6:校验拆分明示(F-1)、按舱有效频率/复用 `_eval_metrics`(F-2)、横幅增
  同时多舱后果分布申报句(F-4)、ST-6 带通道一句注记(v2 落地时同拆分逐分位
  适用,NOTE)。
- §7:β=0 逐位律的实现约束——就地因子、禁分组重排(F-3)。
- 锚点测试与锚点数值**零改动**(全部裁决 OK)。

**总裁决:无 BLOCKING。规格数值内核经独立枚举对拍全确认;四处 SHOULD-FIX 均为
"实现被误猜"类欠定措辞,已当场修入规格。银行可安全作为实现授权。**
