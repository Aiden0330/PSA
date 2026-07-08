from __future__ import annotations
import copy
from psaengine.model.pdag import PDAG, Op, Node

class CyclicLogicError(ValueError):
    pass

def _check_acyclic(g: PDAG) -> None:
    WHITE, GREY, BLACK = 0, 1, 2
    color = {nid: WHITE for nid in g.nodes}
    def dfs(nid):
        color[nid] = GREY
        for a in g.nodes[nid].args:
            if a not in color: continue
            if color[a] == GREY:
                raise CyclicLogicError(f"cycle through '{a}'")
            if color[a] == WHITE: dfs(a)
        color[nid] = BLACK
    for nid in g.nodes:
        if color[nid] == WHITE: dfs(nid)

def normalize(g: PDAG) -> PDAG:
    _check_acyclic(g)
    ng = copy.deepcopy(g)
    order = _post_order(ng, ng.top)
    for nid in order:
        n = ng.nodes[nid]
        if n.op is None: continue
        _const_prop(ng, n)
        _coalesce(ng, n)
    return ng

def _post_order(g: PDAG, root: str) -> list[str]:
    seen, out = set(), []
    def dfs(nid):
        if nid in seen: return
        seen.add(nid)
        for a in g.nodes[nid].args: dfs(a)
        out.append(nid)
    dfs(root)
    return out

def _is_true(g, a):
    n = g.nodes[a]                       # house 事件或已归一的恒真 NULL 门
    return (n.is_house and n.state is True) or (n.op is Op.NULL and n.state is True)
def _is_false(g, a):
    n = g.nodes[a]
    return (n.is_house and n.state is False) or (n.op is Op.NULL and n.state is False)

def _const_prop(g: PDAG, n: Node) -> None:
    if n.op is Op.OR:
        if any(_is_true(g, a) for a in n.args):
            n.op, n.args, n.state = Op.NULL, [], True       # 恒真常量门
            return
        n.args = [a for a in n.args if not _is_false(g, a)]
    elif n.op is Op.AND:
        if any(_is_false(g, a) for a in n.args):
            n.op, n.args, n.state = Op.NULL, [], False       # 恒假常量门
            return
        n.args = [a for a in n.args if not _is_true(g, a)]

def _coalesce(g: PDAG, n: Node) -> None:
    if n.op not in (Op.AND, Op.OR): return
    merged: list[str] = []
    for a in n.args:
        c = g.nodes[a]
        if c.op is n.op:                # 同类型嵌套门 → 提升其子
            merged.extend(c.args)
        else:
            merged.append(a)
    # 去重(同名即同事件), 保序
    seen, dedup = set(), []
    for a in merged:
        if a not in seen: seen.add(a); dedup.append(a)
    n.args = dedup
