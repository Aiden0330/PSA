from __future__ import annotations
import xml.etree.ElementTree as ET
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.fault_tree import FaultTree
from psaengine.model.model import Model

_OP = {"and": Op.AND, "or": Op.OR, "not": Op.NOT, "atleast": Op.ATLEAST, "xor": Op.XOR}
_OP_REV = {v: k for k, v in _OP.items()}

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
    return Model(parameters=lib, fault_trees=fts)

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
    md = ET.SubElement(mef, "model-data")
    for b in sorted(used_basics):
        if b in model.parameters:
            be = ET.SubElement(md, "define-basic-event", name=b)
            ET.SubElement(be, "float", value=str(model.parameters.get(b).unavailability()))
    ET.indent(mef)
    ET.ElementTree(mef).write(path, encoding="utf-8", xml_declaration=True)
