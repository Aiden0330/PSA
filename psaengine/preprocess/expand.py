from __future__ import annotations
from math import comb

def ccf_basic_probabilities(model: str, m: int, q_total: float, factors: dict) -> dict:
    """返回各阶 CCF 基本事件概率。键: 'independent'/'all'(beta) 或 '1'..'m'。
    参考 NUREG/CR-5485。"""
    if model == "beta":
        beta = factors["beta"]
        return {"independent": (1 - beta) * q_total, "all": beta * q_total}
    if model == "mgl":
        rho = {1: 1.0, 2: factors.get("beta", 0.0), 3: factors.get("gamma", 0.0),
               4: factors.get("delta", 0.0)}
        out = {}
        for k in range(1, m + 1):
            prod = 1.0
            for i in range(2, k + 1):
                prod *= rho.get(i, 0.0)
            next_rho = rho.get(k + 1, 0.0)
            out[str(k)] = (1.0 / comb(m - 1, k - 1)) * prod * (1 - next_rho) * q_total
        return out
    if model == "alpha":
        alpha = {k: factors.get(f"alpha{k}", 0.0) for k in range(1, m + 1)}
        alpha_t = sum(k * alpha[k] for k in alpha)   # 交错测试归一
        out = {}
        for k in range(1, m + 1):
            out[str(k)] = (k / comb(m - 1, k - 1)) * (alpha[k] / alpha_t) * q_total
        return out
    raise ValueError(f"unknown CCF model {model}")
