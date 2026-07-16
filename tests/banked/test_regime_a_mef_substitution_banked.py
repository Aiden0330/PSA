"""BANKED 锚点:regime-A 条件参数重绑定 + MEF define-substitution I/O。

规格:docs/superpowers/specs/2026-07-15-regime-a-rebind-mef-substitution-banked.md
两组独立探针,分组自动激活:
  A 组 —— psaengine.model.rebind 模块可导入(RebindRule / effective_parameters);
  B 组 —— Model dataclass 具 post_rules 字段(MEF 替换 I/O 之家)。
锚点手算式独立编码于各测试;数字仅注释。
"""
import dataclasses
import xml.etree.ElementTree as ET

import pytest

from psaengine import Analysis
from psaengine.model.fault_tree import FaultTree
from psaengine.model.model import Model
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.pdag import PDAG, Op
from psaengine.quantify.postprocess import PostRule


def _has_rebind() -> bool:
    try:
        import psaengine.model.rebind  # noqa: F401
        return True
    except ImportError:
        return False


_HAS_REBIND = _has_rebind()
_HAS_POST_FIELD = "post_rules" in {f.name for f in dataclasses.fields(Model)}

_SKIP_A = pytest.mark.skipif(
    not _HAS_REBIND,
    reason="BANKED:等待 psaengine/model/rebind.py(规格 2026-07-15-regime-a §2)")
_SKIP_B = pytest.mark.skipif(
    not _HAS_POST_FIELD,
    reason="BANKED:等待 Model.post_rules 字段 + MEF define-substitution I/O(规格 §3)")


# ── A 组共用建模:TOP = OR(A, AND(B,C), AND(H_MAINT,D)) ───────────────────────

def _base_model(qb=0.1, rules=None):
    lib = ParameterLibrary()
    for pid, v in (("A", 0.02), ("B", qb), ("C", 0.25), ("D", 0.3),
                   ("B_ALT", 0.4)):
        lib.add(Parameter(pid, "probability", v))
    # 评审 S1:frequency-kind 守卫夹具预置进库(不入图)——若后加,构造期校验的
    # 实现会以「param 不存在」路径通过测试,frequency 拒收守卫可从未存在。
    lib.add(Parameter("F_IE", "frequency", 1e-3))
    g = PDAG()
    for b in ("A", "B", "C", "D"):
        g.basic(b)
    g.house("H_MAINT", state=False)
    g.gate("G_BC", Op.AND, ["B", "C"])
    g.gate("G_HD", Op.AND, ["H_MAINT", "D"])
    g.gate("TOP", Op.OR, ["A", "G_BC", "G_HD"])
    g.top = "TOP"
    kw = {}
    if rules is not None:
        kw["rebind_rules"] = rules
    return Model(parameters=lib, fault_trees={"T": FaultTree("TOP", g)}, **kw)


def _rule(**over):
    from psaengine.model.rebind import RebindRule
    kw = dict(id="维修工况-B", when={"H_MAINT": True}, param="B", value=0.4,
              to_param=None)
    kw.update(over)
    return RebindRule(**kw)


@_SKIP_A
class TestRegimeARebind:

    def test_R1_rebind_identity_bitwise_and_hand_formula(self):
        m = _base_model(rules=[_rule()])
        p1 = Analysis(m, house_states={"H_MAINT": True}).probability()
        # 恒等式:与「直改模型 qB=0.4」同配置量化逐位相等(同支撑集同序 → 同 ROBDD 同算术)
        m_direct = _base_model(qb=0.4)
        assert p1 == Analysis(m_direct, house_states={"H_MAINT": True}).probability()
        # 独立手算(三支变量不交 → 乘积式):1−0.98·(1−0.4·0.25)·0.7 = 0.3826
        assert p1 == pytest.approx(1 - (1 - 0.02) * (1 - 0.4 * 0.25) * (1 - 0.3),
                                   rel=1e-12)

    def test_R2_inactive_condition_bitwise_base(self):
        m = _base_model(rules=[_rule()])
        m_plain = _base_model()
        assert Analysis(m).probability() == Analysis(m_plain).probability()
        # 手算:H=false → D 支死:1−0.98·(1−0.025) = 0.0445
        assert Analysis(m).probability() == pytest.approx(0.0445, rel=1e-12)

    def test_R2b_no_state_leak_roundtrip(self):
        # 规格 §6 回环锁:激活分析不得把视图写回模型
        m = _base_model(rules=[_rule()])
        p_before = Analysis(m).probability()
        Analysis(m, house_states={"H_MAINT": True}).probability()
        assert Analysis(m).probability() == p_before
        assert m.parameters.get("B").value == 0.1                 # 本体未改写
        # 评审 S5:规则表与旁参数也不许被改写(防"写回但不改 B"的泄漏形态)
        assert m.parameters.get("B_ALT").value == 0.4
        assert len(m.rebind_rules) == 1 and m.rebind_rules[0].value == 0.4

    def test_R3_to_param_equals_value_form(self):
        m_val = _base_model(rules=[_rule()])
        m_ref = _base_model(rules=[_rule(value=None, to_param="B_ALT")])
        cfg = {"H_MAINT": True}
        assert Analysis(m_val, house_states=cfg).probability() == \
               Analysis(m_ref, house_states=cfg).probability()

    def test_R4_cutsets_and_importance_see_rebound_q(self):
        m = _base_model(rules=[_rule()])
        a = Analysis(m, house_states={"H_MAINT": True})
        by_events = {frozenset(c.events): c for c in a.cutsets()}
        assert by_events[frozenset({"B", "C"})].probability == \
            pytest.approx(0.4 * 0.25, rel=1e-12)
        imp = a.importance(measures=("birnbaum",))
        # Birnbaum(C) = ∂P/∂qC = (1−qA)·qB′·(1−qD) = 0.98·0.4·0.7 = 0.2744
        assert imp["C"]["birnbaum"] == pytest.approx(0.98 * 0.4 * 0.7, rel=1e-12)

    def test_R5_ccf_member_rebind_flows_through_expansion(self):
        from psaengine.model.ccf import CCFGroup
        lib = ParameterLibrary()
        for pid, v in (("M1", 0.1), ("M2", 0.1), ("D", 0.3)):
            lib.add(Parameter(pid, "probability", v))
        g = PDAG()
        g.basic("M1"); g.basic("M2"); g.basic("D")
        g.house("H_MAINT", state=False)
        g.gate("G_AND", Op.AND, ["M1", "M2"])
        g.gate("G_HD", Op.AND, ["H_MAINT", "D"])
        g.gate("TOP", Op.OR, ["G_AND", "G_HD"])
        g.top = "TOP"
        rules = [_rule(id="Q-M1", param="M1"), _rule(id="Q-M2", param="M2")]
        m = Model(parameters=lib, fault_trees={"T": FaultTree("TOP", g)},
                  ccf_groups=[CCFGroup("cg", ["M1", "M2"], "beta", {"beta": 0.1})],
                  rebind_rules=rules)

        def p_and(q):   # beta 展开手算:P(M1∧M2) = βQ + (1−βQ)·((1−β)Q)²
            qc, qi = 0.1 * q, 0.9 * q
            return qc + (1 - qc) * qi * qi

        assert Analysis(m).probability() == pytest.approx(p_and(0.1), rel=1e-12)
        p_on = Analysis(m, house_states={"H_MAINT": True}).probability()
        assert p_on == pytest.approx(1 - (1 - p_and(0.4)) * (1 - 0.3), rel=1e-12)

    @pytest.mark.parametrize("mutate, err", [
        (dict(param="NOPE"), "NOPE"),                       # 未知 param
        (dict(when={"NO_HOUSE": True}), "NO_HOUSE"),        # 未知 house
        (dict(when={}), "维修工况-B"),                       # when 空
        (dict(value=1.2), "维修工况-B"),                     # 越界
        (dict(value=0.4, to_param="B_ALT"), "维修工况-B"),   # 同给
        (dict(value=None, to_param=None), "维修工况-B"),     # 双缺
        (dict(value=None, to_param="NOPE"), "NOPE"),        # to_param 缺失
        (dict(param="F_IE"), "F_IE"),                       # frequency-kind param
        (dict(value=None, to_param="F_IE"), "F_IE"),        # to_param 为 frequency(S1)
    ])
    def test_R6_guards_loud(self, mutate, err):
        # 契约锁的是「必带 id 的 ValueError」,构造期或应用期抛均可
        with pytest.raises(ValueError, match=err):
            m = _base_model(rules=[_rule(**mutate)])
            Analysis(m, house_states={"H_MAINT": True}).probability()

    def test_R6_conflict_two_active_rules_same_param(self):
        rules = [_rule(id="r1"), _rule(id="r2", value=0.5)]
        m = _base_model(rules=rules)
        with pytest.raises(ValueError, match="B"):
            Analysis(m, house_states={"H_MAINT": True}).probability()
        # 但仅一条激活时不冲突(第二条条件不满足的变体留实现批;此处锁「双激活必炸」)

    def test_R6_sampling_purpose_raises_on_active_rule(self):
        from psaengine.model.rebind import effective_parameters
        m = _base_model(rules=[_rule()])
        with pytest.raises(ValueError, match="维修工况-B"):
            effective_parameters(m, {"H_MAINT": True}, purpose="sampling")
        # 无激活规则时 sampling 放行
        effective_parameters(m, {"H_MAINT": False}, purpose="sampling")


# ── B 组:MEF define-substitution I/O ─────────────────────────────────────────

def _mef_model(rules):
    lib = ParameterLibrary()
    for pid, v in (("H", 0.2), ("X1", 0.03), ("X2", 0.04), ("X3", 0.05),
                   ("A_SRC", 0.01), ("A_TGT", 0.10), ("REC", 0.5)):
        lib.add(Parameter(pid, "probability", v))
    g = PDAG()
    # A_TGT / REC 故意不入树 —— model-data 并集规则的最尖探针(规格 §3)
    for b in ("H", "X1", "X2", "X3", "A_SRC"):
        g.basic(b)
    g.gate("TOP", Op.OR, ["H", "X1", "X2", "X3", "A_SRC"])
    g.top = "TOP"
    return Model(parameters=lib, fault_trees={"T": FaultTree("TOP", g)},
                 post_rules=rules)


def _four_rules():
    return [
        PostRule.from_dict({"kind": "mutually_exclusive",
                            "events": ["X1", "X2", "X3"]}),
        PostRule.from_dict({"kind": "delete_contains", "events": ["X1", "X2"]}),
        PostRule.from_dict({"kind": "recovery", "events": ["H"],
                            "add_event": "REC", "prob": 0.5}),
        PostRule.from_dict({"kind": "exchange", "events": ["H"],
                            "source": "A_SRC", "source_prob": 0.01,
                            "add_event": "A_TGT", "prob": 0.10}),
    ]


def _sig(r: PostRule):
    return (r.kind, tuple(sorted(r.events)), r.add_event, r.prob,
            r.source, r.source_prob)


@_SKIP_B
class TestMefSubstitutionIO:

    def test_M1_roundtrip_semantic_identity(self, tmp_path):
        from psaengine.model.mef_xml import load_mef_xml, save_mef_xml
        m = _mef_model(_four_rules())
        p = str(tmp_path / "sub.xml")
        save_mef_xml(m, p)
        m2 = load_mef_xml(p)
        assert sorted(map(_sig, m2.post_rules)) == sorted(map(_sig, m.post_rules))

    def test_M2_emitted_xml_shape(self, tmp_path):
        from psaengine.model.mef_xml import save_mef_xml
        p = str(tmp_path / "sub.xml")
        save_mef_xml(_mef_model(_four_rules()), p)
        root = ET.parse(p).getroot()
        subs = root.findall("define-substitution")
        assert len(subs) == 4
        by_type = {s.get("type"): s for s in subs}
        # mutually_exclusive(3 事件)→ delete-terms:atleast min=2 + constant false
        me = by_type["delete-terms"]
        hyp = me.find("hypothesis")
        assert hyp.find("atleast").get("min") == "2"
        assert len(hyp.find("atleast").findall("basic-event")) == 3
        assert me.find("target").find("constant").get("value") == "false"
        assert me.find("source") is None                       # 声明式
        # delete_contains → 无 type 声明式 and + false
        dc = by_type[None]
        assert dc.find("hypothesis").find("and") is not None
        assert dc.find("target").find("constant").get("value") == "false"
        # recovery → 声明式 target = basic-event REC
        rec = by_type["recovery-rule"]
        assert rec.find("source") is None
        assert rec.find("target").find("basic-event").get("name") == "REC"
        # exchange → 非声明式:source 单事件 ∈ hypothesis;target = A_TGT
        ex = by_type["exchange-event"]
        srcs = ex.find("source").findall("basic-event")
        assert [e.get("name") for e in srcs] == ["A_SRC"]
        hyp_names = {e.get("name") for e in ex.find("hypothesis").find("and")}
        assert {"H", "A_SRC"} <= hyp_names
        assert ex.find("target").find("basic-event").get("name") == "A_TGT"
        # model-data 并集规则:树外的 A_TGT / REC 也必须有 float
        md_names = {b.get("name") for b in
                    root.find("model-data").findall("define-basic-event")}
        assert {"A_TGT", "REC"} <= md_names

    @pytest.mark.parametrize("frag, why", [
        ("""<define-substitution name="s1">
              <hypothesis><and><or><basic-event name="X1"/>
                <basic-event name="X2"/></or><basic-event name="H"/></and></hypothesis>
              <target><constant value="false"/></target>
            </define-substitution>""", "嵌套 hypothesis"),
        ("""<define-substitution name="s2">
              <hypothesis><and><basic-event name="X1"/>
                <basic-event name="X2"/></and></hypothesis>
              <target><constant value="true"/></target>
            </define-substitution>""", "声明式 target=true"),
        ("""<define-substitution name="s3">
              <hypothesis><and><basic-event name="X1"/>
                <basic-event name="X2"/></and></hypothesis>
              <source><basic-event name="X1"/><basic-event name="X2"/></source>
              <target><basic-event name="A_TGT"/></target>
            </define-substitution>""", "多 source(替换型 recovery,v2)"),
        ("""<define-substitution name="s4">
              <hypothesis><atleast min="3"><basic-event name="X1"/>
                <basic-event name="X2"/><basic-event name="X3"/></atleast></hypothesis>
              <target><constant value="false"/></target>
            </define-substitution>""", "atleast min≠2"),
        ("""<define-substitution name="s5">
              <hypothesis><and><house-event name="X1"/>
                <basic-event name="X2"/></and></hypothesis>
              <target><constant value="false"/></target>
            </define-substitution>""", "hypothesis 含非 basic-event(D7)"),
        ("""<define-substitution name="s6">
              <hypothesis><xor><basic-event name="X1"/>
                <basic-event name="X2"/></xor></hypothesis>
              <target><constant value="false"/></target>
            </define-substitution>""", "xor 连接词(D7)"),
        ("""<define-substitution name="s7">
              <hypothesis><and><basic-event name="X1"/>
                <basic-event name="X2"/></and></hypothesis>
              <source><basic-event name="X1"/></source>
              <target><constant value="false"/></target>
            </define-substitution>""", "非声明式 target=false(D7)"),
    ])
    def test_M3_import_rejections_loud(self, tmp_path, frag, why):
        from psaengine.model.mef_xml import load_mef_xml
        doc = f"""<?xml version="1.0"?>
        <opsa-mef>
          <define-fault-tree name="T">
            <define-gate name="TOP"><or>
              <basic-event name="X1"/><basic-event name="X2"/>
              <basic-event name="X3"/><basic-event name="H"/>
            </or></define-gate>
          </define-fault-tree>
          {frag}
          <model-data>
            <define-basic-event name="X1"><float value="0.03"/></define-basic-event>
            <define-basic-event name="X2"><float value="0.04"/></define-basic-event>
            <define-basic-event name="X3"><float value="0.05"/></define-basic-event>
            <define-basic-event name="H"><float value="0.2"/></define-basic-event>
            <define-basic-event name="A_TGT"><float value="0.1"/></define-basic-event>
          </model-data>
        </opsa-mef>"""
        p = tmp_path / "bad.xml"
        p.write_text(doc, encoding="utf-8")
        with pytest.raises(ValueError):
            load_mef_xml(str(p))

    def test_M4_scram_style_exchange_fixture(self, tmp_path):
        from psaengine.model.mef_xml import load_mef_xml
        doc = """<?xml version="1.0"?>
        <opsa-mef>
          <define-fault-tree name="T">
            <define-gate name="TOP"><or>
              <basic-event name="H"/><basic-event name="A_SRC"/>
            </or></define-gate>
          </define-fault-tree>
          <define-substitution name="repl" type="exchange-event">
            <hypothesis><and>
              <basic-event name="H"/><basic-event name="A_SRC"/>
            </and></hypothesis>
            <source><basic-event name="A_SRC"/></source>
            <target><basic-event name="A_TGT"/></target>
          </define-substitution>
          <model-data>
            <define-basic-event name="H"><float value="0.2"/></define-basic-event>
            <define-basic-event name="A_SRC"><float value="0.01"/></define-basic-event>
            <define-basic-event name="A_TGT"><float value="0.1"/></define-basic-event>
          </model-data>
        </opsa-mef>"""
        p = tmp_path / "scram.xml"
        p.write_text(doc, encoding="utf-8")
        m = load_mef_xml(str(p))
        assert len(m.post_rules) == 1
        r = m.post_rules[0]
        assert (r.kind, r.events, r.source, r.add_event) == \
            ("exchange", ["H"], "A_SRC", "A_TGT")
        assert r.prob == pytest.approx(0.1) and r.source_prob == pytest.approx(0.01)
