"""EB-05 / 修复包 O1:静默语义回退全清 —— 引擎装载/量化边界的响亮拒绝。

裁定见 docs/reviews/2026-07-16-3rd-party-review-adjudication.md §1 EB-05 / §3 O1。
本文件锁引擎层(method 枚举、branch 装载枚举、init_frequency 与不确定性入口数值域);
后端 4xx/charset 映射见 tests/backend/test_input_validation_api.py。
"""
from __future__ import annotations

import pytest

from psaengine import Analysis, Model
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.eta.sequence import quantify_event_tree
from psaengine.eta.uncertainty import (aggregate_event_tree_uncertainty,
                                       event_tree_uncertainty)
from psaengine.model.json_io import load_model_from_dict


def _fta_model() -> Model:
    return Model.from_json("examples/tiny_and.json")


def _eta_model(init_frequency: float = 1.0) -> Model:
    """最小两态事件树:单屏障 FE1(pfd=0.1),success/failure 两序列。
    结构与 backend/et_builder.py 的 pfd-only 通道同形(null 门顶 + 基本事件)。"""
    return load_model_from_dict({
        "model_data": {"parameters": [{"id": "FE1", "kind": "probability", "value": 0.1}]},
        "fault_trees": [{"name": "FE1", "top": "FE1", "nodes": [
            {"id": "FE1_E", "basic": True, "param_ref": "FE1"},
            {"id": "FE1", "op": "null", "args": ["FE1_E"]}]}],
        "event_trees": [{
            "name": "TR", "init_event": "IE", "init_frequency": init_frequency,
            "functional_events": [{"id": "FE1", "link_ft": "FE1"}],
            "sequences": [
                {"path": {"FE1": "success"}, "end_state": "S"},
                {"path": {"FE1": "failure"}, "end_state": "F"}],
            "consequence_bins": {"S": "C1", "F": "C2"}}],
    })


# ── 1. method 严格枚举(引擎层;不再静默落 REA) ────────────────────────────────
def test_analysis_probability_rejects_unknown_method():
    an = Analysis(_fta_model(), fault_tree="TOP")
    with pytest.raises(ValueError, match="method"):
        an.probability(method="excat")


def test_analysis_probability_known_methods_unchanged():
    an = Analysis(_fta_model(), fault_tree="TOP")
    assert an.probability(method="exact") == pytest.approx(0.1 * 0.2)
    # mcub/rea 合法且不被误拒(数值宽松)
    assert an.probability(method="mcub") > 0
    assert an.probability(method="rea") > 0


# ── 2. branch 在 load 边界严格枚举 success|failure(含大小写/空白变体点名拒绝) ──
@pytest.mark.parametrize("bad", ["FAILURE", "Fail", "ok", "success ", "SUCCESS", "true", ""])
def test_event_tree_rejects_non_canonical_branch(bad):
    with pytest.raises(ValueError, match="branch|success|FE1"):
        EventTree("IE", 1.0, [FunctionalEvent("FE1")],
                  [{"path": {"FE1": bad}, "end_state": "X"}], {"X": "C1"})


def test_event_tree_accepts_canonical_branches_bit_exact():
    # 合法 success/failure 不受扰动:逐位复核后果频率(前后一致的绿例锚)
    res = quantify_event_tree(_eta_model(init_frequency=1.0), "TR")
    assert res["consequences"]["C1"] == pytest.approx(0.9)   # success 分支
    assert res["consequences"]["C2"] == pytest.approx(0.1)   # failure 分支


# ── 3. init_frequency 数值域:finite 且 ≥ 0 ─────────────────────────────────
def test_event_tree_rejects_negative_init_frequency():
    with pytest.raises(ValueError, match="init_frequency"):
        EventTree("IE", -1.0, [FunctionalEvent("FE1")],
                  [{"path": {"FE1": "failure"}, "end_state": "X"}], {"X": "C1"})


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_event_tree_rejects_nonfinite_init_frequency(bad):
    with pytest.raises(ValueError, match="init_frequency"):
        EventTree("IE", bad, [FunctionalEvent("FE1")],
                  [{"path": {"FE1": "failure"}, "end_state": "X"}], {"X": "C1"})


def test_event_tree_accepts_zero_init_frequency():
    # 0 是合法边界(≥ 0),不得误拒
    et = EventTree("IE", 0.0, [FunctionalEvent("FE1")],
                   [{"path": {"FE1": "failure"}, "end_state": "X"}], {"X": "C1"})
    assert et.init_frequency == 0.0


# ── 4. 不确定性入口数值域:samples ≥ 1、error_factor ≥ 1(finite) ──────────────
def test_uncertainty_rejects_samples_below_one():
    with pytest.raises(ValueError, match="samples"):
        event_tree_uncertainty(_eta_model(), "TR", samples=0)


def test_uncertainty_rejects_error_factor_below_one():
    with pytest.raises(ValueError, match="error_factor"):
        event_tree_uncertainty(_eta_model(), "TR", error_factor=0.5)


@pytest.mark.parametrize("bad", [float("nan"), float("inf")])
def test_uncertainty_rejects_nonfinite_error_factor(bad):
    with pytest.raises(ValueError, match="error_factor"):
        event_tree_uncertainty(_eta_model(), "TR", error_factor=bad)


def test_uncertainty_accepts_boundary_samples_one_ef_one():
    # samples=1、EF=1 合法(EF=1 ⇒ 显式的"无认知不确定"确定性带,而非静默退化)
    r = event_tree_uncertainty(_eta_model(), "TR", samples=1, error_factor=1.0)
    assert r["point"]["C2"] == pytest.approx(0.1)


def test_aggregate_uncertainty_validates_samples_and_ef():
    specs = [(_eta_model(), "TR")]
    with pytest.raises(ValueError, match="samples"):
        aggregate_event_tree_uncertainty(specs, samples=0)
    with pytest.raises(ValueError, match="error_factor"):
        aggregate_event_tree_uncertainty(specs, error_factor=0.5)
    # 合法边界放行
    ok = aggregate_event_tree_uncertainty(specs, samples=1, error_factor=1.0)
    assert ok["point"]["C2"] == pytest.approx(0.1)
