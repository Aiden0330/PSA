"""EB-09 / 修复包 O3:勾选集聚合的共享 ref 一致性(spec A,load 边界执行)。

裁定见 docs/reviews/2026-07-16-3rd-party-review-adjudication.md §3 O3。

spec A(2026-07-14)前提:同 ref 名 = 同认识论参数(项目全局命名空间)。
修前(review 复现):aggregate_event_tree_uncertainty 对同 ref 名跨树静默取首个中值——
canonical 允许同 ref 异值 → 点估计与分位带可能基于不同模型(评审算例:.1/.9 同 ref,
点 C2=.001 但 p05/p50/p95 均 .0002)。本文件把该矛盾在聚合 load 边界点名拒绝。

只加校验、不改抽样数学:同 ref 同值逐位不扰动(锚 test_eta_aggregate_uncertainty 全绿)。
"""
import pytest

from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.model import Model
from psaengine.eta.uncertainty import aggregate_event_tree_uncertainty


def _one_barrier_model(init_freq: float, param: Parameter, ref_name: str) -> Model:
    """单屏障事件树,屏障基本事件 "B" 引用参数 ref_name(param 为其定义)。
    基本事件 id 恒 "B"(各模型独立);跨树同一性由 ref_name 决定。"""
    lib = ParameterLibrary()
    lib.add(param)
    g = PDAG()
    g.basic("B", param_ref=ref_name)
    g.gate("BAR", Op.NULL, ["B"])
    g.top = "BAR"
    et = EventTree(
        init_event="IE", init_frequency=init_freq,
        functional_events=[FunctionalEvent("BAR", link_ft="BAR")],
        sequences=[{"path": {"BAR": "success"}, "end_state": "OK"},
                   {"path": {"BAR": "failure"}, "end_state": "F"}],
        consequence_bins={"OK": "C1", "F": "C2"})
    return Model(parameters=lib, fault_trees={"BAR": FaultTree("BAR", g)},
                 event_trees={"ET": et}, ccf_groups=[])


# ── 评审算例:同 ref 名 .1/.9 → 点名拒绝(不再静默取首值) ─────────────────────
def test_shared_ref_conflicting_value_rejected():
    t1 = _one_barrier_model(1e-3, Parameter("THETA", "probability", 0.1), "THETA")
    t2 = _one_barrier_model(1e-3, Parameter("THETA", "probability", 0.9), "THETA")
    with pytest.raises(ValueError, match="THETA"):
        aggregate_event_tree_uncertainty([(t1, "ET"), (t2, "ET")], samples=50, error_factor=1.0)


# ── 同 ref 名不同 kind → 点名拒绝(law 含 kind) ───────────────────────────────
def test_shared_ref_conflicting_kind_rejected():
    t1 = _one_barrier_model(1e-3, Parameter("R", "probability", 0.1), "R")
    t2 = _one_barrier_model(1e-3, Parameter("R", "rate", 0.1, mission_time=1.0), "R")
    with pytest.raises(ValueError, match="R"):
        aggregate_event_tree_uncertainty([(t1, "ET"), (t2, "ET")], samples=50)


# ── 同 ref 名不同分布(EF)→ 点名拒绝(law 含 distribution) ─────────────────────
def test_shared_ref_conflicting_distribution_rejected():
    from psaengine.model.parameters import Distribution
    p1 = Parameter("D", "probability", 0.1,
                   distribution=Distribution("lognormal", {"median": 0.1, "error_factor": 3.0}))
    p2 = Parameter("D", "probability", 0.1,
                   distribution=Distribution("lognormal", {"median": 0.1, "error_factor": 10.0}))
    t1 = _one_barrier_model(1e-3, p1, "D")
    t2 = _one_barrier_model(1e-3, p2, "D")
    with pytest.raises(ValueError, match="D"):
        aggregate_event_tree_uncertainty([(t1, "ET"), (t2, "ET")], samples=50)


# ── 同 ref 名同值 → 不扰动(既有联合抽样语义保留) ─────────────────────────────
def test_shared_ref_identical_value_not_perturbed():
    t1 = _one_barrier_model(1e-3, Parameter("THETA", "probability", 0.1), "THETA")
    t2 = _one_barrier_model(2e-3, Parameter("THETA", "probability", 0.1), "THETA")
    agg = aggregate_event_tree_uncertainty([(t1, "ET"), (t2, "ET")], samples=200, seed=7)
    # (1e-3+2e-3)·0.1 = 3e-4;点估计与分位带自洽(同一 THETA 抽样)
    assert agg["point"]["C2"] == pytest.approx(3e-4)


# ── 不同 ref 名(即使同值)→ 不触发一致性检查(独立参数,合法) ───────────────
def test_distinct_ref_names_allowed():
    t1 = _one_barrier_model(1e-3, Parameter("P1", "probability", 0.1), "P1")
    t2 = _one_barrier_model(2e-3, Parameter("P2", "probability", 0.9), "P2")
    agg = aggregate_event_tree_uncertainty([(t1, "ET"), (t2, "ET")], samples=100, seed=1)
    assert agg["point"]["C2"] == pytest.approx(1e-3 * 0.1 + 2e-3 * 0.9)
