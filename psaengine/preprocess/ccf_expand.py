from __future__ import annotations
import copy
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary

def apply_ccf(pdag: PDAG, ccf_groups, params: ParameterLibrary):
    """Beta 因子 CCF 展开:把同组成员基本事件 m 原位改为 OR(m__I 独立, CCF_g 共因)。
    m 变门后所有父引用自动指向该 OR(无需改父)。返回 (新 pdag, 扩充参数库)。
    MGL/Alpha 暂以其 beta(首因子)分量近似。"""
    if not ccf_groups:
        return pdag, params
    g = copy.deepcopy(pdag)
    lib = ParameterLibrary()
    for pid in params.ids():
        lib.add(copy.deepcopy(params.get(pid)))

    for grp in ccf_groups:
        beta = grp.factors.get("beta", 0.0)
        members = [m for m in grp.members if m in g.nodes and g.nodes[m].is_basic]
        if not members or beta <= 0:
            continue
        q_rep = lib.get(g.nodes[members[0]].param_ref).unavailability()   # 代表 Q(首成员)
        ccf_id = f"CCF_{grp.id}"
        lib.add(Parameter(ccf_id, "probability", beta * q_rep))
        g.basic(ccf_id, param_ref=ccf_id)
        for m in members:
            qm = lib.get(g.nodes[m].param_ref).unavailability()
            indep_id = f"{m}__I"
            lib.add(Parameter(indep_id, "probability", (1.0 - beta) * qm))
            g.basic(indep_id, param_ref=indep_id)
            node = g.nodes[m]                       # 原位把 m 改成 OR 门
            node.is_basic = False
            node.param_ref = None
            node.op = Op.OR
            node.args = [indep_id, ccf_id]
    return g, lib
