from __future__ import annotations
from psaengine.model.pdag import PDAG

def dflm(g: PDAG) -> list[str]:
    """深度优先最左, 首次访问基本事件即赋序。"""
    order, seen = [], set()
    def dfs(nid):
        n = g.nodes[nid]
        if n.is_basic:
            if nid not in seen: seen.add(nid); order.append(nid)
            return
        for a in n.args: dfs(a)
    dfs(g.top)
    return order

def wdflm(g: PDAG) -> list[str]:
    """加权: 按基本事件出现次数降序作为打破顺序的权重。"""
    counts: dict[str, int] = {}
    def count(nid):
        n = g.nodes[nid]
        if n.is_basic: counts[nid] = counts.get(nid, 0) + 1; return
        for a in n.args: count(a)
    count(g.top)
    order, seen = [], set()
    def dfs(nid):
        n = g.nodes[nid]
        if n.is_basic:
            if nid not in seen: seen.add(nid); order.append(nid)
            return
        for a in sorted(n.args, key=lambda x: -counts.get(x, 0)): dfs(a)
    dfs(g.top)
    return order

def rdflm(g: PDAG) -> list[str]:
    """重复事件优先: 先把多次出现的事件排前。"""
    base = wdflm(g)
    counts: dict[str, int] = {}
    def count(nid):
        n = g.nodes[nid]
        if n.is_basic: counts[nid] = counts.get(nid, 0) + 1; return
        for a in n.args: count(a)
    count(g.top)
    return sorted(base, key=lambda x: (-counts.get(x, 1), base.index(x)))
