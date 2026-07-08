from __future__ import annotations
from math import prod
from psaengine.bdd.kernel import BddManager

def exact_probability(m: BddManager, root, q: dict[str, float]) -> float:
    """BDD 线性自底向上 Shannon 遍历, 精确顶事件概率。
    pr(node) = p·pr(hi) + (1-p)·pr(lo); 两项互斥, 故结果精确, 无近似误差。
    仅经 BddManager 的遍历协议(is_terminal/top_var_index/cofactor/var_name)
    访问 BDD, 因此对纯 Python 与 CUDD 后端通用。"""
    memo: dict = {}
    def pr(h) -> float:
        if m.is_terminal(h): return float(m.terminal_value(h))
        if h in memo: return memo[h]
        vi = m.top_var_index(h)
        p = q[m.var_name(vi)]
        r = p * pr(m.cofactor(h, vi, 1)) + (1.0 - p) * pr(m.cofactor(h, vi, 0))
        memo[h] = r
        return r
    return pr(root)

def rea(cutset_probs: list[float]) -> float:
    """稀有事件近似(上界): Σ Q_i。"""
    return sum(cutset_probs)

def mcub(cutset_probs: list[float]) -> float:
    """最小割集上界(Esary-Proschan): 1 - ∏(1-Q_i)。"""
    return 1.0 - prod(1.0 - q for q in cutset_probs)
