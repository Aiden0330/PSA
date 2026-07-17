"""P-7 向量化锁:batch Shannon 每列与标量逐位;冻结值锁(A7/A1/banked)由原文件承担。

等价论证:exact_probability_batch 与标量同表达式 `p·hi+(1−p)·lo` 的 numpy 逐元素版,
IEEE 754 逐元素乘加与标量同轮回 ⇒ 每样本列逐位同。本文件直接逐列对拍(含共享事件/
否定/表决/house 常量的 BDD);抽样流不变性由 tests/unit/test_mc_sokc_fsum_ccf8.py A1
(单树≡聚合逐位)与 banked A7 冻结值(向量化前后同值)双证。
"""
import os

import numpy as np
import pytest

from backend.et_builder import build_model_from_request
from psaengine.eta.sequence import _build_event_tree
from psaengine.quantify.probability import exact_probability, exact_probability_batch


def _mixed_model():
    return build_model_from_request({
        "init_event": "IE", "init_frequency": 1.0,
        "functional_events": [{"id": "FE1", "link_ft": "FE1"}, {"id": "FE2", "link_ft": "FE2"}],
        "fault_trees": {
            "FE1": {"name": "FE1", "top": "T1", "nodes": [
                {"id": "S", "basic": True, "param_ref": "S"},
                {"id": "A", "basic": True, "param_ref": "A"},
                {"id": "B", "basic": True, "param_ref": "B"},
                {"id": "V", "op": "atleast", "args": ["S", "A", "B"], "k": 2},
                {"id": "H", "house": True, "state": False},
                {"id": "T1", "op": "or", "args": ["V", "H"]}]},
            "FE2": {"name": "FE2", "top": "T2", "nodes": [
                {"id": "S", "basic": True, "param_ref": "S"},          # 共享事件
                {"id": "C", "basic": True, "param_ref": "C"},
                {"id": "T2", "op": "and", "args": ["S", "C"]}]}},
        "parameters": {"S": {"value": 0.2}, "A": {"value": 0.1},
                       "B": {"value": 0.05}, "C": {"value": 0.3}},
        "sequences": [{"path": {"FE1": "success", "FE2": "success"}, "end_state": "L0"},
                      {"path": {"FE1": "success", "FE2": "failure"}, "end_state": "L1"},
                      {"path": {"FE1": "failure", "FE2": "success"}, "end_state": "L2"},
                      {"path": {"FE1": "failure", "FE2": "failure"}, "end_state": "L3"}],
        "consequence_bins": {"L0": "C1", "L1": "C2", "L2": "C2", "L3": "C3"}})


def test_batch_shannon_bitwise_per_column():
    b = _build_event_tree(_mixed_model(), "TR", None, None)
    m, fe_bdd = b.m, b.fe_bdd
    exprs = []
    for seq in b.et.sequences:                       # 全部 4 条序列表达式(含精确否定)
        e = m.one
        for fid, br in seq["path"].items():
            g = fe_bdd[fid]
            e = m.apply_and(e, g if br == "failure" else m.apply_not(g))
        exprs.append(e)
    cols = [
        {"S": 0.2, "A": 0.1, "B": 0.05, "C": 0.3},
        {"S": 0.0, "A": 1.0, "B": 0.5, "C": 1e-9},   # 边界值:0/1/极小
        {"S": 0.999, "A": 0.001, "B": 0.5, "C": 0.5},
        {"S": 1e-16, "A": 1e-16, "B": 1.0, "C": 0.0},
        {"S": 0.7, "A": 0.7, "B": 0.7, "C": 0.7},
    ]
    q_vec = {k: np.array([c[k] for c in cols]) for k in cols[0]}
    for e in exprs:
        pv = exact_probability_batch(m, e, q_vec)
        for i, c in enumerate(cols):
            scalar = exact_probability(m, e, dict(c))
            got = float(pv[i]) if isinstance(pv, np.ndarray) else float(pv)
            assert got == scalar, f"col {i}: batch {got!r} ≠ scalar {scalar!r}(必须逐位)"


@pytest.mark.skipif(bool(os.environ.get("CI")), reason="计时探针只在本机跑(CI 计时=flake)")
def test_vectorized_mc_local_perf_probe():
    # 试点 P-7 基线:n=10 链 N=1000 标量 57s;向量化后须 <10s(宽松,防倒退不较毫秒)
    import time
    from psaengine.eta.uncertainty import event_tree_uncertainty
    fes, trees, params, seqs, bins = [], {}, {}, [], {}

    def walk(i, path, fails):
        if i == 10:
            es = f"L{len(seqs)}"
            seqs.append({"path": dict(path), "end_state": es})
            bins[es] = f"C{min(5, 1 + fails)}"
            return
        walk(i + 1, {**path, f"FE{i}": "success"}, fails)
        walk(i + 1, {**path, f"FE{i}": "failure"}, fails + 1)
    walk(0, {}, 0)
    for i in range(10):
        nodes = [{"id": f"B{i}_{k}", "basic": True, "param_ref": f"B{i}_{k}"} for k in range(3)]
        for k in range(3):
            params[f"B{i}_{k}"] = {"value": 0.02 + 0.001 * k}
        nodes.append({"id": f"T{i}", "op": "or", "args": [n["id"] for n in nodes]})
        trees[f"FE{i}"] = {"name": f"FE{i}", "top": f"T{i}", "nodes": nodes}
        fes.append({"id": f"FE{i}", "link_ft": f"FE{i}"})
    m = build_model_from_request({"init_event": "IE", "init_frequency": 1e-2,
                                  "functional_events": fes, "fault_trees": trees,
                                  "parameters": params, "sequences": seqs,
                                  "consequence_bins": bins})
    t0 = time.perf_counter()
    event_tree_uncertainty(m, "TR", samples=1000, seed=1, error_factor=3.0)
    dt = time.perf_counter() - t0
    assert dt < 10.0, f"N=1000 @1024 序列耗时 {dt:.1f}s(基线 57s,向量化应 <10s)"
