"""spec A(2026-07-14 组合总览聚合范围钉扎):/api/report 与 /api/event-tree/uncertainty 的
scope=checked_set 通道 —— 请求演进(additive)、响亮校验、钉扎形状(§2.3)、报告 scope
标识全表面(§2.4)。引擎语义(联合抽样/均值/分位判据)锁在 tests/test_eta_aggregate_uncertainty.py。"""
import io
import zipfile

import backend.storage as storage
import pytest
from fastapi.testclient import TestClient

from backend.app import app

client = TestClient(app)

PUUID = "7d3f0a90-0000-5000-8000-aaaa567890ab"


def _payload():
    return {"v": 2,
            "etas": [{"key": "t", "name": "T",
                      "model": {"initEvent": "IE", "initFreq": 0.001,
                                "functionalEvents": [{"id": "FE1", "failProb": 0.1}],
                                "root": {"kind": "branch", "feId": "FE1",
                                         "success": {"kind": "leaf", "consequence": "C1"},
                                         "failure": {"kind": "leaf", "consequence": "C2"}}},
                      "fts": {"model_data": {"parameters": []}, "pfds": {}, "fault_trees": []},
                      "pfds": {}}],
            "activeKey": "t", "checkedKeys": {"t": True}}


def _single_fields():
    """checked_set 请求仍带单树必填字段(契约未放松;聚合路径不消费它们)。"""
    return {
        "init_event": "IE", "init_frequency": 1e-3,
        "functional_events": [{"id": "FE1", "pfd": 0.1}],
        "fault_trees": {}, "parameters": {},
        "sequences": [{"path": {"FE1": "success"}, "end_state": "L0"},
                      {"path": {"FE1": "failure"}, "end_state": "L1"}],
        "consequence_bins": {"L0": "C1", "L1": "C2"},
    }


def _tree(key, name, freq, pfd, note=None):
    """锚 1 形状的单屏障树载荷(TreeSpec):C1 = f·(1−pfd),C2 = f·pfd。"""
    t = {"key": key, "name": name,
         "init_event": f"IE_{key}", "init_frequency": freq,
         "functional_events": [{"id": "FE1", "pfd": pfd}],
         "fault_trees": {}, "parameters": {},
         "sequences": [{"path": {"FE1": "success"}, "end_state": "L0"},
                       {"path": {"FE1": "failure"}, "end_state": "L1"}],
         "consequence_bins": {"L0": "C1", "L1": "C2"},
         "labels": {"FE1": "屏障一"}}
    if note:
        t["init_note"] = note
    return t


TREES = [_tree("t1", "电芯内短路", 1e-3, 0.1, note="舱级 canonical(/舱·yr),见稿 B"),
         _tree("t2", "BMS 过充", 2e-3, 0.2)]


def test_uncertainty_checked_set_mean_anchor_pin_shape(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    r = client.post("/api/event-tree/uncertainty", json={
        **_single_fields(), "scope": "checked_set", "trees": TREES,
        "samples": 60, "seed": 1,
        "project_uuid": PUUID, "project_payload": _payload(), "scenario_name": "勾选集聚合"})
    assert r.status_code == 200
    res = r.json()
    # 锚 1 均值(逐级求和,精确):C1 = 9e-4+1.6e-3,C2 = 1e-4+4e-4;守恒 Σ=Σf
    assert res["point"]["C1"] == pytest.approx(2.5e-3)
    assert res["point"]["C2"] == pytest.approx(5e-4)
    assert res["scope"] == "checked_set"
    assert [t["key"] for t in res["per_tree"]] == ["t1", "t2"]
    assert res["per_tree"][0]["consequences"]["C1"] == pytest.approx(9e-4)
    # §2.3 钉扎形状:一次运行一个案例;settings.scope/scenarios;results.consequences+per_tree+bands
    import json as _json
    cases = client.get(f"/api/projects/{PUUID}/cases").json()
    assert len(cases) == 1 and cases[0]["kind"] == "uncertainty"
    settings = _json.loads(cases[0]["settings_json"])
    assert settings["scope"] == "checked_set"
    assert settings["scenarios"] == [{"key": "t1", "name": "电芯内短路"},
                                     {"key": "t2", "name": "BMS 过充"}]
    results = _json.loads(cases[0]["results_json"])
    assert results["consequences"]["C1"] == pytest.approx(2.5e-3)
    assert [t["name"] for t in results["per_tree"]] == ["电芯内短路", "BMS 过充"]
    assert set(results["bands"]["C2"]) == {"p05", "p50", "p95"}
    # 组合总览徽章字段(scope 标识全表面)
    row = next(x for x in client.get("/api/portfolio").json() if x["uuid"] == PUUID)
    assert row["latest_case"]["scope"] == "checked_set"
    assert row["latest_case"]["tree_count"] == 2


def test_uncertainty_checked_set_empty_trees_400():
    r = client.post("/api/event-tree/uncertainty",
                    json={**_single_fields(), "scope": "checked_set", "trees": [], "samples": 30})
    assert r.status_code == 400
    assert "trees" in r.json()["detail"]


def test_uncertainty_checked_set_rejects_per_tree_boundary_conditions():
    # 分析设置绝不静默忽略:逐树边界条件当前不入聚合语义 → 响亮 400。
    t = {**_tree("t1", "树一", 1e-3, 0.1), "house_states": {"H1": True}}
    r = client.post("/api/event-tree/uncertainty",
                    json={**_single_fields(), "scope": "checked_set", "trees": [t], "samples": 30})
    assert r.status_code == 400
    assert "边界条件" in r.json()["detail"]


def test_uncertainty_single_scope_response_unchanged():
    # 默认 scope=single 零扰动:响应不长出 scope/per_tree 键(旧客户端字节兼容)。
    r = client.post("/api/event-tree/uncertainty", json={**_single_fields(), "samples": 30, "seed": 1})
    assert r.status_code == 200
    res = r.json()
    assert set(res) == {"point", "bands"}


def test_report_checked_set_csv_metadata_breakdown_disclosures(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    r = client.post("/api/report?format=csv", json={
        **_single_fields(), "scope": "checked_set", "trees": TREES,
        "samples": 40, "seed": 1, "scenario_name": "勾选集聚合",
        "project_uuid": PUUID, "project_payload": _payload()})
    assert r.status_code == 200
    body = r.content.decode("utf-8-sig")
    assert "# 口径,勾选集聚合,2 树,电芯内短路、BMS 过充" in body   # §2.4 CSV 元数据行
    assert "逐树分解" in body and "电芯内短路" in body and "BMS 过充" in body
    assert "分位数不可加" in body                                    # §2.2 披露句
    assert "IE)频率按定值处理" in body
    assert "MECE" in body                                            # §2.1 前提披露
    # spec B 注记透传(注记含逗号 → csv 引号包裹,断言拆成字段级)
    assert "※ 电芯内短路 初因口径" in body and "舱级 canonical(/舱·yr)" in body
    # 钉扎:kind=report,scope 入 settings
    import json as _json
    cases = client.get(f"/api/projects/{PUUID}/cases").json()
    assert [c["kind"] for c in cases] == ["report"]
    assert _json.loads(cases[0]["settings_json"])["scope"] == "checked_set"


def test_report_checked_set_docx_title_marks_scope(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "_DIR", str(tmp_path / "saved"))
    r = client.post("/api/report?format=docx", json={
        **_single_fields(), "scope": "checked_set", "trees": TREES,
        "samples": 40, "seed": 1, "scenario_name": "勾选集聚合"})
    assert r.status_code == 200
    xml = zipfile.ZipFile(io.BytesIO(r.content)).read("word/document.xml").decode("utf-8")
    assert "勾选集聚合(2 树)" in xml       # 标题/表标题 scope 标识(不能只靠页脚)
    assert "逐树分解" in xml and "分位数不可加" in xml
    assert "舱级 canonical" in xml          # 逐树基准注记入页脚分解块
    assert "屏障重要度" not in xml          # 聚合报告无跨树重要度语义 → 整节不出


def test_report_checked_set_empty_trees_400():
    r = client.post("/api/report?format=csv",
                    json={**_single_fields(), "scope": "checked_set", "trees": []})
    assert r.status_code == 400
