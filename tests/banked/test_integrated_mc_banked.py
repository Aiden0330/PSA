"""BANKED 锚点:集成 LFT 模式 MC 不确定性 + 屏障重要度。

规格:docs/superpowers/specs/2026-07-16-integrated-mc-uncertainty-importance-banked.md
探针:psaengine.eta.uncertainty 同时存在两集成函数 ⇒ 激活(属性存在性,零构造零计算)。
A7 特征化锁**不门控恒跑**:实现新通道不得扰动普通通道(逐位)。

区间依据(规格 §3 闭式):lognormal p95 = median·EF;同抽 q² p95=(median·EF)²;
独立积 p95 = median²·EF^√2 ≈ 0.047(铸造日实测现单树行为 0.0469——规格 §6 已知差异)。
"""
import pytest

from backend.et_builder import build_model_from_request

PROBE_REASON = ("集成 MC/重要度未实现——规格 docs/superpowers/specs/"
                "2026-07-16-integrated-mc-uncertainty-importance-banked.md")


def _implemented() -> bool:
    import psaengine.eta.uncertainty as U
    return (hasattr(U, "event_tree_uncertainty_integrated")
            and hasattr(U, "barrier_importance_exact_integrated"))


gated = pytest.mark.skipif(not _implemented(), reason=PROBE_REASON)


# ── 集成模型工厂(anchor-C 族:IE=AND(I,S) λ=1e-3,屏障可变)────────────────────

def _integrated_model(barrier_nodes, parameters, ie_nodes=None):
    ie_nodes = ie_nodes or [
        {"id": "I", "basic": True, "param_ref": "I"},
        {"id": "S", "basic": True, "param_ref": "S"},
        {"id": "IE_TOP", "op": "and", "args": ["I", "S"]}]
    req = {"init_event": "IE", "init_frequency": 0.0,
           "functional_events": [{"id": "FE_B", "link_ft": "FE_B"}],
           "fault_trees": {"FE_B": {"name": "B", "top": barrier_nodes[-1]["id"],
                                    "nodes": barrier_nodes}},
           "parameters": parameters,
           "sequences": [{"path": {"FE_B": "success"}, "end_state": "L0"},
                         {"path": {"FE_B": "failure"}, "end_state": "L1"}],
           "consequence_bins": {"L0": "C1", "L1": "C3"},
           "ie_fault_tree": {"name": "__init__", "top": "IE_TOP", "nodes": ie_nodes,
                             "parameters": [{"id": "I", "kind": "frequency", "value": 1e-3}]}}
    return build_model_from_request(req)


def _anchor_c():
    # 屏障 OR(S,X) 共享 S:集成点 C3 = λ·P(S∧(S∨X)) = λ·P(S) = 2e-4,C1 = 0(S∧¬S)
    return _integrated_model(
        [{"id": "S", "basic": True, "param_ref": "S"},
         {"id": "X", "basic": True, "param_ref": "X"},
         {"id": "B_TOP", "op": "or", "args": ["S", "X"]}],
        {"S": {"value": 0.2}, "X": {"value": 0.1}})


# ── A1:EF=1 退化 → 带 ≡ 集成点通道逐位 ─────────────────────────────────────────

@gated
def test_A1_ef1_bands_degenerate_to_integrated_point():
    from psaengine.eta.sequence import event_tree_sequences_integrated
    from psaengine.eta.uncertainty import event_tree_uncertainty_integrated
    m = _anchor_c()
    u = event_tree_uncertainty_integrated(m, "TR", "__init__",
                                          samples=50, seed=1, error_factor=1.0)
    point = {}
    for row in event_tree_sequences_integrated(m, "TR", "__init__"):
        point[row["consequence"]] = point.get(row["consequence"], 0.0) + row["frequency"]
    assert point["C3"] == pytest.approx(2e-4, rel=1e-12)
    for c in ("C1", "C3"):
        b = u["bands"][c]
        assert b["p05"] == b["p50"] == b["p95"] == point.get(c, 0.0), (
            f"EF=1 必须逐位退化为集成点:{c} bands={b} point={point.get(c, 0.0)}")


# ── A2:IE↔屏障共享事件在 MC 通道合并(同节点 id 一变量一抽样)──────────────────

@gated
def test_A2_shared_event_merged_in_mc_channel():
    from psaengine.eta.uncertainty import event_tree_uncertainty_integrated
    m = _anchor_c()
    u = event_tree_uncertainty_integrated(m, "TR", "__init__",
                                          samples=4000, seed=11, error_factor=3.0)
    p50 = u["bands"]["C3"]["p50"]
    # 合并:rate = λ·q_S(中位积 2e-4);断裂(S 两变量/两抽样):λ·q_S² 中位 ≈ 4e-5
    assert 2e-4 * 0.7 <= p50 <= 2e-4 * 1.45, f"p50={p50:.3e} 偏离 λ·q_S——共享 S 未合并?"


# ── A3:量纲分流——频率不封顶,概率封 [0,1] ─────────────────────────────────────

@gated
def test_A3_frequency_kind_unclipped_probability_clipped():
    from psaengine.eta.uncertainty import event_tree_uncertainty_integrated
    # 恒失败屏障(house True)→ rate = λ 本身的带;λ 中位 0.8/yr,EF3 → p95 = 0.8·3 = 2.4
    m = _integrated_model(
        [{"id": "H_ALW", "house": True, "state": True},
         {"id": "B_TOP", "op": "null", "args": ["H_ALW"]}],
        {},
        ie_nodes=[{"id": "I", "basic": True, "param_ref": "I"},
                  {"id": "IE_TOP", "op": "null", "args": ["I"]}])
    # 换 λ=0.8:直接改参数库(工厂里 λ 固定 1e-3,这里重建)
    req_lam = {"init_event": "IE", "init_frequency": 0.0,
               "functional_events": [{"id": "FE_B", "link_ft": "FE_B"}],
               "fault_trees": {"FE_B": {"name": "B", "top": "B_TOP", "nodes": [
                   {"id": "H_ALW", "house": True, "state": True},
                   {"id": "B_TOP", "op": "null", "args": ["H_ALW"]}]}},
               "parameters": {},
               "sequences": [{"path": {"FE_B": "success"}, "end_state": "L0"},
                             {"path": {"FE_B": "failure"}, "end_state": "L1"}],
               "consequence_bins": {"L0": "C1", "L1": "C3"},
               "ie_fault_tree": {"name": "__init__", "top": "IE_TOP",
                                 "nodes": [{"id": "I", "basic": True, "param_ref": "I"},
                                           {"id": "IE_TOP", "op": "null", "args": ["I"]}],
                                 "parameters": [{"id": "I", "kind": "frequency", "value": 0.8}]}}
    from backend.et_builder import build_model_from_request as _b
    from psaengine.eta.uncertainty import event_tree_uncertainty_integrated as unc
    u = unc(_b(req_lam), "TR", "__init__", samples=4000, seed=13, error_factor=3.0)
    p95 = u["bands"]["C3"]["p95"]
    assert 2.0 <= p95 <= 2.9, (
        f"λ p95={p95:.3f}/yr 应 ≈2.4(中位 0.8×EF3)——若 ≤1.0 即频率被当概率封顶(量纲罪)")
    # 对照:概率参数封 [0,1]——屏障单基事件中位 0.8 EF3,λ=1e-3 恒使能
    req_q = {**req_lam,
             "fault_trees": {"FE_B": {"name": "B", "top": "B_TOP", "nodes": [
                 {"id": "Q", "basic": True, "param_ref": "Q"},
                 {"id": "B_TOP", "op": "null", "args": ["Q"]}]}},
             "parameters": {"Q": {"value": 0.8}},
             "ie_fault_tree": {**req_lam["ie_fault_tree"],
                               "parameters": [{"id": "I", "kind": "frequency", "value": 1e-3}]}}
    u2 = unc(_b(req_q), "TR", "__init__", samples=2000, seed=17, error_factor=3.0)
    # P(path)≤1 → C3 样本 ≤ λ 样本;q 封顶后 p95(C3) ≤ p95(λ)·1.0 = 1e-3·3(闭式)
    assert u2["bands"]["C3"]["p95"] <= 1e-3 * 3.0 * 1.001, "概率参数未封 [0,1]?"


# ── A5:house 透传 ────────────────────────────────────────────────────────────────

@gated
def test_A5_house_states_threaded():
    from psaengine.eta.sequence import event_tree_sequences_integrated
    from psaengine.eta.uncertainty import event_tree_uncertainty_integrated
    m = _integrated_model(
        [{"id": "X", "basic": True, "param_ref": "X"},
         {"id": "H_M", "house": True, "state": False},
         {"id": "B_TOP", "op": "or", "args": ["X", "H_M"]}],
        {"S": {"value": 0.2}, "X": {"value": 0.1}})
    def point(house):
        acc = {}
        for row in event_tree_sequences_integrated(m, "TR", "__init__", house_states=house):
            acc[row["consequence"]] = acc.get(row["consequence"], 0.0) + row["frequency"]
        return acc
    on, off = point({"H_M": True}), point(None)
    assert on["C3"] > off["C3"]
    u = event_tree_uncertainty_integrated(m, "TR", "__init__", samples=50, seed=1,
                                          error_factor=1.0, house_states={"H_M": True})
    assert u["bands"]["C3"]["p50"] == on["C3"], "house 覆盖未进集成 MC 构建"


# ── A6:重要度手算(扰动语义 + 共享事件)──────────────────────────────────────────

@gated
def test_A6_importance_hand_values_unshared():
    from psaengine.eta.uncertainty import barrier_importance_exact_integrated
    # 屏障 OR(X) 不共享:base C3 = λ·P(S∧X) = 1e-3·0.2·0.1 = 2e-5;work→0 FV=1;fail→λ·P(S)=2e-4 RAW=10
    m = _integrated_model(
        [{"id": "X", "basic": True, "param_ref": "X"},
         {"id": "B_TOP", "op": "null", "args": ["X"]}],
        {"S": {"value": 0.2}, "X": {"value": 0.1}})
    rows = barrier_importance_exact_integrated(m, "TR", "__init__")["C3"]
    r = next(x for x in rows if x["barrier"] == "FE_B")
    assert r["fv"] == pytest.approx(1.0, abs=1e-12)
    assert r["raw"] == pytest.approx(10.0, rel=1e-9)


@gated
def test_A6_importance_shared_event_raw_unity():
    from psaengine.eta.uncertainty import barrier_importance_exact_integrated
    # 屏障 OR(S,X) 共享 S:base = λ·P(S) = 2e-4;强制失效 → λ·P(S) 不变 → RAW = 1.0
    m = _anchor_c()
    r = next(x for x in barrier_importance_exact_integrated(m, "TR", "__init__")["C3"]
             if x["barrier"] == "FE_B")
    assert r["raw"] == pytest.approx(1.0, rel=1e-9), (
        "共享 S 已蕴含屏障失效——RAW 必须 =1(扰动在合并 BDD 上做,非独立近似)")
    assert r["fv"] == pytest.approx(1.0, abs=1e-12)      # 必有效 → C3=0


# ── A10:SOKC——同 ref 多节点共享抽样 ────────────────────────────────────────────

@gated
def test_A10_same_ref_nodes_share_draw():
    from psaengine.eta.uncertainty import event_tree_uncertainty_integrated
    m = _integrated_model(
        [{"id": "A1", "basic": True, "param_ref": "qA"},
         {"id": "A2", "basic": True, "param_ref": "qA"},
         {"id": "B_TOP", "op": "and", "args": ["A1", "A2"]}],
        {"qA": {"value": 0.1}},
        ie_nodes=[{"id": "I", "basic": True, "param_ref": "I"},
                  {"id": "IE_TOP", "op": "null", "args": ["I"]}])
    u = event_tree_uncertainty_integrated(m, "TR", "__init__",
                                          samples=4000, seed=7, error_factor=3.0)
    # 需归一 λ=1e-3:C3 = λ·q²;同抽 p95 = 1e-3·(0.1·3)² = 9e-5;独立抽 ≈ 4.7e-5(铸造日实测口径)
    p95 = u["bands"]["C3"]["p95"] / 1e-3
    assert 0.07 <= p95 <= 0.12, (
        f"p95/λ={p95:.4f} 应 ≈0.09(同 ref 同抽,SOKC)——≈0.047 即独立抽(规格 §6 单树旧病)")


# ── A8:端点解冻(替换 G3 的 422 锁)──────────────────────────────────────────────

@gated
def test_A8_endpoints_unfrozen():
    from fastapi.testclient import TestClient
    from backend.app import app
    client = TestClient(app)
    req = {"init_event": "IE", "init_frequency": 0.0,
           "functional_events": [{"id": "FE_B", "link_ft": "FE_B"}],
           "fault_trees": {"FE_B": {"name": "B", "top": "B_TOP", "nodes": [
               {"id": "S", "basic": True, "param_ref": "S"},
               {"id": "X", "basic": True, "param_ref": "X"},
               {"id": "B_TOP", "op": "or", "args": ["S", "X"]}]}},
           "parameters": {"S": {"value": 0.2}, "X": {"value": 0.1}},
           "sequences": [{"path": {"FE_B": "failure"}, "end_state": "S_FAIL"},
                         {"path": {"FE_B": "success"}, "end_state": "S_OK"}],
           "consequence_bins": {"S_FAIL": "C3", "S_OK": "C1"},
           "ie_fault_tree": {"name": "__init__", "top": "IE_TOP",
                             "nodes": [{"id": "I", "basic": True, "param_ref": "I"},
                                       {"id": "S", "basic": True, "param_ref": "S"},
                                       {"id": "IE_TOP", "op": "and", "args": ["I", "S"]}],
                             "parameters": [{"id": "I", "kind": "frequency", "value": 1e-3}]},
           "samples": 100, "seed": 1}
    r = client.post("/api/event-tree/uncertainty", json=req)
    assert r.status_code == 200, f"集成 uncertainty 应解冻为 200,得 {r.status_code}: {r.text[:200]}"
    assert r.json()["bands"]["C3"]["p50"] > 0
    r2 = client.post("/api/event-tree/importance", json=req)
    assert r2.status_code == 200, f"集成 importance 应解冻为 200,得 {r2.status_code}"
    assert r2.json()["importance"]["C3"]


# ── A9:集成报告接真带 ────────────────────────────────────────────────────────────

@gated
def test_A9_integrated_report_real_bands():
    import csv as _csv
    import io
    from fastapi.testclient import TestClient
    from backend.app import app
    client = TestClient(app)
    req = {"init_event": "IE", "init_frequency": 0.0,
           "functional_events": [{"id": "FE_B", "link_ft": "FE_B"}],
           "fault_trees": {"FE_B": {"name": "B", "top": "B_TOP", "nodes": [
               {"id": "S", "basic": True, "param_ref": "S"},
               {"id": "X", "basic": True, "param_ref": "X"},
               {"id": "B_TOP", "op": "or", "args": ["S", "X"]}]}},
           "parameters": {"S": {"value": 0.2}, "X": {"value": 0.1}},
           "sequences": [{"path": {"FE_B": "failure"}, "end_state": "S_FAIL"},
                         {"path": {"FE_B": "success"}, "end_state": "S_OK"}],
           "consequence_bins": {"S_FAIL": "C3", "S_OK": "C1"},
           "ie_fault_tree": {"name": "__init__", "top": "IE_TOP",
                             "nodes": [{"id": "I", "basic": True, "param_ref": "I"},
                                       {"id": "S", "basic": True, "param_ref": "S"},
                                       {"id": "IE_TOP", "op": "and", "args": ["I", "S"]}],
                             "parameters": [{"id": "I", "kind": "frequency", "value": 1e-3}]},
           "scenario_name": "banked", "samples": 400, "seed": 3}
    r = client.post("/api/report?format=csv", json=req)
    assert r.status_code == 200, r.text[:200]
    for row in _csv.reader(io.StringIO(r.text)):
        if row and row[0].strip() == "C3":
            assert float(row[2]) == pytest.approx(2e-4, rel=1e-9)      # 点估计仍精确
            assert float(row[3]) < float(row[5]), "分位列应为真实 MC 带(p05<p95),非退化点值"
            break
    else:
        pytest.fail("CSV 无 C3 行")


# ── A7:特征化锁(恒跑,不门控)——普通通道逐位不扰动 ───────────────────────────────

def _plain_model():
    return build_model_from_request(
        {"init_event": "IE", "init_frequency": 1e-3,
         "functional_events": [{"id": "FE1", "link_ft": "FE1"}],
         "fault_trees": {"FE1": {"name": "FT", "top": "TOP", "nodes": [
             {"id": "A", "basic": True, "param_ref": "A"},
             {"id": "B", "basic": True, "param_ref": "B"},
             {"id": "TOP", "op": "or", "args": ["A", "B"]}]}},
         "parameters": {"A": {"value": 0.2}, "B": {"value": 0.1}},
         "sequences": [{"path": {"FE1": "success"}, "end_state": "L0"},
                       {"path": {"FE1": "failure"}, "end_state": "L1"}],
         "consequence_bins": {"L0": "C1", "L1": "C2"}})


def test_A7_plain_uncertainty_characterization_lock():
    from psaengine.eta.uncertainty import event_tree_uncertainty
    u = event_tree_uncertainty(_plain_model(), "TR", samples=200, seed=42, error_factor=3.0)
    b = u["bands"]["C2"]
    assert b["p05"] == 1.37364901153765983e-04
    assert b["p50"] == 3.08110156636124267e-04
    assert b["p95"] == 6.47382403519241299e-04


def test_A7_plain_importance_characterization_lock():
    from psaengine.eta.uncertainty import barrier_importance_exact
    r = next(x for x in barrier_importance_exact(_plain_model(), "TR")["C2"]
             if x["barrier"] == "FE1")
    assert r["fv"] == 1.0
    assert r["raw"] == 3.57142857142857117e+00
