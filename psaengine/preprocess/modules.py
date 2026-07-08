from __future__ import annotations
import copy
from psaengine.model.pdag import PDAG, Op, Node

def _leaves(g: PDAG, root: str) -> dict[str, set[str]]:
    memo: dict[str, set[str]] = {}
    def rec(nid):
        if nid in memo: return memo[nid]
        n = g.nodes[nid]
        if n.is_basic: r = {nid}
        elif n.is_house: r = set()
        else:
            r = set()
            for a in n.args: r |= rec(a)
        memo[nid] = r; return r
    rec(root); return memo

def find_modules(g: PDAG, root: str) -> list[str]:
    """模块 = 子树叶子不在该子树之外出现的门(Dutuit-Rauzy 模块定义)。"""
    leaves = _leaves(g, root)
    mods = []
    for nid, n in g.nodes.items():
        if nid == root or n.op is None or n.is_basic or n.is_house:
            continue
        if n.op is Op.NULL and n.state is not None:
            continue
        seen, outside = set(), set()
        def walk(x):
            if x == nid or x in seen: return
            seen.add(x)
            nn = g.nodes[x]
            if nn.is_basic: outside.add(x); return
            for a in nn.args: walk(a)
        walk(root)
        if leaves[nid].isdisjoint(outside):
            mods.append(nid)
    return mods

def dflm_rooted(g: PDAG, root: str) -> list[str]:
    order, seen = [], set()
    def dfs(nid):
        n = g.nodes[nid]
        if n.is_basic:
            if nid not in seen: seen.add(nid); order.append(nid)
            return
        for a in n.args: dfs(a)
    dfs(root); return order

def modular_probability(g: PDAG, root: str, q: dict[str, float]) -> float:
    """对极大独立模块分治求精确概率, 再代入约简树求顶值(== 直接 BDD)。"""
    from psaengine.bdd.kernel import BddManager, build_from_pdag
    from psaengine.quantify.probability import exact_probability
    mods = find_modules(g, root)
    def subtree(nid):
        acc = set()
        def w(x):
            if x in acc: return
            acc.add(x)
            for a in g.nodes[x].args: w(a)
        w(nid); return acc
    maximal = [m for m in mods
               if not any(o != m and m in subtree(o) for o in mods)]
    rg = copy.deepcopy(g); qq = dict(q)
    for mnid in maximal:
        bm = BddManager(dflm_rooted(g, mnid))
        rm = build_from_pdag(bm, g, mnid)
        qq[mnid] = exact_probability(bm, rm, q)
        rg.nodes[mnid] = Node(mnid, is_basic=True, param_ref=mnid)   # 折叠为基本事件
    bt = BddManager(dflm_rooted(rg, root))
    rt = build_from_pdag(bt, rg, root)
    return exact_probability(bt, rt, qq)
