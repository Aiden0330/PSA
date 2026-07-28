# 规格:站级验收准则判定(ST-7,mockup L 主视图)

上游:`2026-07-27-station-model.md`(v1 指标)+ `2026-07-27-station-bands.md`
(ST-6 带)。判定是**监管口径声明**——三条铁律:判据口径显式(禁隐式缺省)、
限值必须带依据(数据出处铁律)、无带不可判时响亮示"不可判"而非静默 pass/fail。

## 1. 文档 schema 增量

```json
"acceptance": [{ "metric": "ge5", "limit": 1e-6, "eval_basis": "point",
                 "basis": "NFPA 855 §4.x 场址风险目标(示例)", "label": "多舱蔓延目标" }]
```

- `metric` ∈ {any, ge2, ge5, ge_row, offsite}(枚举外 422)。
- `limit` 数值、有限、>0(/站·年;0 或负没有物理意义,422)。
- `eval_basis` ∈ {"point","p95"} **必填**——点值判还是 p95 保守判是监管口径,
  不设默认(隐式缺省不合法同律)。
- `basis` 必填非空:限值出处(法规/业主目标/内部准则)。`label` 可选。
- `acceptance` 缺省/空数组合法 = 无准则无判定(不是错误)。

## 2. 判定语义(quantify 内,随结果钉扎入案例)

对每条准则:取值 `value` = `metrics[metric]`(point)或 `bands[metric].p95`
(p95);判定:

- `pass` ⇔ value ≤ limit(**≤,含等号**——限值语义为"不得超过");
- `fail` ⇔ value > limit;
- `indeterminate` ⇔ eval_basis=p95 且 bands 为 null(无带不可判;value/margin
  置 null,附因)。**绝不静默降级为点值判**。
- `margin` = value/limit(<1 通过;监管沟通用"占用比";indeterminate 为 null)。

响应增 `acceptance_results: [{metric, label, limit, eval_basis, value, verdict,
margin, basis}]`,顺序 = 文档顺序。钉扎/报告自动携带(quantify 全量入案例)。

## 3. 出口

- **站页**:KPI 区下判定条——每准则一枚 chip(绿 PASS / 红 FAIL / 灰 不可判),
  显示 label/指标名(canonical 标签绑定:ge5 只配「≥5 舱(排内连片)」)、
  value vs limit、裕度百分比;FAIL 任一 ⇒ 顶部红色总横幅(不可隐藏)。
- **报告 docx**:新章「验收准则判定」表:准则|指标|判据口径|限值|取值|判定|裕度,
  逐条 basis 落文;存在 FAIL ⇒ 章首醒目声明;indeterminate 渲染"无带不可判"。
- 判定只是呈现,**不阻断**钉扎/导出(工作稿本就未签发;阻断语义留给站级签发
  通道 v2)。

## 4. 校验(422 响亮)

V-A metric 枚举外点名;V-B limit 非数值/≤0/非有限;V-C basis 缺失或空白;
V-D eval_basis 缺失或枚举外(必须显式)。校验在 validate_station(结构性,
不需案例数据)。

## 5. 锚点(tests/backend/test_station_acceptance.py)

夹具站(v1 3 舱 A,A,B,点值 ge2=2.695e-5、ge_row=1.1e-6;ST-6 带夹具
ge2 p95=6.23e-5):
A-1 point 判定:ge_row limit 1e-5 ⇒ pass,margin 0.11;ge2 limit 1e-5 ⇒ fail,
margin 2.695;顺序=文档序。A-2 p95 判定(带夹具):ge2 limit 1e-4 ⇒ pass,
value==6.23e-5;limit 5e-5 ⇒ fail。A-3 无带 + eval_basis=p95 ⇒ indeterminate,
value/margin null,附因;同站 point 准则正常判。A-4 校验 422×4(V-A..V-D)。
A-5 docx:判定表 + FAIL 声明 + basis 落文 + 标签绑定。A-6 前端 chips + FAIL
总横幅(vitest)。
