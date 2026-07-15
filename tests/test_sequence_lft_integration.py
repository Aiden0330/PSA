"""序列级完整 LFT 集成(规格 2026-07-15-sequence-lft-integration)。

rate(s) = Σ_i λ_i·P(E_i ∧ Path_s),合并 BDD 精确——IE 使能与屏障共享基本事件
自动正确(含成功分支精确否定)。锚点 C 是本特性的存在理由:共享使能击穿屏障时,
两段式(F×P(path))把不可能的成功序列算出正频率、把失败序列低估 3.6×。
"""
from itertools import product as iproduct

import pytest

from psaengine.eta.sequence import quantify_event_tree_integrated, event_tree_sequences_integrated
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.fault_tree import FaultTree
from psaengine.model.model import Model
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.pdag import PDAG, Op
from psaengine.quantify.frequency import FrequencyRuleError, fault_tree_frequency


def _ft(build) -> FaultTree:
    g = PDAG()
    build(g)
    return FaultTree(g.top, g)


def _model(params, ie_build, barriers: dict, sequences, consequences=None) -> Model:
    lib = ParameterLibrary()
    for p in params:
        lib.add(p)
    fts = {name: _ft(b) for name, b in barriers.items()}
    fts["__init__"] = _ft(ie_build)
    ends = {s["end_state"] for s in sequences}
    et = EventTree(
        init_event="IE", init_frequency=0.0,   # 集成模式不用标量初频
        functional_events=[FunctionalEvent(id=fid, link_ft=fid) for fid in barriers],
        sequences=sequences,
        consequence_bins=consequences or {e: "C1" for e in ends},
    )
    return Model(parameters=lib, fault_trees=fts, event_trees={"TR": et})


def _seq(path: dict, end: str) -> dict:
    return {"path": path, "end_state": end}


# ── 锚点 A:零共享退化 = 两段式(exact 头条)逐位 ────────────────────────────

def _model_A():
    params = [Parameter("I", "frequency", 1e-3),
              Parameter("A", "probability", 0.2),
              Parameter("B", "probability", 0.1)]
    ie = lambda g: (g.basic("I"), g.basic("A"), g.gate("IE_TOP", Op.AND, ["I", "A"]))
    barriers = {"FE_B": lambda g: (g.basic("B"), g.gate("B_TOP", Op.OR, ["B"]))}
    seqs = [_seq({"FE_B": "failure"}, "S_FAIL"), _seq({"FE_B": "success"}, "S_OK")]
    return _model(params, ie, barriers, seqs)


def test_anchor_A_no_sharing_equals_two_stage():
    m = _model_A()
    r = quantify_event_tree_integrated(m, "TR", ie_ft_name="__init__")
    assert r["method"] == "integrated"
    assert r["sequences"]["S_FAIL"] == pytest.approx(1e-3 * 0.2 * 0.1, rel=1e-12)
    assert r["sequences"]["S_OK"] == pytest.approx(1e-3 * 0.2 * 0.9, rel=1e-12)
    # 与频率通道 exact 头条对账
    f = fault_tree_frequency(m, "__init__", method="exact")["frequency"]
    assert r["ie_frequency"] == pytest.approx(f, rel=1e-12)


# ── 锚点 C:共享使能击穿屏障 —— 成功序列恒零,失败序列 = λ·qS ────────────────

def _model_C():
    params = [Parameter("I", "frequency", 1e-3),
              Parameter("S", "probability", 0.2),
              Parameter("X", "probability", 0.1)]
    ie = lambda g: (g.basic("I"), g.basic("S"), g.gate("IE_TOP", Op.AND, ["I", "S"]))
    barriers = {"FE_B": lambda g: (g.basic("S"), g.basic("X"), g.gate("B_TOP", Op.OR, ["S", "X"]))}
    seqs = [_seq({"FE_B": "failure"}, "S_FAIL"), _seq({"FE_B": "success"}, "S_OK")]
    return _model(params, ie, barriers, seqs)


def test_anchor_C_shared_enabler_defeats_barrier():
    m = _model_C()
    r = quantify_event_tree_integrated(m, "TR", ie_ft_name="__init__")
    # 失败序列:P(S ∧ (S∨X)) = P(S) → λ·qS = 2e-4(两段式给 5.6e-5,低估 3.6×)
    assert r["sequences"]["S_FAIL"] == pytest.approx(2e-4, rel=1e-12)
    two_stage = 1e-3 * 0.2 * (0.2 + 0.1 - 0.02)
    assert r["sequences"]["S_FAIL"] > two_stage * 3.5
    # 成功序列:P(S ∧ ¬(S∨X)) = 0 —— 物理不可能态(两段式给 1.44e-4 > 0)
    assert r["sequences"]["S_OK"] == pytest.approx(0.0, abs=1e-18)


# ── 锚点 B:守恒 —— Σ 序列 = 频率通道 exact 头条(共享结构任意)─────────────

def test_anchor_B_conservation_under_sharing():
    m = _model_C()
    r = quantify_event_tree_integrated(m, "TR", ie_ft_name="__init__")
    f_exact = fault_tree_frequency(m, "__init__", method="exact")["frequency"]
    assert sum(r["sequences"].values()) == pytest.approx(f_exact, rel=1e-12)
    assert r["ie_frequency"] == pytest.approx(f_exact, rel=1e-12)


# ── 锚点 D:双初因交叉共享 —— 暴力真值表对拍 ─────────────────────────────────

def _brute(seq_rates_wanted, lam, enabler_sets, barrier_expr, q):
    """rate(s) = Σ_i λ_i·P(E_i ∧ Path_s),真值表逐点求和(独立于 BDD 机器)。"""
    vars_ = sorted(q)
    out = {}
    for bits in iproduct([0, 1], repeat=len(vars_)):
        st = dict(zip(vars_, bits))
        w = 1.0
        for v in vars_:
            w *= q[v] if st[v] else (1 - q[v])
        b_fail = barrier_expr(st)
        for init, esets in enabler_sets.items():
            if any(all(st[e] for e in s) for s in esets):
                key = "S_FAIL" if b_fail else "S_OK"
                out[key] = out.get(key, 0.0) + lam[init] * w
    return out


def test_anchor_D_two_initiators_cross_sharing_matches_bruteforce():
    params = [Parameter("I1", "frequency", 2e-3), Parameter("I2", "frequency", 5e-4),
              Parameter("A", "probability", 0.3), Parameter("B", "probability", 0.25)]
    def ie(g):
        g.basic("I1"); g.basic("I2"); g.basic("A"); g.basic("B")
        g.gate("G1", Op.AND, ["I1", "A"]); g.gate("G2", Op.AND, ["I2", "B"])
        g.gate("IE_TOP", Op.OR, ["G1", "G2"])
    barriers = {"FE_B": lambda g: (g.basic("A"), g.basic("B"), g.gate("B_TOP", Op.OR, ["A", "B"]))}
    seqs = [_seq({"FE_B": "failure"}, "S_FAIL"), _seq({"FE_B": "success"}, "S_OK")]
    m = _model(params, ie, barriers, seqs)
    r = quantify_event_tree_integrated(m, "TR", ie_ft_name="__init__")
    ref = _brute(None, {"I1": 2e-3, "I2": 5e-4}, {"I1": [{"A"}], "I2": [{"B"}]},
                 lambda st: st["A"] or st["B"], {"A": 0.3, "B": 0.25})
    assert r["sequences"]["S_FAIL"] == pytest.approx(ref.get("S_FAIL", 0.0), rel=1e-12)
    assert r["sequences"]["S_OK"] == pytest.approx(ref.get("S_OK", 0.0), rel=1e-12)


# ── 锚点 E:双屏障成功否定 × 共享 —— 明细通道与真值表逐位 ────────────────────

def test_anchor_E_two_barriers_success_negation_with_sharing():
    params = [Parameter("I", "frequency", 1e-3),
              Parameter("S", "probability", 0.2), Parameter("X", "probability", 0.1),
              Parameter("Y", "probability", 0.4)]
    def ie(g):
        g.basic("I"); g.basic("S"); g.gate("IE_TOP", Op.AND, ["I", "S"])
    barriers = {
        "FE_1": lambda g: (g.basic("S"), g.basic("X"), g.gate("T1", Op.OR, ["S", "X"])),
        "FE_2": lambda g: (g.basic("X"), g.basic("Y"), g.gate("T2", Op.AND, ["X", "Y"])),
    }
    seqs = [
        _seq({"FE_1": "failure", "FE_2": "failure"}, "S_FF"),
        _seq({"FE_1": "failure", "FE_2": "success"}, "S_FS"),
        _seq({"FE_1": "success", "FE_2": "failure"}, "S_SF"),
        _seq({"FE_1": "success", "FE_2": "success"}, "S_SS"),
    ]
    m = _model(params, ie, barriers, seqs)
    rows = {r["end_state"]: r["frequency"]
            for r in event_tree_sequences_integrated(m, "TR", ie_ft_name="__init__")}
    q = {"S": 0.2, "X": 0.1, "Y": 0.4}
    lam = 1e-3
    ref = {k: 0.0 for k in ("S_FF", "S_FS", "S_SF", "S_SS")}
    for bits in iproduct([0, 1], repeat=3):
        st = dict(zip(sorted(q), bits))
        w = 1.0
        for v in q:
            w *= q[v] if st[v] else (1 - q[v])
        if not st["S"]:
            continue                     # E_I = {S}
        b1 = st["S"] or st["X"]; b2 = st["X"] and st["Y"]
        key = "S_" + ("F" if b1 else "S") + ("F" if b2 else "S")
        ref[key] += lam * w
    for k in ref:
        assert rows[k] == pytest.approx(ref[k], rel=1e-12, abs=1e-18), k
    # 成功否定守恒:S 成功分支(¬(S∨X))与 E={S} 相交为空 → S_S* 恒零
    assert rows["S_SF"] == pytest.approx(0.0, abs=1e-18)
    assert rows["S_SS"] == pytest.approx(0.0, abs=1e-18)


# ── v1 排除:响亮拒绝 ─────────────────────────────────────────────────────────

def test_integrated_rejects_ie_events_in_ccf_groups():
    from psaengine.model.ccf import CCFGroup
    m = _model_C()
    m.ccf_groups = [CCFGroup(id="g", members=["S", "X"], model="beta", factors={"beta": 0.1})]
    with pytest.raises(ValueError, match="CCF"):
        quantify_event_tree_integrated(m, "TR", ie_ft_name="__init__")


def test_integrated_propagates_frequency_rule_errors():
    # IE 树违反一频率规则(纯概率割集)→ 频率通道的响亮错误原样上抛
    params = [Parameter("Q1", "probability", 0.1), Parameter("B", "probability", 0.1)]
    ie = lambda g: (g.basic("Q1"), g.gate("IE_TOP", Op.OR, ["Q1"]))
    barriers = {"FE_B": lambda g: (g.basic("B"), g.gate("B_TOP", Op.OR, ["B"]))}
    seqs = [_seq({"FE_B": "failure"}, "S_FAIL"), _seq({"FE_B": "success"}, "S_OK")]
    m = _model(params, ie, barriers, seqs)
    with pytest.raises(FrequencyRuleError):
        quantify_event_tree_integrated(m, "TR", ie_ft_name="__init__")


# ── review ed90116 F1/F2/F3 回归锁:碰撞护栏(五类探针全部改为响亮拒绝)──────

def _mk(params, ie_build, barriers, seqs):
    return _model(params, ie_build, barriers, seqs)


def test_guard_ie_gate_id_collides_with_barrier_gate():
    """审查探针第 1 行(88× 静默低估):IE 门 id == 屏障门 id → 响亮拒绝。"""
    params = [Parameter("I", "frequency", 1e-3),
              Parameter("A", "probability", 0.3), Parameter("B", "probability", 0.2),
              Parameter("D", "probability", 0.1), Parameter("E", "probability", 0.05)]
    def ie(g):
        g.basic("I"); g.basic("A"); g.basic("B")
        g.gate("EN", Op.OR, ["A", "B"]); g.gate("IE_TOP", Op.AND, ["I", "EN"])
    barriers = {"FE_B": lambda g: (g.basic("D"), g.basic("E"),
                                   g.gate("EN", Op.AND, ["D", "E"]),
                                   g.gate("B_TOP", Op.OR, ["EN"]))}
    seqs = [_seq({"FE_B": "failure"}, "S_FAIL"), _seq({"FE_B": "success"}, "S_OK")]
    with pytest.raises(ValueError, match="EN"):
        quantify_event_tree_integrated(_mk(params, ie, barriers, seqs), "TR",
                                       ie_ft_name="__init__")


def test_guard_ie_basic_id_collides_with_barrier_gate():
    """审查探针第 2 行(5× 静默高估):IE 基本事件 id == 屏障门 id → 响亮拒绝。"""
    params = [Parameter("I", "frequency", 1e-3), Parameter("SP", "probability", 0.2),
              Parameter("X", "probability", 0.4), Parameter("Y", "probability", 0.1)]
    def ie(g):
        g.basic("I"); g.basic("S", param_ref="SP"); g.gate("IE_TOP", Op.AND, ["I", "S"])
    barriers = {"FE_B": lambda g: (g.basic("X"), g.basic("Y"),
                                   g.gate("S", Op.OR, ["X", "Y"]))}
    seqs = [_seq({"FE_B": "failure"}, "S_FAIL"), _seq({"FE_B": "success"}, "S_OK")]
    with pytest.raises(ValueError, match="'S'"):
        quantify_event_tree_integrated(_mk(params, ie, barriers, seqs), "TR",
                                       ie_ft_name="__init__")


def test_guard_shared_basic_with_conflicting_param_ref():
    """审查探针第 6 行:同 id 基本事件、param_ref 不同 → 拒绝(歧义模型)。"""
    params = [Parameter("I", "frequency", 1e-3),
              Parameter("PS_IE", "probability", 0.3), Parameter("PS_B", "probability", 0.1)]
    def ie(g):
        g.basic("I"); g.basic("S", param_ref="PS_IE"); g.gate("IE_TOP", Op.AND, ["I", "S"])
    barriers = {"FE_B": lambda g: (g.basic("S", param_ref="PS_B"),
                                   g.gate("B_TOP", Op.OR, ["S"]))}
    seqs = [_seq({"FE_B": "failure"}, "S_FAIL"), _seq({"FE_B": "success"}, "S_OK")]
    with pytest.raises(ValueError, match="param_ref"):
        quantify_event_tree_integrated(_mk(params, ie, barriers, seqs), "TR",
                                       ie_ft_name="__init__")


def test_guard_ccf_member_collides_with_ie_gate_id():
    """审查探针第 4 行(绕过旧守卫):CCF 成员撞 IE **门** id → 加宽后的守卫拒绝。"""
    from psaengine.model.ccf import CCFGroup
    params = [Parameter("I", "frequency", 1e-3),
              Parameter("A", "probability", 0.3), Parameter("B", "probability", 0.2),
              Parameter("M1", "probability", 0.1), Parameter("M2", "probability", 0.1)]
    def ie(g):
        g.basic("I"); g.basic("A"); g.basic("B")
        g.gate("M1", Op.OR, ["A", "B"]); g.gate("IE_TOP", Op.AND, ["I", "M1"])
    barriers = {"FE_B": lambda g: (g.basic("M1x", param_ref="M1"),
                                   g.basic("M2x", param_ref="M2"),
                                   g.gate("B_TOP", Op.OR, ["M1x", "M2x"]))}
    seqs = [_seq({"FE_B": "failure"}, "S_FAIL"), _seq({"FE_B": "success"}, "S_OK")]
    m = _mk(params, ie, barriers, seqs)
    m.ccf_groups = [CCFGroup(id="g", members=["M1x", "M1"], model="beta",
                             factors={"beta": 0.1})]
    with pytest.raises(ValueError, match="CCF"):
        quantify_event_tree_integrated(m, "TR", ie_ft_name="__init__")


def test_guard_barrier_house_id_collides_with_ie_basic():
    """审查探针第 5 行(违背"bc 仅屏障侧"):屏障 house id == IE 基本事件 id → 拒绝。"""
    params = [Parameter("I", "frequency", 1e-3), Parameter("H", "probability", 0.25)]
    def ie(g):
        g.basic("I"); g.basic("H"); g.gate("IE_TOP", Op.AND, ["I", "H"])
    def barrier(g):
        g.basic("Z", param_ref="H"); g.house("H", True)
        g.gate("B_TOP", Op.OR, ["Z", "H"])
    seqs = [_seq({"FE_B": "failure"}, "S_FAIL"), _seq({"FE_B": "success"}, "S_OK")]
    m = _mk(params, ie, {"FE_B": barrier}, seqs)
    with pytest.raises(ValueError, match="'H'"):
        quantify_event_tree_integrated(m, "TR", ie_ft_name="__init__")


def test_guard_barrier_referencing_frequency_param_is_named_error():
    """review F2:屏障树引用频率参数 → 点名拒绝(此前深处 KeyError → HTTP 500)。"""
    params = [Parameter("I", "frequency", 1e-3), Parameter("S", "probability", 0.2)]
    def ie(g):
        g.basic("I"); g.basic("S"); g.gate("IE_TOP", Op.AND, ["I", "S"])
    barriers = {"FE_B": lambda g: (g.basic("IB", param_ref="I"),
                                   g.gate("B_TOP", Op.OR, ["IB"]))}
    seqs = [_seq({"FE_B": "failure"}, "S_FAIL"), _seq({"FE_B": "success"}, "S_OK")]
    with pytest.raises(ValueError, match="frequency-kind"):
        quantify_event_tree_integrated(_mk(params, ie, barriers, seqs), "TR",
                                       ie_ft_name="__init__")


def test_guard_legitimate_sharing_unperturbed():
    """护栏不得扰动合法共享:锚点 C 数值逐位不变(审查 round-2 明示要求)。"""
    m = _model_C()
    r = quantify_event_tree_integrated(m, "TR", ie_ft_name="__init__")
    assert r["sequences"]["S_FAIL"] == pytest.approx(2e-4, rel=1e-12)
    assert r["sequences"]["S_OK"] == pytest.approx(0.0, abs=1e-18)
