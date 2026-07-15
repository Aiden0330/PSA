"""POST /api/event-tree/quantify 的序列级 LFT 集成通道(规格 2026-07-15)。

ie_fault_tree 自包含块(树 + 类型化参数)→ integrated;未设置 → 单树响应逐位不变。
锚点 C 经 API 复现:共享使能击穿屏障,成功序列恒零、失败序列 λ·qS。
"""
from fastapi.testclient import TestClient

from backend.app import app

client = TestClient(app)


def _req_anchor_c(with_ie=True):
    req = {
        "init_event": "IE", "init_frequency": 0.0 if with_ie else 5.6e-5,
        "functional_events": [{"id": "FE_B", "link_ft": "B"}],
        "fault_trees": {"B": {"top": "B_TOP", "nodes": [
            {"id": "S", "basic": True, "param_ref": "S"},
            {"id": "X", "basic": True, "param_ref": "X"},
            {"id": "B_TOP", "op": "or", "args": ["S", "X"]}]}},
        "parameters": {"S": 0.2, "X": 0.1},
        "sequences": [{"path": {"FE_B": "failure"}, "end_state": "S_FAIL"},
                      {"path": {"FE_B": "success"}, "end_state": "S_OK"}],
        "consequence_bins": {"S_FAIL": "C3", "S_OK": "C1"},
    }
    if with_ie:
        req["ie_fault_tree"] = {
            "name": "__init__", "top": "IE_TOP",
            "nodes": [{"id": "I", "basic": True, "param_ref": "I"},
                      {"id": "S", "basic": True, "param_ref": "S"},
                      {"id": "IE_TOP", "op": "and", "args": ["I", "S"]}],
            "parameters": [{"id": "I", "kind": "frequency", "value": 1e-3}],
        }
    return req


def test_integrated_channel_anchor_c_via_api():
    r = client.post("/api/event-tree/quantify", json=_req_anchor_c())
    assert r.status_code == 200
    body = r.json()
    assert body["method"] == "integrated"
    assert abs(body["sequences"]["S_FAIL"] - 2e-4) < 1e-16   # λ·P(S∧(S∨X)) = λ·qS
    assert abs(body["sequences"]["S_OK"]) < 1e-18            # 物理不可能态恒零
    assert abs(body["ie_frequency"] - 2e-4) < 1e-16          # Σ 序列 = F_exact(守恒)
    assert abs(body["consequences"]["C3"] - 2e-4) < 1e-16


def test_single_mode_response_shape_unchanged():
    """未设 ie_fault_tree:响应不长出 method/ie_frequency 值(旧客户端零扰动)。"""
    r = client.post("/api/event-tree/quantify", json=_req_anchor_c(with_ie=False))
    assert r.status_code == 200
    body = r.json()
    assert body["method"] is None and body["ie_frequency"] is None
    # 两段式数值照旧(此处初频给的就是两段式的对照值,仅证通道未变)
    assert body["sequences"]["S_FAIL"] > 0


def test_integrated_rule_violation_is_400():
    req = _req_anchor_c()
    req["ie_fault_tree"]["parameters"] = []                  # 初因失去 frequency kind
    req["parameters"]["I"] = 0.5                             # 会被强转 probability → 纯概率割集
    r = client.post("/api/event-tree/quantify", json=req)
    assert r.status_code == 400                              # FrequencyRuleError → 响亮 400


def test_integrated_ccf_overlap_is_400():
    req = _req_anchor_c()
    req["ccf_groups"] = [{"id": "g", "members": ["S", "X"], "model": "beta",
                          "factors": {"beta": 0.1}}]
    r = client.post("/api/event-tree/quantify", json=req)
    assert r.status_code == 400
    assert "CCF" in r.json()["detail"]


def test_ie_block_param_duplicating_request_param_is_400():
    """review F3:IE 块参数与请求参数同 id(后写覆盖 9× 且 200)→ 响亮 400。"""
    req = _req_anchor_c()
    req["ie_fault_tree"]["parameters"].append({"id": "X", "kind": "probability", "value": 0.9})
    r = client.post("/api/event-tree/quantify", json=req)
    assert r.status_code == 400
    assert "duplicates" in r.json()["detail"]


def test_collision_guard_reaches_api_as_400():
    """review F1 端到端:门 id 碰撞经 API 必须 400(此前 200 + 88× 低估)。"""
    req = _req_anchor_c()
    # 屏障里造一个与 IE 顶同名的门
    req["fault_trees"]["B"]["nodes"].append({"id": "IE_TOP", "op": "or", "args": ["S"]})
    r = client.post("/api/event-tree/quantify", json=req)
    assert r.status_code == 400
    assert "IE_TOP" in r.json()["detail"]
