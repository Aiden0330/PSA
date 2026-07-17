# BANKED 规格:CCF 组内认知联动抽样(MC 通道,SOKC 穿透展开层)

*2026-07-17 · Fable 5 铸造(禁独改:改既有 MC 数字 ⇒ 落地时 semver → 0.4.0)· 状态:
**入库待实现** · 源:批次 F engine-review **F-4**(限制注记转正)· 锚点:
`tests/banked/test_ccf_sokc_banked.py`(探针门控)*

## 0 · 激活探针

`psaengine.model.parameters.Parameter` 具字段 `epistemic_source`(dataclass fields 探测,
零构造)⇒ 激活。交付 = 锚点全绿 + engine-reviewer 收口 + semver 0.4.0 重定基。

## 1 · 病根

CCF 展开(`ccf_expand`)为一组铸 2^m−1 个事件,各持独立参数 ref(`CCF_G_*` / `*__I`)。
同质性校验强制全组同一 Q_t——认知上 2^m−1 个 Q_k **同源一个库参数**,但三条 MC 通道
(单树/聚合/集成,批次 F 后均按 ref 联合抽样)把它们当独立认知源逐 ref 抽:并联贡献的
上分位按 ~√n 收窄,**方向非保守**(与批次 F 修掉的单树同病,只是藏在展开层)。g=8 组
255 个铸参时收窄最重。

## 2 · 语义(S-D)

`q_levels` 对 Q_t **线性** ⇒ 认知联动 = 整组共乘一个抽样因子:

- `ccf_expand` 给每个铸参标 `epistemic_source = <组代表成员的 ref>`(组员 ref 经同质性
  校验同 Q_t,取排序首成员;普通参数该字段 None)。
- MC 抽样:带 `epistemic_source` 的 ref **不独立抽**——其样本 =
  `median_minted × (sampled[source_ref] / median_source)`(source_ref 若不在树内亦纳入
  抽样空间;比例缩放后仍截 [0,1])。三通道同法则。
- 点通道零扰动(不抽样);EF=1 逐位退化照旧。

## 3 · 锚点

| # | 断言 | 判别力 |
|---|---|---|
| L1 | OR(A,B) beta 组(并联铸参):p95/median ∈ [2.6, 3.4](≈EF=3 全联动) | 独立抽 ≈ e^{1.645σ/√3} ≈ 1.9 —— √n 收窄的直接判别 |
| L2 | EF=1 → bands ≡ 点通道逐位(CCF 模型) | 退化正确 |
| L3 | 无 CCF 模型:批次 F 冻结流逐位不变(A7 同款锁) | 零扰动边界 |
| L4 | 集成通道同法则(IE∧屏障 + CCF 组):L1 同判别 | 三通道一致 |
| L5 | 缩放后截断:median 0.6 × 因子 >1.67 的样本封 1.0 | [0,1] 铁律 |

含 CCF 模型的 MC 带相对 0.3.x 变宽(修正方向保守)⇒ semver 0.4.0 + 迁移注记。

## 4 · 非目标

aggregate 跨树同组 CCF 的组识别(组 id 命名空间跨树语义未裁);phi 模型直接指定级
(Q_k 非线性于单一 Q_t 时按各级独立源处理——phi 语义本就是逐级直接指定,不联动)。

## 5 · F-3 附带裁定(非错峰 alpha 缺键静默 0)

**engine 维持宽容**:非错峰 alpha 的 α_t 自归一是 alpha 模型自身数学(NUREG/CR-5485),
部分指定合法;漏写高阶键的防线放**前端 CCF 因子编辑处 lint**(Σα 偏 1 超容差黄条提示,
不阻断)+ 参考库录入校验,不在引擎加拒绝(会误伤合法部分谱)。积压至 UI backlog。
