"""EB-05 / 修复包 O1:API 侧响亮拒绝 + 统一 4xx/charset 映射。

裁定见 docs/reviews/2026-07-16-3rd-party-review-adjudication.md §3 O1。
引擎层锁在 tests/unit/test_input_validation.py;本文件锁:
  - method schema 层 422(与引擎 ValueError 双锁);
  - branch 装载层 ValueError → API 4xx;
  - samples=0 / error_factor<1 → 4xx 带参数名(修前 samples=0 是 500);
  - validation(422)与 domain(400)响应头均声明 application/json; charset=utf-8。
"""
from fastapi.testclient import TestClient

from backend.app import app

client = TestClient(app)

# 最小合法 FTA(供 /api/quantify:仅 method 变量,隔离 schema 校验)
_FTA = {
    "model_data": {"parameters": [{"id": "A", "kind": "probability", "value": 0.1}]},
    "fault_trees": [{"name": "T", "top": "T", "nodes": [
        {"id": "A", "basic": True, "param_ref": "A"},
        {"id": "T", "op": "null", "args": ["A"]}]}],
    "event_trees": [],
}


def _et_request():
    return {
        "init_event": "IE", "init_frequency": 1.0,
        "functional_events": [{"id": "FE1", "pfd": 0.1}, {"id": "FE2", "pfd": 0.2}],
        "fault_trees": {}, "parameters": {},
        "sequences": [
            {"path": {"FE1": "success"}, "end_state": "L0"},
            {"path": {"FE1": "failure", "FE2": "success"}, "end_state": "L1"},
            {"path": {"FE1": "failure", "FE2": "failure"}, "end_state": "L2"}],
        "consequence_bins": {"L0": "C1", "L1": "C2", "L2": "C3"},
    }


# ── method:schema 层 422(pydantic Literal) ──────────────────────────────────
def test_quantify_rejects_unknown_method_422():
    r = client.post("/api/quantify", json={"model": {}, "method": "excat"})
    assert r.status_code == 422


def test_quantify_accepts_known_methods():
    for meth in ("exact", "mcub", "rea"):
        r = client.post("/api/quantify",
                        json={"model": _FTA, "fault_tree": "T", "method": meth})
        assert r.status_code == 200, (meth, r.text)


# ── branch:装载层点名 → API 4xx;合法分支不扰动 ─────────────────────────────
def test_event_tree_quantify_rejects_uppercase_branch():
    req = _et_request()
    req["sequences"][0]["path"]["FE1"] = "FAILURE"
    r = client.post("/api/event-tree/quantify", json=req)
    assert r.status_code in (400, 422)


def test_event_tree_quantify_legal_branches_ok():
    r = client.post("/api/event-tree/quantify", json=_et_request())
    assert r.status_code == 200


# ── samples/EF:4xx 带参数名(修前 samples=0 是 500) ──────────────────────────
def test_uncertainty_rejects_samples_zero_4xx():
    r = client.post("/api/event-tree/uncertainty", json={**_et_request(), "samples": 0})
    assert r.status_code in (400, 422)
    assert "samples" in r.text


def test_uncertainty_rejects_error_factor_below_one_4xx():
    r = client.post("/api/event-tree/uncertainty", json={**_et_request(), "error_factor": 0.5})
    assert r.status_code in (400, 422)
    assert "error_factor" in r.text


def test_uncertainty_boundary_samples_one_ef_one_ok():
    r = client.post("/api/event-tree/uncertainty",
                    json={**_et_request(), "samples": 1, "error_factor": 1.0})
    assert r.status_code == 200


# ── charset:validation(422)与 domain(4xx)响应头均 utf-8 ───────────────────
def test_validation_error_declares_utf8_charset():
    r = client.post("/api/quantify", json={"model": {}, "method": "excat"})
    assert r.status_code == 422
    assert "charset=utf-8" in r.headers["content-type"].lower()


def test_domain_value_error_declares_utf8_charset():
    r = client.post("/api/event-tree/uncertainty", json={**_et_request(), "samples": 0})
    assert r.status_code in (400, 422)
    assert "charset=utf-8" in r.headers["content-type"].lower()
