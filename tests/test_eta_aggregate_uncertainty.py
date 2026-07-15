"""勾选集聚合不确定性(spec A,docs/superpowers/specs/2026-07-14-portfolio-aggregation-scope.md §3)。

裁决语义(不复议):
- 点估计 = 各树同级后果频率逐级求和(期望线性,精确;E[ΣN]=ΣE[N] 对任意相关结构恒成立)。
- 不确定性:跨树认知参数同一性 = **同 ref 名**(项目全局)。每次 MC 迭代抽一个联合参数向量
  (union of ref names),施加到全部树,逐树求值再逐级相加,得聚合分位带。
- 禁止的两种实现:①同 seed 逐树各跑再相加(字典序伪耦合);②各树独立抽样再相加
  (共享数据源被当独立 → 上分位静默压窄,非保守)。锚 3 即此判据。
"""
from math import log

import numpy as np
import pytest

from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.model import Model
from psaengine.eta.sequence import quantify_event_tree
from psaengine.eta.uncertainty import aggregate_event_tree_uncertainty


def _one_barrier_model(init_freq: float, ref_name: str, pfd: float,
                       *, c_ok: str = "C1", c_fail: str = "C2") -> Model:
    """单屏障事件树:初因 init_freq,屏障基本事件引用参数 ref_name(median=pfd,probability)。
    成功(屏障有效)→ c_ok,频率 init_freq·(1−pfd);失败 → c_fail,频率 init_freq·pfd。
    基本事件 id 恒为 "B"(各模型独立,不冲突);**跨树同一性由 ref_name 决定**。"""
    lib = ParameterLibrary()
    lib.add(Parameter(ref_name, "probability", pfd))
    g = PDAG()
    g.basic("B", param_ref=ref_name)
    g.gate("BAR", Op.NULL, ["B"])
    g.top = "BAR"
    et = EventTree(
        init_event="IE", init_frequency=init_freq,
        functional_events=[FunctionalEvent("BAR", link_ft="BAR")],
        sequences=[{"path": {"BAR": "success"}, "end_state": "OK"},
                   {"path": {"BAR": "failure"}, "end_state": "F"}],
        consequence_bins={"OK": c_ok, "F": c_fail})
    return Model(parameters=lib, fault_trees={"BAR": FaultTree("BAR", g)},
                 event_trees={"ET": et}, ccf_groups=[])


# ── 锚 1:均值锚 + 跨树守恒 ────────────────────────────────────────────────────

def test_anchor1_mean_and_cross_tree_conservation():
    t1 = _one_barrier_model(1e-3, "P1", 0.1)   # C1=9e-4, C2=1e-4
    t2 = _one_barrier_model(2e-3, "P2", 0.2)   # C1=1.6e-3, C2=4e-4
    # 逐树点估计自洽
    c1 = quantify_event_tree(t1, "ET")["consequences"]
    c2 = quantify_event_tree(t2, "ET")["consequences"]
    assert c1["C1"] == pytest.approx(9e-4) and c1["C2"] == pytest.approx(1e-4)
    assert c2["C1"] == pytest.approx(1.6e-3) and c2["C2"] == pytest.approx(4e-4)

    agg = aggregate_event_tree_uncertainty([(t1, "ET"), (t2, "ET")], samples=200, seed=1)
    p = agg["point"]
    assert p["C1"] == pytest.approx(2.5e-3)   # 9e-4 + 1.6e-3
    assert p["C2"] == pytest.approx(5e-4)     # 1e-4 + 4e-4
    total = sum(p[c] for c in ("C1", "C2", "C3", "C4", "C5"))
    assert total == pytest.approx(3e-3, rel=1e-12)   # Σ后果 = Σ初因频率(守恒跨树保持)
    # per_tree 分解逐树自洽(供后端钉扎 results.per_tree)
    assert agg["per_tree"][0]["C1"] == pytest.approx(9e-4)
    assert agg["per_tree"][1]["C2"] == pytest.approx(4e-4)


# ── 锚 2:共享参数均值不变锁(期望线性) ──────────────────────────────────────

def test_anchor2_shared_ref_mean_invariance():
    # 共享:两树屏障引用同一 ref 名 THETA;独立:引用不同 ref 名但同 median。
    shared = aggregate_event_tree_uncertainty(
        [(_one_barrier_model(1e-3, "THETA", 0.1), "ET"),
         (_one_barrier_model(2e-3, "THETA", 0.1), "ET")], samples=300, seed=7)
    indep = aggregate_event_tree_uncertainty(
        [(_one_barrier_model(1e-3, "P1", 0.1), "ET"),
         (_one_barrier_model(2e-3, "P2", 0.1), "ET")], samples=300, seed=7)
    # 聚合均值(点估计)与相关结构无关 —— E[ΣN]=ΣE[N] 恒成立。
    for c in ("C1", "C2", "C3", "C4", "C5"):
        assert shared["point"][c] == pytest.approx(indep["point"][c], rel=1e-12)
    assert shared["point"]["C2"] == pytest.approx(3e-4)     # (1e-3+2e-3)·0.1
    assert shared["point"]["C1"] == pytest.approx(2.7e-3)   # 1e-3·0.9 + 2e-3·0.9


# ── 锚 3:共享参数分位锚(方差行为的判据,证明联合抽样) ────────────────────────

def test_anchor3_shared_ref_quantile_joint_beats_independent():
    # 两树 C2 = f·θ,f1=1e-3、f2=2e-3,θ 同 ref 名(median 0.1, EF=3 ⇒ p95=0.3)。
    # 联合抽样:聚合 C2 = (f1+f2)·θ = 3e-3·θ 是单一 θ 的确定单调函数 → p95 = 3e-3·0.3 = 9e-4。
    t1 = _one_barrier_model(1e-3, "THETA", 0.1)
    t2 = _one_barrier_model(2e-3, "THETA", 0.1)
    N, SEED, EF = 40000, 20260714, 3.0
    joint = aggregate_event_tree_uncertainty([(t1, "ET"), (t2, "ET")],
                                             samples=N, seed=SEED, error_factor=EF)
    joint_p95 = joint["bands"]["C2"]["p95"]
    EXPECT = 3e-3 * 0.3                            # = 9e-4
    assert abs(joint_p95 - EXPECT) / EXPECT < 0.03  # 固定 seed/samples 的合理 MC 容差

    # 独立抽样判据(内联复算被禁止的实现):各树 θ 各自独立抽 → C2 = f1·θ1 + f2·θ2。
    # 共享数据源被当独立 → 聚合上分位被压窄,p95 严格小于联合值(NUREG-1855 SOKC)。
    rng = np.random.default_rng(SEED)
    sigma = log(EF) / 1.645
    th1 = np.clip(np.exp(rng.normal(log(0.1), sigma, N)), 0.0, 1.0)
    th2 = np.clip(np.exp(rng.normal(log(0.1), sigma, N)), 0.0, 1.0)
    indep_series = 1e-3 * th1 + 2e-3 * th2
    indep_p95 = float(np.percentile(indep_series, 95))
    assert indep_p95 < joint_p95                  # 联合 > 独立(方向判据)
    assert indep_p95 < EXPECT * 0.97              # 可测量地低于联合锚值

    # 两种方式均值同值(线性;点估计取 nominal=median)
    assert joint["point"]["C2"] == pytest.approx(3e-4)
