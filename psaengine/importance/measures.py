from __future__ import annotations
from psaengine.bdd.kernel import BddManager
from psaengine.quantify.probability import exact_probability

def importance(m: BddManager, root: int, q: dict[str, float],
               measures: list[str]) -> dict[str, dict[str, float]]:
    """重要度: 用 cofactor 等价的'置参数为 1/0 再精确求值'实现(数值上即 BDD 偏导),
    复用已验证的 exact_probability, 正确性更稳。参考 Dutuit & Rauzy 2000。"""
    h = exact_probability(m, root, q)
    out: dict[str, dict[str, float]] = {}
    for name in q:
        q1 = dict(q); q1[name] = 1.0
        q0 = dict(q); q0[name] = 0.0
        h1 = exact_probability(m, root, q1)   # h(1_i, p)
        h0 = exact_probability(m, root, q0)   # h(0_i, p)
        vals: dict[str, float] = {}
        birnbaum = h1 - h0
        for meas in measures:
            if meas == "birnbaum": vals["birnbaum"] = birnbaum
            elif meas == "fv":  vals["fv"] = (h - h0) / h if h > 0 else 0.0
            elif meas == "raw": vals["raw"] = h1 / h if h > 0 else float("inf")
            elif meas == "rrw": vals["rrw"] = h / h0 if h0 > 0 else float("inf")
            elif meas == "dim": vals["dim"] = birnbaum * q[name]    # 微分重要度(未归一)
            else: raise ValueError(f"unknown importance measure {meas}")
        out[name] = vals
    return out
