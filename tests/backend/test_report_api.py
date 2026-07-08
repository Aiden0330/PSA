from fastapi.testclient import TestClient
from backend.app import app

client = TestClient(app)


def _req():
    return {
        "init_event": "IE", "init_frequency": 1.0,
        "functional_events": [{"id": "FE1", "pfd": 0.1}, {"id": "FE2", "pfd": 0.2}],
        "fault_trees": {}, "parameters": {},
        "sequences": [
            {"path": {"FE1": "success"}, "end_state": "L0"},
            {"path": {"FE1": "failure", "FE2": "success"}, "end_state": "L1"},
            {"path": {"FE1": "failure", "FE2": "failure"}, "end_state": "L2"},
        ],
        "consequence_bins": {"L0": "C1", "L1": "C2", "L2": "C3"},
        "scenario_name": "单元测试场景", "samples": 80,
    }


def test_report_csv():
    r = client.post("/api/report?format=csv", json=_req())
    assert r.status_code == 200 and "text/csv" in r.headers["content-type"]
    assert "C3" in r.content.decode("utf-8")


def test_report_docx():
    r = client.post("/api/report?format=docx", json=_req())
    assert r.status_code == 200 and r.content[:4] == b"PK\x03\x04"


def test_report_pdf():
    r = client.post("/api/report?format=pdf", json=_req())
    assert r.status_code == 200 and r.content[:4] == b"%PDF"


def test_report_bad_format():
    assert client.post("/api/report?format=xls", json=_req()).status_code == 400


def test_report_with_new_fields():
    payload = {**_req(), "consequence_defs": {"C3": "自定义末态"}, "labels": {"FE1": "屏障甲"}}
    r = client.post("/api/report?format=csv", json=payload)
    assert r.status_code == 200
    body = r.content.decode("utf-8")
    assert "自定义末态" in body   # consequence_defs 内涵列回写自定义文字
    assert "屏障甲" in body       # labels 屏障名写入主导序列路径


def test_report_api_renders_fta_for_linked_ft():
    """全栈: 带挂载故障树的请求 → /api/report 提取 linked_ids → 报告含 FTA 段。"""
    payload = {
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
        "labels": {"B1": "屏障一"}, "samples": 50,
    }
    r = client.post("/api/report?format=csv", json=payload)
    assert r.status_code == 200
    body = r.content.decode("utf-8")
    assert "FTA" in body and "屏障一" in body   # linked_ids 提取 → FTA 段渲染
