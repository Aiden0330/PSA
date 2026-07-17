from __future__ import annotations
from math import prod
from psaengine.bdd.kernel import BddManager

def exact_probability(m: BddManager, root, q: dict[str, float]) -> float:
    """BDD 线性自底向上 Shannon 遍历, 精确顶事件概率。
    pr(node) = p·pr(hi) + (1-p)·pr(lo); 两项互斥, 故结果精确, 无近似误差。
    仅经 BddManager 的遍历协议(is_terminal/top_var_index/cofactor/var_name)
    访问 BDD, 因此对纯 Python 与 CUDD 后端通用。
    显式栈后序遍历(非递归):千级变量的链式 BDD 不受 Python 递归深度限制(4a6)。"""
    memo: dict = {}

    def val(h) -> float | None:
        if m.is_terminal(h):
            return float(m.terminal_value(h))
        return memo.get(h)

    stack = [root]
    while stack:
        h = stack[-1]
        v = val(h)
        if v is not None:
            stack.pop()
            continue
        vi = m.top_var_index(h)
        hi, lo = m.cofactor(h, vi, 1), m.cofactor(h, vi, 0)
        vhi, vlo = val(hi), val(lo)
        if vhi is None or vlo is None:
            if vhi is None:
                stack.append(hi)
            if vlo is None:
                stack.append(lo)
            continue
        p = q[m.var_name(vi)]
        memo[h] = p * vhi + (1.0 - p) * vlo
        stack.pop()
    v = val(root)
    assert v is not None
    return v

def exact_probability_batch(m: BddManager, root, q_vec: dict) -> "object":
    """样本批量版 Shannon 遍历(P-7,MC 通道专用):q_vec = {var_name: np.ndarray(N)}。

    与 exact_probability **逐字同表达式** `p·hi + (1−p)·lo` 的 numpy 逐元素版——IEEE 754
    逐元素乘加与标量同轮回 ⇒ 每个样本列与标量逐样本调用**逐位一致**(锁:banked A7 特征化
    值不动 + 单树≡聚合逐位 + test_mc_vectorization 标量重算交叉锁)。终端值以 float 参与
    广播。遍历协议与标量版同(is_terminal/top_var_index/cofactor/var_name),显式栈后序。"""
    memo: dict = {}

    def val(h):
        if m.is_terminal(h):
            return float(m.terminal_value(h))
        return memo.get(h)

    stack = [root]
    while stack:
        h = stack[-1]
        if val(h) is not None:
            stack.pop()
            continue
        vi = m.top_var_index(h)
        hi, lo = m.cofactor(h, vi, 1), m.cofactor(h, vi, 0)
        vhi, vlo = val(hi), val(lo)
        if vhi is None or vlo is None:
            if vhi is None:
                stack.append(hi)
            if vlo is None:
                stack.append(lo)
            continue
        p = q_vec[m.var_name(vi)]
        memo[h] = p * vhi + (1.0 - p) * vlo
        stack.pop()
    v = val(root)
    assert v is not None
    return v


def rea(cutset_probs: list[float]) -> float:
    """稀有事件近似(上界): Σ Q_i。"""
    return sum(cutset_probs)

def mcub(cutset_probs: list[float]) -> float:
    """最小割集上界(Esary-Proschan): 1 - ∏(1-Q_i)。"""
    return 1.0 - prod(1.0 - q for q in cutset_probs)
