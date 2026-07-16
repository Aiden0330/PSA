"""F3 阶段 1(EB-01 薄片)先红黄金锚点:报告接集成 LFT + house/bc 透传 +
集成 uncertainty/importance 响亮拒绝。

规格:docs/superpowers/specs/2026-07-16-analysis-execution-evidence-replay-v2.md
本文件今日全红——证明 EB-01 断裂存在(报告绕过集成 LFT、忽略 house 设置);实现
阶段 1 后转绿。锚点值 = quantify 通道现算(已正确),报告必须与之逐位同源。

激活:report 请求接受 ie_fault_tree 字段(schemas.ReportRequest)且报告点结果走集成
通道即视为实现——阶段 1 落地前,请求会因缺字段/走普通 ETA 而红。
"""
import csv
import io

import pytest
from fastapi.testclient import TestClient

from backend import schemas
from backend.app import app

client = TestClient(app)

# 阶段 1 激活探针:build_report_data 增 house_states 入参 ⇒ 报告接边界/集成通道已落地
# (ie_fault_tree 字段经继承已在,不能作探针——EtUncertaintyRequest 承自 EtQuantifyRequest)。
# 未落地时跳过(banked 惯用),锚点今日红=EB-01 断裂证据(G9 控制项证明 harness 无误)。
def _phase1_live() -> bool:
    import inspect
    from backend import report_export as rx
    return "house_states" in inspect.signature(rx.build_report_data).parameters


pytestmark = pytest.mark.skipif(
    not _phase1_live(),
    reason="F3 阶段 1(EB-01 薄片)未实现——报告接集成 LFT + house 透传 + 集成拒绝;"
           "规格 docs/superpowers/specs/2026-07-16-analysis-execution-evidence-replay-v2.md")


# ── anchor C 的 API 请求形(集成 LFT:IE=AND(I,S),屏障顶=OR(S,X),共享 S)──────

def _anchor_c_report_req(fmt="csv"):
    return {
        "init_event": "IE", "init_frequency": 0.0,      # 集成模式不用标量初频
        "functional_events": [{"id": "FE_B", "link_ft": "FE_B"}],
        "fault_trees": {
            "FE_B": {"top": "B_TOP", "nodes": [
                {"id": "S", "basic": True, "param_ref": "S"},
                {"id": "X", "basic": True, "param_ref": "X"},
                {"id": "B_TOP", "op": "or", "args": ["S", "X"]}]}},
        "parameters": {"S": {"value": 0.2}, "X": {"value": 0.1}},
        "sequences": [{"path": {"FE_B": "failure"}, "end_state": "S_FAIL"},
                      {"path": {"FE_B": "success"}, "end_state": "S_OK"}],
        "consequence_bins": {"S_FAIL": "C3", "S_OK": "C1"},
        "ie_fault_tree": {
            "name": "__init__", "top": "IE_TOP",
            # 共享事件 S 在 IE 树内也须声明为 basic(两树各自校验,合并按 id 统一)
            "nodes": [
                {"id": "I", "basic": True, "param_ref": "I"},
                {"id": "S", "basic": True, "param_ref": "S"},
                {"id": "IE_TOP", "op": "and", "args": ["I", "S"]}],
            "parameters": [{"id": "I", "kind": "frequency", "value": 1e-3}]},
        "scenario_name": "anchorC", "samples": 200, "seed": 1,
    }


def _csv_consequences(text: str) -> dict:
    # 只取第一个后果块(后果,内涵,点估计/yr,…);值在第 3 列。后续重要度块也含 Cx 行,
    # 须在遇到第二个表头/空行时停,否则被 FV 覆盖。
    rows, in_block = {}, False
    for row in csv.reader(io.StringIO(text)):
        if row and row[0].strip() == "后果" and "点估计/yr" in ",".join(row):
            in_block = True
            continue
        if not in_block:
            continue
        if not row or not row[0].strip():
            break
        if row[0].strip() in ("C1", "C2", "C3", "C4", "C5") and len(row) >= 3:
            try:
                rows[row[0].strip()] = float(row[2])
            except ValueError:
                pass
    return rows


# ── G1:LFT anchor C 三表面逐位(quantify vs CSV vs docx)──────────────────────

def _quantify_anchor_c():
    req = _anchor_c_report_req()
    r = client.post("/api/event-tree/quantify", json=req)
    assert r.status_code == 200, r.text
    body = r.json()
    return body["consequences"]


def test_G1_report_csv_matches_integrated_quantify_bitwise():
    qc = _quantify_anchor_c()
    assert qc["C3"] == pytest.approx(2e-4, rel=1e-12)     # 集成正确值
    assert qc["C1"] == pytest.approx(0.0, abs=1e-18)
    r = client.post("/api/report?format=csv", json=_anchor_c_report_req("csv"))
    assert r.status_code == 200, r.text
    cc = _csv_consequences(r.text)
    # 报告必须与集成 quantify 逐位——此前报告走普通 ETA:C3≈5.6e-5、C1≈1.44e-4
    assert cc.get("C3") == pytest.approx(qc["C3"], rel=1e-12), f"报告 C3={cc.get('C3')} 应={qc['C3']}"
    assert cc.get("C1", 0.0) == pytest.approx(qc["C1"], abs=1e-15)


# ── G2:house 报告对拍 ────────────────────────────────────────────────────────

def _house_req(fmt="csv", house_on=False):
    # TOP = OR(A, AND(A2, H_MAINT)):H=False → 只 A 失败路径;H=True → 多一条
    return {
        "init_event": "IE", "init_frequency": 1e-3,
        "functional_events": [{"id": "FE_B", "link_ft": "FE_B"}],
        "fault_trees": {
            "FE_B": {"top": "TOP", "nodes": [
                {"id": "A", "basic": True, "param_ref": "A"},
                {"id": "A2", "basic": True, "param_ref": "A2"},
                {"id": "H_MAINT", "house": True, "state": False},
                {"id": "G", "op": "and", "args": ["A2", "H_MAINT"]},
                {"id": "TOP", "op": "or", "args": ["A", "G"]}]}},
        "parameters": {"A": {"value": 0.2}, "A2": {"value": 0.5}},
        "sequences": [{"path": {"FE_B": "failure"}, "end_state": "S_FAIL"},
                      {"path": {"FE_B": "success"}, "end_state": "S_OK"}],
        "consequence_bins": {"S_FAIL": "C5", "S_OK": "C1"},
        "house_states": {"H_MAINT": house_on},
        "scenario_name": "house", "samples": 200, "seed": 1,
    }


def test_G2_report_honors_house_states():
    # 点计算(quantify)在 house_on 下 C5 升高;报告必须同值(此前报告忽略 house → 旧值)
    q_on = client.post("/api/event-tree/quantify", json=_house_req(house_on=True)).json()["consequences"]
    q_off = client.post("/api/event-tree/quantify", json=_house_req(house_on=False)).json()["consequences"]
    assert q_on["C5"] > q_off["C5"] + 1e-9                # house 确实改变点结果
    r = client.post("/api/report?format=csv", json=_house_req("csv", house_on=True))
    assert r.status_code == 200, r.text
    cc = _csv_consequences(r.text)
    assert cc.get("C5") == pytest.approx(q_on["C5"], rel=1e-9), \
        f"报告 C5={cc.get('C5')} 应={q_on['C5']}(house 被忽略即回退 off 值 {q_off['C5']})"


# ── G3:集成模式 uncertainty/importance 响亮拒绝(不回退普通 ETA)──────────────

def test_G3_integrated_uncertainty_rejected_not_fallback():
    req = _anchor_c_report_req()
    r = client.post("/api/event-tree/uncertainty", json=req)
    assert r.status_code == 422, f"集成 uncertainty 应 422,得 {r.status_code}: {r.text[:200]}"
    assert "集成" in r.text or "integrated" in r.text.lower()


def test_G3_integrated_importance_rejected_not_fallback():
    req = _anchor_c_report_req()
    r = client.post("/api/event-tree/importance", json=req)
    assert r.status_code == 422, f"集成 importance 应 422,得 {r.status_code}: {r.text[:200]}"


# ── G9:single scope 零扰动(回归锁)──────────────────────────────────────────

def _plain_req(fmt="csv"):
    return {
        "init_event": "IE", "init_frequency": 1e-3,
        "functional_events": [{"id": "FE_B", "pfd": 0.1}],
        "fault_trees": {}, "parameters": {},
        "sequences": [{"path": {"FE_B": "failure"}, "end_state": "S_FAIL"},
                      {"path": {"FE_B": "success"}, "end_state": "S_OK"}],
        "consequence_bins": {"S_FAIL": "C3", "S_OK": "C1"},
        "scenario_name": "plain", "samples": 200, "seed": 1,
    }


def test_G9_plain_report_unchanged():
    q = client.post("/api/event-tree/quantify", json=_plain_req()).json()["consequences"]
    assert q["C3"] == pytest.approx(1e-3 * 0.1, rel=1e-12)
    r = client.post("/api/report?format=csv", json=_plain_req("csv"))
    assert r.status_code == 200, r.text
    cc = _csv_consequences(r.text)
    assert cc.get("C3") == pytest.approx(q["C3"], rel=1e-9)
