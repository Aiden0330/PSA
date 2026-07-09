from __future__ import annotations
import copy

from psaengine.model.pdag import PDAG


def resolve_house_states(model, house_states: dict[str, bool] | None = None,
                         boundary_condition_set: str | None = None) -> dict[str, bool]:
    """合成本次分析的 house 事件状态:命名边界条件集打底,显式 house_states 覆盖。"""
    out: dict[str, bool] = {}
    if boundary_condition_set:
        if boundary_condition_set not in model.bc_sets:
            raise ValueError(f"unknown boundary condition set '{boundary_condition_set}' "
                             f"(defined: {sorted(model.bc_sets)})")
        out.update(model.bc_sets[boundary_condition_set])
    if house_states:
        out.update(house_states)
    return out


def apply_house_states(pdag: PDAG, states: dict[str, bool]) -> PDAG:
    """按状态覆盖 house 事件,返回副本 —— 模型本体不可被分析改写(审计前提)。
    未知 id 或指向非 house 节点 → 响亮失败(静默忽略会让边界条件悄悄失效)。"""
    if not states:
        return pdag
    g = copy.deepcopy(pdag)
    for hid, st in states.items():
        if hid not in g.nodes:
            raise ValueError(f"unknown house event '{hid}' in boundary conditions")
        n = g.nodes[hid]
        if not n.is_house:
            raise ValueError(f"boundary condition target '{hid}' is not a house event")
        n.state = bool(st)
    return g
