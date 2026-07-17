from __future__ import annotations
import xml.etree.ElementTree as ET
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.fault_tree import FaultTree
from psaengine.model.ccf import CCFGroup
from psaengine.model.model import Model
from psaengine.quantify.postprocess import PostRule

_OP = {"and": Op.AND, "or": Op.OR, "not": Op.NOT, "atleast": Op.ATLEAST, "xor": Op.XOR}
_OP_REV = {v: k for k, v in _OP.items()}

# EB-08:MEF <float> 只承载一个概率标量。时变 Q(t) 模型(exponential/glm/weibull/
# periodic_test)经 unavailability() 会被**静默固化**成当前 t 的一个数——重导入即失真且
# 不可辨。导出侧对这四类响亮拒绝并点名参数(probability/rate 的既有扁平化行为零扰动)。
_QT_KINDS = frozenset(("exponential", "glm", "weibull", "periodic_test",
                       "periodic_test_complete"))   # banked Complete 同病同拒(11 参 XML 记 v2)


def _mef_unavailability(param, pid: str) -> float:
    if param.kind in _QT_KINDS:
        raise ValueError(
            f"MEF 导出无法承载参数 '{pid}'(kind='{param.kind}'):时变 Q(t) 模型会被静默"
            "固化为单个概率标量(重导入失真)。请以支持 Q(t) 的格式导出或先转定值参数。")
    return param.unavailability()

# MEF ↔ 引擎 CCF 模型名
_CCF_MODEL = {"beta-factor": "beta", "MGL": "mgl", "alpha-factor": "alpha", "phi-factor": "phi"}
_CCF_MODEL_REV = {v: k for k, v in _CCF_MODEL.items()}
_MGL_LEVELS = ("beta", "gamma", "delta", "epsilon", "mu", "nu")   # level 2.. → ρ_2..


def _factor_key(model: str, level: int) -> str:
    if model == "beta":
        return "beta"
    if model == "mgl":
        if not 2 <= level <= len(_MGL_LEVELS) + 1:
            raise ValueError(f"MGL factor level {level} out of supported range 2..{len(_MGL_LEVELS) + 1}")
        return _MGL_LEVELS[level - 2]
    return f"{model}{level}"                        # alpha{k} / phi{k}


def _base_level(model: str) -> int:
    """无 level 属性时的起始层级(SCRAM 语义:按模型最小层级顺次分配)。"""
    return 2 if model in ("beta", "mgl") else 1


def _factor_level(model: str, key: str) -> int:
    if model == "beta":
        return 2
    if model == "mgl":
        return _MGL_LEVELS.index(key) + 2
    return int(key.removeprefix(model))

def _parse_formula(elem, g: PDAG, owner: str, counter: list) -> str:
    """返回代表该 formula 的节点 id。引用类直接返回 name;连接词建(可能匿名)门。"""
    tag = elem.tag
    if tag in ("basic-event", "gate", "house-event"):
        return elem.attrib["name"]
    op = _OP[tag]
    args = [_parse_formula(c, g, owner, counter) for c in list(elem)]
    nid = f"{owner}__f{counter[0]}"; counter[0] += 1
    k = int(elem.attrib["min"]) if tag == "atleast" else None
    g.gate(nid, op, args, k=k)
    return nid

# ── define-substitution ↔ PostRule(regime-B 后处理规则;规格 §3 映射表)────────────
# 映射(逐行对照 SCRAM substitution.cc Validate()/type() 与 MEF input.rng L435-468):
#   mutually_exclusive → type=delete-terms;hypothesis and-2 或 atleast min=2;target false
#   delete_contains    → 无 type 声明式;hypothesis and;target false
#   recovery           → type=recovery-rule;hypothesis and;target basic-event(add_event)
#   exchange           → type=exchange-event 非声明式;hypothesis and(sorted(events∪source));
#                        <source> 单事件;target basic-event(add_event)
# model-data 并集规则:替换引用的树外基本事件(source/target/add_event)也必须写入 float,
# 否则导入侧概率不可解析(往返即断)。

def _emit_substitution(parent, rule: PostRule, idx: int, sub_extra: dict) -> None:
    sub = ET.SubElement(parent, "define-substitution", name=f"rule-{idx}")
    events = list(rule.events)

    def _and_or_atleast(hyp_events, force_atleast=False):
        hyp = ET.SubElement(sub, "hypothesis")
        if force_atleast and len(hyp_events) > 2:
            conn = ET.SubElement(hyp, "atleast")
            conn.set("min", "2")
        else:                                        # 一元 hypothesis 亦导出 <and> 单子(评审 S2)
            conn = ET.SubElement(hyp, "and")
        for e in hyp_events:
            ET.SubElement(conn, "basic-event", name=e)

    if rule.kind == "mutually_exclusive":
        sub.set("type", "delete-terms")
        _and_or_atleast(events, force_atleast=True)
        ET.SubElement(ET.SubElement(sub, "target"), "constant", value="false")
    elif rule.kind == "delete_contains":
        _and_or_atleast(events)                      # 无 type 属性(合法未定型声明式替换)
        ET.SubElement(ET.SubElement(sub, "target"), "constant", value="false")
    elif rule.kind == "recovery":
        sub.set("type", "recovery-rule")
        _and_or_atleast(events)
        ET.SubElement(ET.SubElement(sub, "target"), "basic-event", name=rule.add_event)
        sub_extra.setdefault(rule.add_event, float(rule.prob))
    elif rule.kind == "exchange":
        sub.set("type", "exchange-event")
        _and_or_atleast(sorted(set(events) | {rule.source}))
        ET.SubElement(ET.SubElement(sub, "source"), "basic-event", name=rule.source)
        ET.SubElement(ET.SubElement(sub, "target"), "basic-event", name=rule.add_event)
        sub_extra.setdefault(rule.source, float(rule.source_prob))
        sub_extra.setdefault(rule.add_event, float(rule.prob))
    else:
        raise ValueError(f"cannot export post-rule kind '{rule.kind}' to MEF substitution")


def _parse_substitution(sub, basics: dict) -> PostRule:
    name = sub.attrib.get("name", "?")
    hyp = sub.find("hypothesis")
    if hyp is None:
        raise ValueError(f"substitution '{name}': missing <hypothesis>")
    conns = list(hyp)
    if len(conns) != 1:
        raise ValueError(f"substitution '{name}': hypothesis needs exactly one connective "
                         f"(got {len(conns)})")
    conn = conns[0]
    if conn.tag not in ("and", "atleast"):
        raise ValueError(f"substitution '{name}': hypothesis connective '{conn.tag}' unsupported "
                         "(coherent and/atleast only; xor/not/or 属非相干或嵌套,拒收)")
    if conn.tag == "atleast" and conn.attrib.get("min") != "2":
        raise ValueError(f"substitution '{name}': atleast min must be 2 "
                         f"(got {conn.attrib.get('min')!r}; min≠2 属 k-of-n 表决,非替换语义)")
    hyp_events = []
    for c in list(conn):
        if c.tag != "basic-event":                   # 嵌套 formula / house / gate → 拒
            raise ValueError(f"substitution '{name}': hypothesis must contain only basic-events "
                             f"(found '{c.tag}' — 嵌套 hypothesis 或含 house/gate)")
        hyp_events.append(c.attrib["name"])

    src_el = sub.find("source")
    sources = []
    if src_el is not None:
        for c in list(src_el):
            if c.tag != "basic-event":
                raise ValueError(f"substitution '{name}': <source> must be basic-events")
            sources.append(c.attrib["name"])
        if len(sources) != 1:                        # 多 source = 替换型 recovery(v2)
            raise ValueError(f"substitution '{name}': exactly one source supported "
                             f"(got {len(sources)}; 多 source 替换型 recovery 属 v2)")

    tgt = sub.find("target")
    if tgt is None or len(list(tgt)) != 1:
        raise ValueError(f"substitution '{name}': target needs exactly one child")
    tchild = list(tgt)[0]
    is_const = tchild.tag == "constant"

    def _prob(ev: str, role: str) -> float:
        if ev not in basics:
            raise ValueError(f"substitution '{name}': {role} '{ev}' has no probability in "
                             "model-data (import cannot resolve; model-data 并集规则)")
        return basics[ev]

    if sources:                                      # 非声明式 = exchange
        if is_const:                                 # target=false/true 皆无 source 意义
            raise ValueError(f"substitution '{name}': non-declarative (with <source>) requires a "
                             f"basic-event target, not constant '{tchild.attrib.get('value')}'")
        source = sources[0]
        add_event = tchild.attrib["name"]
        events = sorted(set(hyp_events) - {source})
        return PostRule.from_dict({"kind": "exchange", "events": events, "source": source,
                                   "source_prob": _prob(source, "source"),
                                   "add_event": add_event, "prob": _prob(add_event, "target")})

    if is_const:                                     # 声明式,constant target
        val = (tchild.attrib.get("value") or "").lower()
        if val == "true":
            raise ValueError(f"substitution '{name}': declarative target=true 无效果(拒收)")
        if val != "false":
            raise ValueError(f"substitution '{name}': constant target must be false/true "
                             f"(got {tchild.attrib.get('value')!r})")
        if conn.tag == "atleast" or sub.attrib.get("type") == "delete-terms":
            return PostRule.from_dict({"kind": "mutually_exclusive", "events": sorted(hyp_events)})
        stype = sub.attrib.get("type")
        if stype is not None:
            raise ValueError(f"substitution '{name}': unsupported declarative type '{stype}'")
        return PostRule.from_dict({"kind": "delete_contains", "events": sorted(hyp_events)})

    # 声明式,basic-event target → recovery
    add_event = tchild.attrib["name"]
    return PostRule.from_dict({"kind": "recovery", "events": sorted(hyp_events),
                               "add_event": add_event, "prob": _prob(add_event, "recovery target")})


def load_mef_xml(path: str) -> Model:
    root = ET.parse(path).getroot()
    lib = ParameterLibrary()
    basics: dict[str, float] = {}
    houses: dict[str, bool] = {}
    md = root.find("model-data")
    if md is not None:
        for be in md.findall("define-basic-event"):
            basics[be.attrib["name"]] = float(be.find("float").attrib["value"])
        for he in md.findall("define-house-event"):
            houses[he.attrib["name"]] = (he.find("constant").attrib["value"].lower() == "true")
    # define-CCF-group:members 注册为 <distribution> 概率的基本事件。
    # root.iter:MEF 允许组嵌套在 define-fault-tree/define-component 内(SCRAM 惯用),
    # 只扫根层会静默漏组 → 共因被丢、风险被低估(评审缺陷 #1)
    ccfs: list[CCFGroup] = []
    for cg in root.iter("define-CCF-group"):
        model_name = _CCF_MODEL[cg.attrib["model"]]
        members = [e.attrib["name"] for e in cg.find("members")]
        dist = cg.find("distribution")
        if dist is not None:
            fl_el = dist.find("float")
            if fl_el is None:
                raise ValueError(
                    f"CCF group '{cg.attrib['name']}': only <float> distributions are supported")
            q_t = float(fl_el.attrib["value"])
            for m in members:
                basics.setdefault(m, q_t)
        factors = {}
        fl = cg.find("factors")
        f_elems = fl.findall("factor") if fl is not None else [cg.find("factor")]
        next_level = _base_level(model_name)         # 无 level 属性 → 从模型最小层级顺次分配
        for fe in f_elems:
            if fe is None:
                continue
            level = int(fe.attrib["level"]) if "level" in fe.attrib else next_level
            next_level = level + 1
            factors[_factor_key(model_name, level)] = float(fe.find("float").attrib["value"])
        attrs = cg.find("attributes")
        staggered = any(a.attrib.get("name") == "staggered" and a.attrib.get("value", "").lower() == "true"
                        for a in attrs) if attrs is not None else False
        ccfs.append(CCFGroup(cg.attrib["name"], members, model_name, factors, staggered=staggered))

    for name, val in basics.items():
        lib.add(Parameter(name, "probability", val))

    fts = {}
    for ft in root.findall("define-fault-tree"):
        g = PDAG()
        for name in basics: g.basic(name, param_ref=name)
        for name, st in houses.items(): g.house(name, state=st)
        counter = [0]; gate_ids = []
        for gate in ft.findall("define-gate"):
            gid = gate.attrib["name"]; gate_ids.append(gid)
            body = list(gate)[0]                       # 单一连接词
            op = _OP[body.tag]
            args = [_parse_formula(c, g, gid, counter) for c in list(body)]
            k = int(body.attrib["min"]) if body.tag == "atleast" else None
            g.gate(gid, op, args, k=k)
        referenced = set()                             # 顶门 = 不被任何门引用的 define-gate
        for n in g.nodes.values():
            if n.op is not None: referenced.update(n.args)
        tops = [x for x in gate_ids if x not in referenced]
        g.top = tops[0] if tops else gate_ids[-1]
        g.validate()
        fts[ft.attrib["name"]] = FaultTree(g.top, g)
    # define-substitution → post_rules(7 类响亮拒收在 _parse_substitution 内)
    post_rules = [_parse_substitution(sub, basics)
                  for sub in root.findall("define-substitution")]
    return Model(parameters=lib, fault_trees=fts, ccf_groups=ccfs, post_rules=post_rules)

def save_mef_xml(model: Model, path: str) -> None:
    mef = ET.Element("opsa-mef")
    used_basics = set()
    for name, ft in model.fault_trees.items():
        dft = ET.SubElement(mef, "define-fault-tree", name=name)
        for nid, n in ft.pdag.nodes.items():
            if n.op is None or n.op is Op.NULL:        # 跳过叶子与 NULL 透传
                continue
            dg = ET.SubElement(dft, "define-gate", name=nid)
            conn = ET.SubElement(dg, _OP_REV[n.op])
            if n.op is Op.ATLEAST: conn.set("min", str(n.k))
            for a in n.args:
                child = ft.pdag.nodes[a]
                tag = "basic-event" if child.is_basic else ("house-event" if child.is_house else "gate")
                ET.SubElement(conn, tag, name=a)
                if child.is_basic: used_basics.add(a)
    # define-CCF-group(distribution = 首成员 Q_t;factor level 映射见 _factor_key)
    ccf_members = set()
    for grp in getattr(model, "ccf_groups", None) or []:
        cg = ET.SubElement(mef, "define-CCF-group", name=grp.id, model=_CCF_MODEL_REV[grp.model])
        if getattr(grp, "staggered", False):         # MEF 无原生错峰语义:经通用 attributes 无损往返
            attrs = ET.SubElement(cg, "attributes")
            ET.SubElement(attrs, "attribute", name="staggered", value="true")
        mem = ET.SubElement(cg, "members")
        for m in grp.members:
            ET.SubElement(mem, "basic-event", name=m)
            ccf_members.add(m)
        if grp.members and grp.members[0] in model.parameters:
            dist = ET.SubElement(cg, "distribution")
            m0 = grp.members[0]
            ET.SubElement(dist, "float", value=str(_mef_unavailability(model.parameters.get(m0), m0)))
        fl = ET.SubElement(cg, "factors")
        for key, val in sorted(grp.factors.items(), key=lambda kv: _factor_level(grp.model, kv[0])):
            fe = ET.SubElement(fl, "factor", level=str(_factor_level(grp.model, key)))
            ET.SubElement(fe, "float", value=str(val))
    # define-substitution(post_rules ↔ MEF;规格 §3:fault-tree 之后、model-data 之前)
    sub_extra: dict[str, float] = {}                 # 替换引用的树外基本事件(model-data 并集规则)
    for i, r in enumerate(getattr(model, "post_rules", None) or []):
        _emit_substitution(mef, r, i, sub_extra)
    md = ET.SubElement(mef, "model-data")
    for b in sorted(used_basics - ccf_members):     # CCF 成员的 Q_t 已在组 distribution 中
        if b in model.parameters:
            be = ET.SubElement(md, "define-basic-event", name=b)
            ET.SubElement(be, "float", value=str(_mef_unavailability(model.parameters.get(b), b)))
    for name in sorted(sub_extra):                   # 树外的替换基本事件:并集规则写入 float
        if name in used_basics or name in ccf_members:
            continue                                 # 已在树内/CCF distribution 写过,勿重复
        be = ET.SubElement(md, "define-basic-event", name=name)
        ET.SubElement(be, "float", value=str(sub_extra[name]))
    ET.indent(mef)
    ET.ElementTree(mef).write(path, encoding="utf-8", xml_declaration=True)
