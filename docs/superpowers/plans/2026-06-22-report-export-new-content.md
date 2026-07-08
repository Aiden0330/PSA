# 报告导出纳入新内容(C1–C5 内涵 / 主导序列 Top-N / FTA)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 QRA 报告(docx/pdf/csv)加入 ETA 的 C1–C5 内涵、主导事故序列 Top-10、每个挂载故障树屏障的 FTA 细节(顶概率 + Top-10 割集 + 基本事件 FV),保留原有全部内容。

**Architecture:** 主体后端:新增 `event_tree_sequences`(逐序列明细)与 `Analysis(model, fault_tree=fid)` 逐 FT 定量,扩展 `build_report_data` 返回新键、三渲染函数加新章节、`/api/report` 接线。前端仅在导出时多传 `consequence_defs`/`labels` 两个向后兼容字段。

**Tech Stack:** Python 3.12 / FastAPI / python-docx / reportlab(STSong-Light CJK)/ pytest(`.venv/Scripts/python.exe`);前端 React 18 + TS。

---

### Task 1: 引擎 `event_tree_sequences`(逐序列明细)

**Files:**
- Modify: `psaengine/eta/sequence.py`(在 `quantify_event_tree` 后新增函数,不改原函数)
- Test: `tests/backend/test_event_tree_sequences.py`(新建)

- [ ] **Step 1: 写失败测试**

Create `tests/backend/test_event_tree_sequences.py`:
```python
from bess.scenarios import build_scenario_model
from psaengine.eta.sequence import quantify_event_tree, event_tree_sequences


def test_sequences_sorted_and_conserved():
    model = build_scenario_model("SC_OVERCHARGE")
    seqs = event_tree_sequences(model, "TR")
    assert isinstance(seqs, list) and len(seqs) >= 2
    # 每项形态
    s0 = seqs[0]
    assert set(s0) >= {"end_state", "path", "consequence", "frequency"}
    assert isinstance(s0["path"], dict)
    # 降序
    freqs = [s["frequency"] for s in seqs]
    assert freqs == sorted(freqs, reverse=True)
    # 守恒: Σ序列频率 ≈ Σ后果频率
    total_seq = sum(freqs)
    total_cons = sum(quantify_event_tree(model, "TR")["consequences"].values())
    assert abs(total_seq - total_cons) <= 1e-12 + 1e-6 * total_cons
```

- [ ] **Step 2: 跑测试确认失败**

Run: `.venv/Scripts/python.exe -m pytest tests/backend/test_event_tree_sequences.py -v`
Expected: FAIL — `cannot import name 'event_tree_sequences'`。

- [ ] **Step 3: 实现 `event_tree_sequences`**

在 `psaengine/eta/sequence.py` 末尾(`quantify_event_tree` 之后)追加:
```python
def event_tree_sequences(model: Model, et_name: str, fe_overrides: dict | None = None) -> list[dict]:
    """逐序列明细(非聚合), 按 frequency 降序。复用 _build_event_tree / exact_probability。
    每项: {"end_state","path":{fe_id:"success|failure"},"consequence","frequency"}。"""
    b = _build_event_tree(model, et_name)
    et, big, m, all_basics = b.et, b.big, b.m, b.all_basics
    fe_bdd = dict(b.fe_bdd)
    if fe_overrides:
        for fid, mode in fe_overrides.items():
            fe_bdd[fid] = m.one if mode == "fail" else m.zero
    q = {bb: model.parameters.get(big.nodes[bb].param_ref).unavailability() for bb in all_basics}

    out: list[dict] = []
    for seq in et.sequences:
        expr = m.one
        for fe_id, branch in seq["path"].items():
            g = fe_bdd[fe_id]
            expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
        p = exact_probability(m, expr, q)
        out.append({
            "end_state": seq["end_state"],
            "path": dict(seq["path"]),
            "consequence": et.consequence_of(seq["end_state"]),
            "frequency": et.init_frequency * p,
        })
    out.sort(key=lambda s: s["frequency"], reverse=True)
    return out
```

- [ ] **Step 4: 跑测试确认通过**

Run: `.venv/Scripts/python.exe -m pytest tests/backend/test_event_tree_sequences.py -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add psaengine/eta/sequence.py tests/backend/test_event_tree_sequences.py
git commit -m "feat(engine): event_tree_sequences 逐序列明细(报告主导序列用)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `build_report_data` 扩展(consequence_defs / sequences / fta)

**Files:**
- Modify: `backend/report_export.py`(顶部加 import + `TOP_N` + 2 助手;改 `build_report_data`)
- Test: `tests/backend/test_report_new_content.py`(新建)

- [ ] **Step 1: 写失败测试**

Create `tests/backend/test_report_new_content.py`:
```python
from backend.et_builder import build_model_from_request
from backend.report_export import build_report_data
from psaengine.analysis import Analysis


def _linked_req() -> dict:
    """最小事件树: B1 挂 2-基本 OR 故障树, B2 仅 pfd。"""
    return {
        "init_event": "IE", "init_frequency": 1e-3,
        "functional_events": [{"id": "B1", "link_ft": "B1"}, {"id": "B2", "pfd": 0.1}],
        "fault_trees": {"B1": {"top": "B1", "nodes": [
            {"id": "b1a", "basic": True, "param_ref": "p_a"},
            {"id": "b1b", "basic": True, "param_ref": "p_b"},
            {"id": "B1", "op": "or", "args": ["b1a", "b1b"]}]}},
        "parameters": {"p_a": {"value": 0.05}, "p_b": {"value": 0.02}},
        "sequences": [
            {"path": {"B1": "success"}, "end_state": "L0"},
            {"path": {"B1": "failure", "B2": "success"}, "end_state": "L1"},
            {"path": {"B1": "failure", "B2": "failure"}, "end_state": "L2"}],
        "consequence_bins": {"L0": "C1", "L1": "C3", "L2": "C5"},
    }


def test_build_report_data_new_keys():
    model = build_model_from_request(_linked_req())
    d = build_report_data(model, "TR", consequence_defs={"C5": "自定义C5内涵"},
                          labels={"B1": "屏障一"}, linked_fe_ids=["B1"], samples=50, seed=1)
    # 旧键仍在
    assert set(d) >= {"consequences", "bands", "importance"}
    # 新键
    assert d["consequence_defs"]["C5"] == "自定义C5内涵"
    assert d["consequence_defs"]["C1"]  # 缺省回退非空
    assert isinstance(d["sequences"], list) and len(d["sequences"]) <= 10
    assert {"path_summary", "consequence", "frequency"} <= set(d["sequences"][0])
    # fta 仅含 linked B1, 顶概率与 Analysis 一致
    assert "B1" in d["fta"] and "B2" not in d["fta"]
    fta = d["fta"]["B1"]
    assert fta["label"] == "屏障一"
    assert fta["cutsets"] and {"events", "order", "prob"} <= set(fta["cutsets"][0])
    assert fta["basics"] and {"event", "fv"} <= set(fta["basics"][0])
    exp = Analysis(model, fault_tree="B1").probability()
    assert abs(fta["top_prob"] - exp) <= 1e-9
```

- [ ] **Step 2: 跑测试确认失败**

Run: `.venv/Scripts/python.exe -m pytest tests/backend/test_report_new_content.py -v`
Expected: FAIL — `KeyError: 'consequence_defs'`(或 `build_report_data` 不接受新关键字)。

- [ ] **Step 3: 改 `report_export.py` 顶部 import + 常量 + 助手**

把 `backend/report_export.py` 顶部:
```python
from __future__ import annotations
import csv, io
from psaengine.eta.sequence import quantify_event_tree
from psaengine.eta.uncertainty import event_tree_uncertainty, barrier_importance_exact
```
改为:
```python
from __future__ import annotations
import csv, io
from psaengine.eta.sequence import quantify_event_tree, event_tree_sequences
from psaengine.eta.uncertainty import event_tree_uncertainty, barrier_importance_exact
from psaengine.analysis import Analysis

TOP_N = 10
```
并在 `_DISCLAIMER = (...)` 定义之后追加两个助手:
```python
def _path_summary(path: dict, labels: dict | None) -> str:
    lab = labels or {}
    return " ".join(f"{lab.get(fid, fid)}{'✓' if br == 'success' else '✗'}" for fid, br in path.items())


def _barrier_name(fid: str, labels: dict | None) -> str:
    return (labels or {}).get(fid, fid)
```

- [ ] **Step 4: 改 `build_report_data`**

把 `backend/report_export.py` 的:
```python
def build_report_data(model, et_name: str = "TR", samples: int = 1000, seed: int = 42, error_factor: float = 3.0) -> dict:
    cons = quantify_event_tree(model, et_name)["consequences"]
    unc = event_tree_uncertainty(model, et_name, samples=samples, seed=seed, error_factor=error_factor)
    imp = barrier_importance_exact(model, et_name)
    return {"consequences": {c: float(cons.get(c, 0.0)) for c in _SEV}, "bands": unc["bands"], "importance": imp}
```
改为:
```python
def build_report_data(model, et_name: str = "TR", *, consequence_defs: dict | None = None,
                      labels: dict | None = None, linked_fe_ids: list | None = None,
                      samples: int = 1000, seed: int = 42, error_factor: float = 3.0,
                      top_n: int = TOP_N) -> dict:
    cons = quantify_event_tree(model, et_name)["consequences"]
    unc = event_tree_uncertainty(model, et_name, samples=samples, seed=seed, error_factor=error_factor)
    imp = barrier_importance_exact(model, et_name)

    cdefs = consequence_defs or {}
    consequence_out = {c: (cdefs.get(c) or _C_LABEL[c]) for c in _SEV}

    seqs = event_tree_sequences(model, et_name)[:top_n]
    sequences = [{"end_state": s["end_state"], "path_summary": _path_summary(s["path"], labels),
                  "consequence": s["consequence"], "frequency": s["frequency"]} for s in seqs]

    fta: dict[str, dict] = {}
    for fid in (linked_fe_ids or []):
        an = Analysis(model, fault_tree=fid)
        cuts = sorted(an.cutsets(cutoff=1e-12), key=lambda c: c.probability, reverse=True)[:top_n]
        imp_raw = an.importance(["fv"])  # 引擎返回事件键: {basic_event: {"fv": val}}
        fv = {be: vals["fv"] for be, vals in imp_raw.items() if "fv" in vals}
        fta[fid] = {
            "label": _barrier_name(fid, labels),
            "top_prob": float(an.probability()),
            "cutsets": [{"events": list(c.events), "order": c.order, "prob": float(c.probability)} for c in cuts],
            "basics": [{"event": k, "fv": float(v)} for k, v in
                       sorted(fv.items(), key=lambda kv: kv[1], reverse=True)[:top_n]],
        }

    return {"consequences": {c: float(cons.get(c, 0.0)) for c in _SEV}, "bands": unc["bands"],
            "importance": imp, "consequence_defs": consequence_out, "sequences": sequences, "fta": fta}
```

- [ ] **Step 5: 跑测试确认通过 + 不回归**

Run: `.venv/Scripts/python.exe -m pytest tests/backend/test_report_new_content.py tests/backend/test_report_export.py -v`
Expected: PASS(新测试通过;既有 `test_report_export.py` 因 `build_report_data(model,"TR",samples=,seed=)` 仍兼容、新键不影响而全绿)。

- [ ] **Step 6: Commit**

```bash
git add backend/report_export.py tests/backend/test_report_new_content.py
git commit -m "feat(report): build_report_data 加 consequence_defs/主导序列/FTA 数据" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 三格式渲染新章节(csv / docx / pdf)

**Files:**
- Modify: `backend/report_export.py`(`report_csv` / `report_docx` / `report_pdf`)
- Test: `tests/backend/test_report_new_content.py`(追加渲染断言)

- [ ] **Step 1: 写失败测试(追加)**

在 `tests/backend/test_report_new_content.py` 末尾追加:
```python
from backend.report_export import report_csv, report_docx, report_pdf


def _linked_data():
    from backend.et_builder import build_model_from_request
    model = build_model_from_request(_linked_req())
    return build_report_data(model, "TR", consequence_defs={"C5": "自定义C5内涵"},
                             labels={"B1": "屏障一"}, linked_fe_ids=["B1"], samples=50, seed=1)


def test_csv_has_new_sections():
    txt = report_csv(_linked_data()).decode("utf-8")
    assert "主导事故序列" in txt
    assert "FTA" in txt and "屏障一" in txt
    assert "自定义C5内涵" in txt


def test_docx_and_pdf_build_with_new_sections():
    d = _linked_data()
    b1 = report_docx(d, "测试场景", None)
    assert b1[:4] == b"PK\x03\x04" and len(b1) > 1000
    b2 = report_pdf(d, "测试场景", None)
    assert b2[:4] == b"%PDF" and len(b2) > 1000
```

- [ ] **Step 2: 跑测试确认失败**

Run: `.venv/Scripts/python.exe -m pytest tests/backend/test_report_new_content.py::test_csv_has_new_sections -v`
Expected: FAIL — csv 不含 "主导事故序列"/"FTA"。

- [ ] **Step 3: 改 `report_csv` —— 加内涵列源 + 新块**

把 `report_csv` 内首个写表循环:
```python
    w.writerow(["后果", "说明", "点估计/yr", "p05", "p50", "p95"])
    for c in _SEV:
        b = data["bands"].get(c, {})
        w.writerow([c, _C_LABEL[c], f"{data['consequences'].get(c, 0.0):.4e}",
                    f"{b.get('p05', 0.0):.4e}", f"{b.get('p50', 0.0):.4e}", f"{b.get('p95', 0.0):.4e}"])
```
改为(说明列改用自定义内涵,缺省回退):
```python
    cdefs = data.get("consequence_defs", {})
    w.writerow(["后果", "内涵", "点估计/yr", "p05", "p50", "p95"])
    for c in _SEV:
        b = data["bands"].get(c, {})
        w.writerow([c, cdefs.get(c, _C_LABEL[c]), f"{data['consequences'].get(c, 0.0):.4e}",
                    f"{b.get('p05', 0.0):.4e}", f"{b.get('p50', 0.0):.4e}", f"{b.get('p95', 0.0):.4e}"])
```
并在 `report_csv` 的 `return` 行之前(现有 importance 块之后)插入:
```python
    w.writerow([])
    w.writerow(["主导事故序列(Top-N)"])
    w.writerow(["序列", "路径", "后果", "频率/yr"])
    for s in data.get("sequences", []):
        w.writerow([s["end_state"], s["path_summary"], s["consequence"], f"{s['frequency']:.4e}"])
    for fid, f in data.get("fta", {}).items():
        w.writerow([])
        w.writerow([f"FTA:{f['label']}", f"顶概率={f['top_prob']:.4e}"])
        w.writerow(["割集#", "基本事件(∩)", "阶", "概率"])
        for i, c in enumerate(f["cutsets"], 1):
            w.writerow([i, " ∩ ".join(c["events"]), c["order"], f"{c['prob']:.4e}"])
        w.writerow(["基本事件", "FV"])
        for bsc in f["basics"]:
            w.writerow([bsc["event"], f"{bsc['fv']:.4f}"])
```

- [ ] **Step 4: 改 `report_docx` —— 加内涵表 + 主导序列 + FTA**

在 `report_docx` 中现有「后果频率」表渲染之后、`doc.add_heading("风险矩阵...")` 之前,插入后果内涵表:
```python
    doc.add_heading("后果内涵(C1–C5)", level=1)
    dt = doc.add_table(rows=1, cols=2); dt.style = "Table Grid"
    dt.rows[0].cells[0].text = "后果"; dt.rows[0].cells[1].text = "内涵"
    cdefs = data.get("consequence_defs", {})
    for c in _SEV:
        cells = dt.add_row().cells
        cells[0].text = c; cells[1].text = cdefs.get(c, _C_LABEL[c])
```
并在「屏障重要度 FV/RAW」表渲染之后、`if tree_png:` 之前,插入主导序列表与 FTA 段:
```python
    doc.add_heading("主导事故序列(Top-N)", level=1)
    st = doc.add_table(rows=1, cols=4); st.style = "Table Grid"
    for i, h in enumerate(["序列", "路径", "后果", "频率/yr"]):
        st.rows[0].cells[i].text = h
    for s in data.get("sequences", []):
        cells = st.add_row().cells
        cells[0].text = s["end_state"]; cells[1].text = s["path_summary"]
        cells[2].text = s["consequence"]; cells[3].text = f"{s['frequency']:.2e}"

    for fid, f in data.get("fta", {}).items():
        doc.add_heading(f"FTA:{f['label']}(顶概率 {f['top_prob']:.2e})", level=2)
        ct = doc.add_table(rows=1, cols=4); ct.style = "Table Grid"
        for i, h in enumerate(["割集#", "基本事件(∩)", "阶", "概率"]):
            ct.rows[0].cells[i].text = h
        for i, c in enumerate(f["cutsets"], 1):
            cells = ct.add_row().cells
            cells[0].text = str(i); cells[1].text = " ∩ ".join(c["events"])
            cells[2].text = str(c["order"]); cells[3].text = f"{c['prob']:.2e}"
        bt = doc.add_table(rows=1, cols=2); bt.style = "Table Grid"
        bt.rows[0].cells[0].text = "基本事件"; bt.rows[0].cells[1].text = "FV"
        for bsc in f["basics"]:
            cells = bt.add_row().cells
            cells[0].text = bsc["event"]; cells[1].text = f"{bsc['fv']:.3f}"
```

- [ ] **Step 5: 改 `report_pdf` —— 加内涵表 + 主导序列 + FTA**

在 `report_pdf` 中「后果频率」表 story 追加之后、风险矩阵之前,插入:
```python
    cdefs = data.get("consequence_defs", {})
    drows = [["Cx", "内涵" if cn else "definition"]] + [[c, cdefs.get(c, lbl[c])] for c in _SEV]
    dt = Table(drows, colWidths=[2 * cm, 13 * cm]); dt.setStyle(grid_style())
    story += [Paragraph("后果内涵(C1–C5)" if cn else "Consequence definitions", h2), dt, Spacer(1, 8)]
```
并在「屏障重要度 FV/RAW」表 story 之后、`if tree_png:` 之前,插入:
```python
    srows = [["seq", "path", "Cx", "freq/yr"]]
    for s in data.get("sequences", []):
        srows.append([s["end_state"], s["path_summary"], s["consequence"], f"{s['frequency']:.2e}"])
    st = Table(srows); st.setStyle(grid_style())
    story += [Paragraph("主导事故序列(Top-N)" if cn else "Dominant sequences (Top-N)", h2), st, Spacer(1, 8)]

    for fid, f in data.get("fta", {}).items():
        story += [Paragraph((f"FTA:{f['label']}(顶概率 {f['top_prob']:.2e})" if cn
                             else f"FTA: {f['label']} (top {f['top_prob']:.2e})"), h2)]
        crows = [["#", "cutset (∩)", "order", "prob"]]
        for i, c in enumerate(f["cutsets"], 1):
            crows.append([str(i), " ∩ ".join(c["events"]), str(c["order"]), f"{c['prob']:.2e}"])
        ct = Table(crows); ct.setStyle(grid_style())
        brows = [["basic", "FV"]] + [[bsc["event"], f"{bsc['fv']:.3f}"] for bsc in f["basics"]]
        bt = Table(brows); bt.setStyle(grid_style())
        story += [ct, Spacer(1, 4), bt, Spacer(1, 8)]
```

- [ ] **Step 6: 跑测试确认通过 + 不回归**

Run: `.venv/Scripts/python.exe -m pytest tests/backend/test_report_new_content.py tests/backend/test_report_export.py -v`
Expected: PASS(新章节断言通过;既有 5 个 report_export 测试仍全绿)。

- [ ] **Step 7: Commit**

```bash
git add backend/report_export.py tests/backend/test_report_new_content.py
git commit -m "feat(report): csv/docx/pdf 渲染 C1–C5 内涵 + 主导序列 + FTA 章节" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: schema 加字段 + `/api/report` 接线

**Files:**
- Modify: `backend/schemas.py:53-55`(ReportRequest +2 字段)
- Modify: `backend/app.py:47-56`(`/api/report` 接线)
- Test: `tests/backend/test_report_api.py`(追加用例)

- [ ] **Step 1: 写失败测试(追加)**

该文件已有模块级 `client = TestClient(app)` 与 `_req()`(返回最小合法 ETA 请求体,`consequence_bins` 最差为 `C3`)。在文件末尾追加:
```python
def test_report_with_new_fields():
    payload = {**_req(), "consequence_defs": {"C3": "自定义末态"}, "labels": {"FE1": "屏障甲"}}
    r = client.post("/api/report?format=csv", json=payload)
    assert r.status_code == 200
    assert "自定义末态" in r.content.decode("utf-8")   # 内涵列回写自定义文字
```
> 说明:`_req()` 的 FE 均为 `pfd`(无 link_ft),故 `fta` 为空——本用例验证 `consequence_defs` 接线;FTA 渲染已由 Task 3 的 `test_csv_has_new_sections` 用挂载 FT 的模型覆盖。

- [ ] **Step 2: 跑测试确认失败**

Run: `.venv/Scripts/python.exe -m pytest tests/backend/test_report_api.py -v`
Expected: FAIL —— 响应不含 "自定义末态"(字段未接线)。

- [ ] **Step 3: 改 `schemas.py` ReportRequest**

把 `backend/schemas.py:53-55`:
```python
class ReportRequest(EtUncertaintyRequest):
    scenario_name: str = "ETA"
    tree_png: Optional[str] = None    # 'data:image/png;base64,...'
```
改为:
```python
class ReportRequest(EtUncertaintyRequest):
    scenario_name: str = "ETA"
    tree_png: Optional[str] = None    # 'data:image/png;base64,...'
    consequence_defs: dict[str, str] = {}   # C1..C5 自定义内涵(空则回退内置)
    labels: dict[str, str] = {}             # fe_id → 人类可读屏障名
```

- [ ] **Step 4: 改 `app.py` `/api/report` 接线**

把 `backend/app.py` 中:
```python
    model = build_model_from_request(req.model_dump())
    data = rx.build_report_data(model, "TR", samples=req.samples, seed=req.seed, error_factor=req.error_factor)
```
改为:
```python
    dumped = req.model_dump()
    model = build_model_from_request(dumped)
    linked_ids = [fe["id"] for fe in dumped["functional_events"] if fe.get("link_ft")]
    data = rx.build_report_data(model, "TR", consequence_defs=req.consequence_defs, labels=req.labels,
                                linked_fe_ids=linked_ids, samples=req.samples, seed=req.seed,
                                error_factor=req.error_factor)
```

- [ ] **Step 5: 跑测试确认通过 + 不回归**

Run: `.venv/Scripts/python.exe -m pytest tests/backend/test_report_api.py -v`
Expected: PASS(新用例通过;既有端点用例因新字段有默认值而向后兼容,全绿)。

- [ ] **Step 6: Commit**

```bash
git add backend/schemas.py backend/app.py tests/backend/test_report_api.py
git commit -m "feat(report): ReportRequest 加 consequence_defs/labels + /api/report 接线 linked FT" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 前端导出多传两字段 + 全量回归

**Files:**
- Modify: `frontend/src/components/EventTreeEditor.tsx:76`
- (验证)`tests/backend` 全量 + `npm run build`

- [ ] **Step 1: 改导出调用**

把 `frontend/src/components/EventTreeEditor.tsx:76`:
```tsx
      await exportReport(fmt, { ...req, samples: 1000 }, model.initEvent, png)
```
改为:
```tsx
      await exportReport(fmt, {
        ...req, samples: 1000,
        consequence_defs: model.consequenceDefs ?? {},
        labels: Object.fromEntries(model.functionalEvents.map((f) => [f.id, f.label])),
      }, model.initEvent, png)
```

- [ ] **Step 2: 前端构建**

Run: `npm run build --prefix frontend`
Expected: 通过(无 TS 报错;`model` 即该组件已有的 `EventTreeModel`,含 `consequenceDefs` 与 `functionalEvents`)。

- [ ] **Step 3: 后端全量回归**

Run: `.venv/Scripts/python.exe -m pytest -q`
Expected: 全绿(≥137 旧 + 本轮新增,CUDD 仍 2 skipped)。

- [ ] **Step 4: (可选)preview 真导出验证**

若需可视验证:`preview_start` 后端 `bess-app`(或复用运行中的 :8000)+ 前端,导出 csv,`preview_network`/下载体确认含「主导事故序列」「FTA」「自定义内涵」。重包 `preview_screenshot` 会超时 → 用 `preview_eval` 触发导出并查请求/响应。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/EventTreeEditor.tsx
git commit -m "feat(frontend): 导出报告时传 consequence_defs/labels(C1–C5 内涵 + 屏障人名)" -m "Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- C1–C5 内涵 → Task 2(数据 `consequence_defs`)+ Task 3(csv 列/docx-pdf 内涵表)+ Task 4/5(请求字段)✅
- 主导事故序列 Top-N → Task 1(`event_tree_sequences`)+ Task 2(sequences[:top_n])+ Task 3(三格式表)✅
- FTA(顶概率/Top-N 割集/基本事件 FV)→ Task 2(`Analysis` 逐 FT)+ Task 3(三格式段)✅
- 屏障重要度/不确定度 保留 → 不改原 importance/bands 渲染,Task 2 保留旧键 ✅
- Top-N=10 → `TOP_N=10` 常量(Task 2)✅
- 屏障人名 labels → Task 2 `_barrier_name`/`_path_summary` + Task 4/5 传入 ✅
- 向后兼容 → 新字段默认值、`build_report_data` 旧签名兼容(Task 2/4),既有报告测试不回归(Task 2/3/4 验收)✅

**2. Placeholder scan:** 仅 Task 4 Step 1 的 `client_and_payload` 为显式占位并给出替换指引(因 `test_report_api.py` 既有构造方式需实施时对齐);其余均为完整代码与确切命令。

**3. Type consistency:** `event_tree_sequences`(Task 1)→ `build_report_data` 调用(Task 2)一致;`build_report_data` 新签名(Task 2)→ `/api/report` 调用(Task 4)关键字一致;数据键 `consequence_defs/sequences(path_summary,end_state,consequence,frequency)/fta(label,top_prob,cutsets[events,order,prob],basics[event,fv])` 在 Task 2 定义、Task 3 渲染逐字一致;`Analysis(...).probability()/.cutsets(cutoff=)/.importance(["fv"])["fv"]` 与引擎实际签名一致。
