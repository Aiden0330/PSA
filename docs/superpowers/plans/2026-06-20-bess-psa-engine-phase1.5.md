# BESS PSA 引擎 Phase 1.5 Implementation Plan

> **For agentic workers:** Execute task-by-task with TDD. Each task: 写失败测试 → 确认失败 → 实现 → 确认通过 → 提交。Steps use `- [ ]`.

**Goal:** 把 Phase 1 引擎补齐到对标 SCRAM 的能力:Open-PSA MEF XML 互操作、独立 MOCUS 路径、截断误差估计、Dutuit-Rauzy 模块化、非相干素蕴涵。

**Architecture:** 在现有 `psaengine/` 上增量添加,不改动已验证的 BDD/概率内核;每个新特性与 BDD 路径交叉验证(MOCUS 割集 == BDD 割集;模块化概率 == 直接概率)。

**Tech Stack:** Python 3.12,stdlib `xml.etree.ElementTree`(MEF XML,零新依赖),numpy。

**Builds on:** `docs/superpowers/plans/2026-06-20-bess-psa-engine.md`(Phase 1, 已完成)。

---

## File Structure

```
psaengine/
  model/mef_xml.py          # Open-PSA MEF XML 读写
  quantify/mocus.py         # 自顶向下 MOCUS 割集
  quantify/truncation.py    # 截断误差估计 ΔP_k
  quantify/prime_implicants.py  # 非相干素蕴涵(Coudert-Madre 递归)
  preprocess/modules.py     # Dutuit-Rauzy 模块探测 + 模块化定量
  analysis.py               # (修改) 暴露 mocus / modules / prime_implicants / mef
  cli.py                    # (修改) --format mef 选项
tests/
  unit/test_mef_xml.py · unit/test_mocus.py · unit/test_truncation.py
  unit/test_modules.py · analytical/test_prime_implicants.py
```

---

## Task 22: Open-PSA MEF XML 读写

**Files:** Create `psaengine/model/mef_xml.py`; Test `tests/unit/test_mef_xml.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_mef_xml.py
import pytest
from psaengine.model.mef_xml import load_mef_xml, save_mef_xml
from psaengine.analysis import Analysis

MEF = """<?xml version="1.0"?>
<opsa-mef>
  <define-fault-tree name="FT">
    <define-gate name="TOP"><or>
      <basic-event name="A"/><basic-event name="B"/>
    </or></define-gate>
  </define-fault-tree>
  <model-data>
    <define-basic-event name="A"><float value="0.1"/></define-basic-event>
    <define-basic-event name="B"><float value="0.2"/></define-basic-event>
  </model-data>
</opsa-mef>"""

def test_parse_and_quantify(tmp_path):
    p = tmp_path / "m.xml"; p.write_text(MEF)
    model = load_mef_xml(str(p))
    an = Analysis(model, fault_tree="FT")
    assert an.probability(method="exact") == pytest.approx(1 - 0.9*0.8)

def test_round_trip(tmp_path):
    p = tmp_path / "m.xml"; p.write_text(MEF)
    model = load_mef_xml(str(p))
    out = tmp_path / "out.xml"; save_mef_xml(model, str(out))
    model2 = load_mef_xml(str(out))
    an = Analysis(model2, fault_tree="FT")
    assert an.probability() == pytest.approx(0.28)

def test_atleast_parsed(tmp_path):
    mef = '''<opsa-mef><define-fault-tree name="F">
      <define-gate name="T"><atleast min="2">
        <basic-event name="A"/><basic-event name="B"/><basic-event name="C"/>
      </atleast></define-gate></define-fault-tree>
      <model-data>
        <define-basic-event name="A"><float value="0.3"/></define-basic-event>
        <define-basic-event name="B"><float value="0.3"/></define-basic-event>
        <define-basic-event name="C"><float value="0.3"/></define-basic-event>
      </model-data></opsa-mef>'''
    p = tmp_path / "v.xml"; p.write_text(mef)
    an = Analysis(load_mef_xml(str(p)), fault_tree="F")
    assert an.probability() == pytest.approx(0.216)
```

- [ ] **Step 2: 确认失败** — Run `pytest tests/unit/test_mef_xml.py -q` → ModuleNotFoundError

- [ ] **Step 3: 实现**

```python
# psaengine/model/mef_xml.py
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
    md = root.find("model-data")
    basics: dict[str, float] = {}
    houses: dict[str, bool] = {}
    if md is not None:
        for be in md.findall("define-basic-event"):
            fv = be.find("float")
            basics[be.attrib["name"]] = float(fv.attrib["value"])
        for he in md.findall("define-house-event"):
            c = he.find("constant")
            houses[he.attrib["name"]] = (c.attrib["value"].lower() == "true")
    for name, val in basics.items():
        lib.add(Parameter(name, "probability", val))
    fts = {}
    for ft in root.findall("define-fault-tree"):
        g = PDAG()
        for name, val in basics.items():
            g.basic(name, param_ref=name)
        for name, st in houses.items():
            g.house(name, state=st)
        counter = [0]; top = None
        for gate in ft.findall("define-gate"):
            gid = gate.attrib["name"]
            body = list(gate)[0]                       # 单一连接词
            op = _OP[body.tag]
            args = [_parse_formula(c, g, gid, counter) for c in list(body)]
            k = int(body.attrib["min"]) if body.tag == "atleast" else None
            g.gate(gid, op, args, k=k); top = gid
        g.top = top
        # 仅保留被引用到的 basic（裁剪未用）— 简化: 保留全部, validate 容忍
        g.validate()
        fts[ft.attrib["name"]] = FaultTree(top, g)
    return Model(parameters=lib, fault_trees=fts)

def save_mef_xml(model: Model, path: str) -> None:
    mef = ET.Element("opsa-mef")
    used_basics, used_houses = set(), set()
    for name, ft in model.fault_trees.items():
        dft = ET.SubElement(mef, "define-fault-tree", name=name)
        for nid, n in ft.pdag.nodes.items():
            if n.op is None or n.op is Op.NULL:
                if n.is_basic: used_basics.add(nid)
                if n.is_house: used_houses.add(nid)
                continue
            dg = ET.SubElement(dft, "define-gate", name=nid)
            conn = ET.SubElement(dg, _OP_REV[n.op])
            if n.op is Op.ATLEAST: conn.set("min", str(n.k))
            for a in n.args:
                child = ft.pdag.nodes[a]
                tag = "basic-event" if child.is_basic else ("house-event" if child.is_house else "gate")
                ET.SubElement(conn, tag, name=a)
                if child.is_basic: used_basics.add(a)
                if child.is_house: used_houses.add(a)
    md = ET.SubElement(mef, "model-data")
    for b in sorted(used_basics):
        if b in model.parameters:
            be = ET.SubElement(md, "define-basic-event", name=b)
            ET.SubElement(be, "float", value=str(model.parameters.get(b).unavailability()))
    ET.indent(mef)
    ET.ElementTree(mef).write(path, encoding="utf-8", xml_declaration=True)
```

- [ ] **Step 4: 确认通过** — Run `pytest tests/unit/test_mef_xml.py -q` → 3 passed

- [ ] **Step 5: 提交** — `git add psaengine/model/mef_xml.py tests/unit/test_mef_xml.py && git commit`

---

## Task 23: 独立 MOCUS 割集(自顶向下)

**Files:** Create `psaengine/quantify/mocus.py`; Test `tests/unit/test_mocus.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_mocus.py
from psaengine.model.pdag import PDAG, Op
from psaengine.quantify.mocus import mocus_cutsets
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.ordering.heuristics import dflm
from psaengine.quantify.cutsets import minimal_cutsets

def test_mocus_2oo3_matches_bdd():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.ATLEAST, ["A","B","C"], k=2); g.top="TOP"
    mc = sorted(sorted(c) for c in mocus_cutsets(g, "TOP"))
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    bd = sorted(sorted(c.events) for c in minimal_cutsets(m, root))
    assert mc == bd == [["A","B"],["A","C"],["B","C"]]

def test_mocus_and_of_or():
    g = PDAG()
    for b in "ABCD": g.basic(b)
    g.gate("L", Op.OR, ["A","B"]); g.gate("R", Op.OR, ["C","D"])
    g.gate("TOP", Op.AND, ["L","R"]); g.top="TOP"
    mc = sorted(sorted(c) for c in mocus_cutsets(g, "TOP"))
    assert mc == [["A","C"],["A","D"],["B","C"],["B","D"]]

def test_mocus_absorption():
    g = PDAG()
    for b in "AB": g.basic(b)
    g.gate("SUB", Op.AND, ["A","B"]); g.gate("TOP", Op.OR, ["A","SUB"]); g.top="TOP"
    # A + A·B = A
    assert sorted(sorted(c) for c in mocus_cutsets(g, "TOP")) == [["A"]]
```

- [ ] **Step 2: 确认失败** — Run `pytest tests/unit/test_mocus.py -q`

- [ ] **Step 3: 实现**

```python
# psaengine/quantify/mocus.py
from __future__ import annotations
from itertools import combinations
from psaengine.model.pdag import PDAG, Op

def mocus_cutsets(g: PDAG, root: str, limit_order: int | None = None) -> list[set[str]]:
    """自顶向下 MOCUS: OR 增行, AND 扩列; 展开至全为基本事件后吸收最小化。"""
    rows: list[set[str]] = [{root}]          # 每行=候选割集(可含门)
    def is_gate(x): return g.nodes[x].op not in (None, Op.NULL) or \
                           (g.nodes[x].op is Op.NULL and not g.nodes[x].is_basic)
    changed = True
    while changed:
        changed = False
        new_rows: list[set[str]] = []
        for row in rows:
            gate = next((x for x in row if _expandable(g, x)), None)
            if gate is None:
                new_rows.append(row); continue
            changed = True
            rest = row - {gate}
            for expansion in _expand(g, gate):
                nr = rest | expansion
                if limit_order is None or len(nr) <= limit_order:
                    new_rows.append(nr)
        rows = new_rows
    # 去重 + 吸收
    uniq = {frozenset(r) for r in rows}
    minimal = []
    for s in sorted(uniq, key=len):
        if not any(m <= s for m in minimal):
            minimal.append(s)
    return [set(s) for s in minimal]

def _expandable(g: PDAG, x: str) -> bool:
    n = g.nodes[x]
    if n.is_basic or n.is_house: return False
    if n.op is Op.NULL: return n.state is None   # 透传 NULL 可展开
    return True

def _expand(g: PDAG, gate: str) -> list[set[str]]:
    """返回该门展开后的若干 '列集合'(OR→多个单元素方案;AND→一个合并方案)。"""
    n = g.nodes[gate]
    if n.op is Op.NULL:
        return [{n.args[0]}]
    if n.op is Op.OR:
        return [{a} for a in n.args]
    if n.op is Op.AND:
        return [set(n.args)]
    if n.op is Op.ATLEAST:
        return [set(c) for c in combinations(n.args, n.k)]
    raise ValueError(f"MOCUS 不支持(非相干请用 prime_implicants): {n.op}")
```

- [ ] **Step 4: 确认通过** — `pytest tests/unit/test_mocus.py -q` → 3 passed

- [ ] **Step 5: 提交**

---

## Task 24: 截断误差估计(ΔP_k 收敛)

**Files:** Create `psaengine/quantify/truncation.py`; Test `tests/unit/test_truncation.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_truncation.py
import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.truncation import truncation_study

def test_truncation_converges():
    # OR(A,B,C) q 递减, 越小割集贡献越小
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.OR, ["A","B","C"]); g.top="TOP"
    q = {"A":0.1, "B":1e-3, "C":1e-6}
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    rows = truncation_study(m, root, q, cutoffs=[1e-2, 1e-4, 1e-7])
    # cutoff 越小, 截断概率单调不减, 趋于收敛
    probs = [r["probability"] for r in rows]
    assert probs[0] <= probs[1] <= probs[2]
    assert rows[-1]["delta"] < rows[0]["delta"]      # 误差缩小
```

- [ ] **Step 2: 确认失败**

- [ ] **Step 3: 实现**

```python
# psaengine/quantify/truncation.py
from __future__ import annotations
from psaengine.bdd.kernel import BddManager
from psaengine.quantify.cutsets import minimal_cutsets
from psaengine.quantify.probability import mcub

def truncation_study(m: BddManager, root: int, q: dict[str, float],
                     cutoffs: list[float]) -> list[dict]:
    """对一组(降序)截断限算截断概率与相邻差 ΔP_k(Jung 收敛监控)。"""
    rows = []
    prev = 0.0
    for c in sorted(cutoffs, reverse=True):
        cs = minimal_cutsets(m, root, q=q, cutoff=c)
        p = mcub([x.probability for x in cs])
        rows.append({"cutoff": c, "n_cutsets": len(cs), "probability": p,
                     "delta": abs(p - prev)})
        prev = p
    return rows
```

- [ ] **Step 4: 确认通过**

- [ ] **Step 5: 提交**

---

## Task 25: Dutuit-Rauzy 模块探测 + 模块化定量

**Files:** Create `psaengine/preprocess/modules.py`; Test `tests/unit/test_modules.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_modules.py
import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.preprocess.modules import find_modules, modular_probability
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability

def _tree():
    g = PDAG()
    for b in ["A","B","X"]: g.basic(b)
    g.gate("M", Op.OR, ["A","B"])          # 独立模块(A,B 仅属 M)
    g.gate("TOP", Op.AND, ["M","X"]); g.top="TOP"
    return g

def test_find_independent_module():
    g = _tree()
    assert "M" in find_modules(g, "TOP")

def test_shared_event_not_module():
    g = PDAG()
    for b in ["A","B"]: g.basic(b)
    g.gate("M", Op.OR, ["A","B"]); g.gate("TOP", Op.AND, ["M","A"]); g.top="TOP"  # A 共享
    assert "M" not in find_modules(g, "TOP")

def test_modular_probability_equals_direct():
    g = _tree(); q = {"A":0.1,"B":0.2,"X":0.3}
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    direct = exact_probability(m, root, q)
    assert modular_probability(g, "TOP", q) == pytest.approx(direct)
```

- [ ] **Step 2: 确认失败**

- [ ] **Step 3: 实现**

```python
# psaengine/preprocess/modules.py
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
        if nid == root or n.op in (None,) or n.is_basic or n.is_house:
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

def modular_probability(g: PDAG, root: str, q: dict[str, float]) -> float:
    """对极大独立模块分治求精确概率, 再代入约简树求顶值(== 直接 BDD)。"""
    from psaengine.bdd.kernel import BddManager, build_from_pdag
    from psaengine.ordering.heuristics import dflm
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

def dflm_rooted(g: PDAG, root: str) -> list[str]:
    order, seen = [], set()
    def dfs(nid):
        n = g.nodes[nid]
        if n.is_basic:
            if nid not in seen: seen.add(nid); order.append(nid)
            return
        for a in n.args: dfs(a)
    dfs(root); return order
```

- [ ] **Step 4: 确认通过**

- [ ] **Step 5: 提交**

---

## Task 26: 非相干素蕴涵(Coudert-Madre 递归)

**Files:** Create `psaengine/quantify/prime_implicants.py`; Test `tests/analytical/test_prime_implicants.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/analytical/test_prime_implicants.py
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.prime_implicants import prime_implicants

def _pi_set(m, root):
    return {frozenset(pi.items()) for pi in prime_implicants(m, root)}

def test_and_not():
    # f = A AND NOT B  →  唯一素蕴涵 {+A, -B}
    g = PDAG(); g.basic("A"); g.basic("B")
    g.gate("nB", Op.NOT, ["B"]); g.gate("TOP", Op.AND, ["A","nB"]); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    assert _pi_set(m, root) == {frozenset({("A",True),("B",False)})}

def test_consensus_term():
    # f = (A AND NOT B) OR (NOT A AND C); 素蕴涵含 consensus {-B,+C}
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("nB", Op.NOT, ["B"]); g.gate("nA", Op.NOT, ["A"])
    g.gate("L", Op.AND, ["A","nB"]); g.gate("R", Op.AND, ["nA","C"])
    g.gate("TOP", Op.OR, ["L","R"]); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    pis = _pi_set(m, root)
    assert frozenset({("A",True),("B",False)}) in pis
    assert frozenset({("A",False),("C",True)}) in pis
    assert frozenset({("B",False),("C",True)}) in pis   # consensus
```

- [ ] **Step 2: 确认失败**

- [ ] **Step 3: 实现**

```python
# psaengine/quantify/prime_implicants.py
from __future__ import annotations
from psaengine.bdd.kernel import BddManager

def prime_implicants(m: BddManager, root: int) -> list[dict[str, bool]]:
    """Coudert-Madre/Morreale 递归素蕴涵:
       PI(f) = PI(f0·f1) ∪ {x·c : c∈PI(f1)\\Pc} ∪ {¬x·c : c∈PI(f0)\\Pc}。
       返回 [{var: True/False(取值)}], True=正文字, False=负文字。"""
    memo: dict[int, list[frozenset]] = {}
    def pi(h: int) -> list[frozenset]:
        if h == m.ZERO: return []
        if h == m.ONE: return [frozenset()]
        if h in memo: return memo[h]
        v, hi, lo = m._nodes[h]; name = m.var_order[v]
        cons = m.apply_and(hi, lo)               # f0 ∧ f1: 不依赖 x 的部分
        Pc = pi(cons); Pc_set = set(Pc)
        result = list(Pc)
        for c in pi(hi):
            if c not in Pc_set: result.append(c | {(name, True)})
        for c in pi(lo):
            if c not in Pc_set: result.append(c | {(name, False)})
        memo[h] = result; return result
    return [dict(s) for s in pi(root)]
```

- [ ] **Step 4: 确认通过** — `pytest tests/analytical/test_prime_implicants.py -q` → 2 passed

- [ ] **Step 5: 提交**

---

## Task 27: 接入 Analysis / CLI + 全量回归

**Files:** Modify `psaengine/analysis.py`, `psaengine/cli.py`; Test `tests/unit/test_analysis_phase15.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_analysis_phase15.py
import pytest
from psaengine import Model, Analysis

def test_analysis_mocus_matches_bdd():
    m = Model.from_json("examples/tiny_and.json")
    an = Analysis(m, fault_tree="TOP")
    bdd_cs = sorted(sorted(c.events) for c in an.cutsets())
    mocus_cs = sorted(sorted(c) for c in an.mocus_cutsets())
    assert bdd_cs == mocus_cs == [["A","B"]]

def test_analysis_modular_probability():
    m = Model.from_json("examples/tiny_and.json")
    an = Analysis(m, fault_tree="TOP")
    assert an.modular_probability() == pytest.approx(an.probability())
```

- [ ] **Step 2: 确认失败**

- [ ] **Step 3: 实现** — 在 `Analysis` 增加方法:

```python
    def mocus_cutsets(self, limit_order=None):
        from psaengine.quantify.mocus import mocus_cutsets
        return mocus_cutsets(self.pdag, self.pdag.top, limit_order=limit_order)

    def modular_probability(self):
        from psaengine.preprocess.modules import modular_probability
        return modular_probability(self.pdag, self.pdag.top, self.q)

    def prime_implicants(self):
        from psaengine.quantify.prime_implicants import prime_implicants
        return prime_implicants(self.m, self.root)

    def truncation_study(self, cutoffs):
        from psaengine.quantify.truncation import truncation_study
        return truncation_study(self.m, self.root, self.q, cutoffs)
```

CLI `quantify` 增加 `--format {json,mef}`:加载时按扩展名或 flag 选 `load_model`/`load_mef_xml`。

- [ ] **Step 4: 确认通过 + 全量回归** — `pytest -q`(应在 Phase 1 的 62 之上新增约 14,全绿)

- [ ] **Step 5: 提交**

---

## Self-Review
- Spec §13 五项全覆盖:MEF XML(T22)、MOCUS(T23)、截断误差(T24)、模块化(T25)、素蕴涵(T26)。
- 交叉验证内建:MOCUS 割集 == BDD 割集(T23/T27);模块化概率 == 直接概率(T25/T27);素蕴涵对 consensus 用例验证(T26)。
- 无占位符;类型/签名与 Phase 1 一致(BddManager/`_nodes`/exact_probability 复用)。
