"""EB-10 / 修复包 O4:非相干模型(PDAG 含 NOT/XOR)的 MCS/REA/MCUB 点名拒绝。

裁定见 docs/reviews/2026-07-16-3rd-party-review-adjudication.md §3 O4。

cutsets 只枚举正文字路径(_paths_to_one 按设计丢弃负文字)——非相干模型下返回的
"最小割集"与精确概率矛盾(评审算例 A∧¬B,qA=.2/qB=.5:精确 .1,但割集 [A]/REA .2)。
口径:非相干 → cutsets/REA/MCUB 点名拒绝并提示 prime_implicants 通道;exact 概率不受影响。
"""
import pytest

from fastapi.testclient import TestClient

from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.fault_tree import FaultTree
from psaengine.model.model import Model
from psaengine.analysis import Analysis
from backend.app import app

client = TestClient(app)


def _model(build_top) -> Model:
    lib = ParameterLibrary()
    lib.add(Parameter("A", "probability", 0.2))
    lib.add(Parameter("B", "probability", 0.5))
    g = PDAG()
    g.basic("A"); g.basic("B")
    build_top(g)
    return Model(parameters=lib, fault_trees={"TOP": FaultTree("TOP", g)})


def _and_not_b(g):
    g.gate("nB", Op.NOT, ["B"]); g.gate("TOP", Op.AND, ["A", "nB"]); g.top = "TOP"


def _a_and_b(g):
    g.gate("TOP", Op.AND, ["A", "B"]); g.top = "TOP"


def _a_xor_b(g):
    g.gate("TOP", Op.XOR, ["A", "B"]); g.top = "TOP"


# ── 引擎锚:A∧¬B —— cutsets 拒绝、exact 仍精确 .1、prime_implicants 一致 ─────────
def test_and_not_b_cutsets_rejected():
    an = Analysis(_model(_and_not_b), fault_tree="TOP")
    with pytest.raises(ValueError, match="prime_implicants"):
        an.cutsets()


def test_and_not_b_exact_probability_unaffected():
    an = Analysis(_model(_and_not_b), fault_tree="TOP")
    assert an.probability(method="exact") == pytest.approx(0.1)   # .2·(1−.5)


def test_and_not_b_rea_mcub_rejected():
    an = Analysis(_model(_and_not_b), fault_tree="TOP")
    with pytest.raises(ValueError, match="prime_implicants"):
        an.probability(method="rea")
    an2 = Analysis(_model(_and_not_b), fault_tree="TOP")
    with pytest.raises(ValueError, match="prime_implicants"):
        an2.probability(method="mcub")


def test_and_not_b_prime_implicants_channel_works():
    an = Analysis(_model(_and_not_b), fault_tree="TOP")
    assert an.prime_implicants() == [{"A": True, "B": False}]


# ── XOR 也非相干 → cutsets 拒绝 ───────────────────────────────────────────────
def test_xor_cutsets_rejected():
    an = Analysis(_model(_a_xor_b), fault_tree="TOP")
    with pytest.raises(ValueError, match="prime_implicants"):
        an.cutsets()


# ── 相干模型不受影响(既有割集语义保留) ─────────────────────────────────────
def test_coherent_and_cutsets_unaffected():
    an = Analysis(_model(_a_and_b), fault_tree="TOP")
    cs = an.cutsets()
    assert [c.events for c in cs] == [["A", "B"]]
    assert an.probability(method="exact") == pytest.approx(0.1)   # .2·.5
    assert an.probability(method="rea") == pytest.approx(0.1)


# ── 后端 /api/quantify:非相干 → 400(提示 prime_implicants);相干 → 200 ────────
_NONCOHERENT_REQ = {
    "model": {
        "model_data": {"parameters": [
            {"id": "A", "kind": "probability", "value": 0.2},
            {"id": "B", "kind": "probability", "value": 0.5}]},
        "fault_trees": [{"name": "T", "top": "TOP", "nodes": [
            {"id": "A", "basic": True, "param_ref": "A"},
            {"id": "B", "basic": True, "param_ref": "B"},
            {"id": "nB", "op": "not", "args": ["B"]},
            {"id": "TOP", "op": "and", "args": ["A", "nB"]}]}],
        "event_trees": [],
    },
    "fault_tree": "T", "method": "exact",
}


def test_api_quantify_noncoherent_rejected_400():
    r = client.post("/api/quantify", json=_NONCOHERENT_REQ)
    assert r.status_code == 400
    assert "prime_implicants" in r.json()["detail"]


def test_api_quantify_coherent_still_ok():
    req = {**_NONCOHERENT_REQ}
    req["model"] = {**_NONCOHERENT_REQ["model"],
                    "fault_trees": [{"name": "T", "top": "TOP", "nodes": [
                        {"id": "A", "basic": True, "param_ref": "A"},
                        {"id": "B", "basic": True, "param_ref": "B"},
                        {"id": "TOP", "op": "and", "args": ["A", "B"]}]}]}
    r = client.post("/api/quantify", json=req)
    assert r.status_code == 200
    assert r.json()["probability"] == pytest.approx(0.1)
