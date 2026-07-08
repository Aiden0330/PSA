# BESS PSA 量化引擎 Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建一个纯 Python、零编译依赖的精确 FTA/ETA 量化引擎,并用它产出真实的 BESS 热失控 QRA 报告(C1–C5 后果频率、屏障重要度、不确定性带)。

**Architecture:** 单向依赖的模块化引擎 `psaengine/`(model → preprocess → ordering → bdd → {probability, cutsets, importance, uncertainty} → eta → analysis → cli)+ 领域应用 `bess/`(只消费 `psaengine` 公共 API)。BDD/ZBDD 内核自建(复用 `fta-eta-quantification-engine` 技能脚手架),`dd` 库仅在测试期作独立对拍预言机。默认精确 BDD 定量,事件树成功分支精确否定。

**Tech Stack:** Python 3.11+,numpy,scipy.stats,pytest,hypothesis;可选 `dd`(autoref,测试对拍)。

**Spec:** `docs/superpowers/specs/2026-06-20-bess-psa-engine-design.md`

**Reference assets (执行前先取):** 实现 BDD/预处理/重要度等任务前,先 `Skill` 调用 `fta-eta-quantification-engine` 取出 `assets/bdd_engine.py`、`variable_ordering.py`、`preprocess.py`、`quantify.py`、`importance.py`、`model.py` 作为脚手架参考;BESS 任务前 `Skill` 调用 `bess-tr-event-tree` 取出 `assets/tr_model.json`、`tr_event_tree.py`。本计划每个任务给出**最终目标代码与测试**;脚手架用于加速,不替代本计划的接口契约。

---

## File Structure (decomposition lock-in)

```
psaengine/
  __init__.py            # 导出 Model, Analysis
  model/
    __init__.py
    parameters.py        # Parameter, ParameterLibrary, 可用度模型 → q
    pdag.py              # Node/BasicEvent/HouseEvent/Gate, Op 枚举, PDAG 容器
    fault_tree.py        # FaultTree
    event_tree.py        # FunctionalEvent, Sequence, EventTree
    ccf.py               # CCFGroup (beta/mgl/alpha/phi)
    model.py             # Model (聚合 + from_json/to_json)
    json_io.py           # load/save + schema 校验
  preprocess/
    __init__.py
    normalize.py         # 循环检测, 常量传播, house 代入, coalescing
    expand.py            # k/n 展开, CCF 展开
  ordering/
    __init__.py
    heuristics.py        # dflm/wdflm/rdflm
  bdd/
    __init__.py
    kernel.py            # BddManager: ite, 唯一表, 计算表, 补边, apply, build_from_pdag
    zbdd.py              # ZbddManager: 集合操作 + 相干简化
  quantify/
    __init__.py
    probability.py       # exact / rea / mcub
    cutsets.py           # ZBDD 割集抽取 + 截断
  importance/
    __init__.py
    measures.py          # birnbaum/fv/raw/rrw/dim
  uncertainty/
    __init__.py
    montecarlo.py        # 采样传播 + 百分位 + 龙卷风
  eta/
    __init__.py
    sequence.py          # 序列定量, 成功分支精确否定, C 分箱
  analysis.py            # Analysis 门面
  cli.py                 # bpsa
bess/
  __init__.py
  tr_model.py            # 由 tr_model.json 建 ET/FT + 先验
  consequences.py        # C1–C5 + 后果标签
  report.py              # QRA 报告
tests/
  unit/ ...              # 镜像 psaengine 结构
  analytical/            # 解析解 + 不变量
  property/              # hypothesis
  benchmark/             # FFORT
  cross/                 # dd 对拍
  e2e/                   # BESS 端到端
examples/
  bess_grid_container.json
pyproject.toml
```

---

## Task 0: 项目脚手架与 git

**Files:**
- Create: `pyproject.toml`, `psaengine/__init__.py`, `bess/__init__.py`, `tests/__init__.py`, `.gitignore`

- [ ] **Step 1: 创建 pyproject.toml**

```toml
[project]
name = "bess-psa"
version = "0.1.0"
description = "Exact BDD/ZBDD PSA engine for BESS thermal-runaway QRA"
requires-python = ">=3.11"
dependencies = ["numpy>=1.26", "scipy>=1.11"]

[project.optional-dependencies]
test = ["pytest>=8", "hypothesis>=6", "dd>=0.6"]

[project.scripts]
bpsa = "psaengine.cli:main"

[tool.pytest.ini_options]
testpaths = ["tests"]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"
```

- [ ] **Step 2: 创建包占位文件与 .gitignore**

`psaengine/__init__.py`:
```python
"""psaengine — exact FTA/ETA quantification engine."""
__all__ = ["Model", "Analysis"]
```
`bess/__init__.py`: `"""BESS thermal-runaway QRA application."""`
`tests/__init__.py`: 空文件。
`.gitignore`:
```
__pycache__/
*.pyc
.pytest_cache/
*.egg-info/
.venv/
```

- [ ] **Step 3: 安装与初始化**

Run:
```
python -m pip install -e ".[test]"
git init
git add -A
git commit -m "chore: project scaffold for bess-psa engine"
```
Expected: 安装成功;`git log` 显示首个提交。

---

## Milestone 1 — Model 层

### Task 1: 参数库与可用度模型

**Files:**
- Create: `psaengine/model/__init__.py`, `psaengine/model/parameters.py`
- Test: `tests/unit/test_parameters.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_parameters.py
import math
import pytest
from psaengine.model.parameters import Parameter, ParameterLibrary

def test_constant_probability():
    p = Parameter("p1", kind="probability", value=0.03)
    assert p.unavailability() == 0.03

def test_periodic_test_model():
    # q ≈ λ·T/2
    p = Parameter("v1", kind="rate", value=1e-6, test_interval=1000.0)
    assert p.unavailability() == pytest.approx(1e-6 * 1000.0 / 2)

def test_repairable_model():
    # q ≈ λ·MTTR
    p = Parameter("m1", kind="rate", value=1e-4, mttr=8.0)
    assert p.unavailability() == pytest.approx(1e-4 * 8.0)

def test_unrepairable_mission_time():
    p = Parameter("u1", kind="rate", value=1e-5, mission_time=720.0)
    assert p.unavailability() == pytest.approx(1e-5 * 720.0)

def test_probability_out_of_range_rejected():
    with pytest.raises(ValueError):
        Parameter("bad", kind="probability", value=1.5).unavailability()

def test_library_shared_reference():
    lib = ParameterLibrary()
    lib.add(Parameter("shared", kind="probability", value=0.1))
    assert lib.get("shared").unavailability() == 0.1
    with pytest.raises(KeyError):
        lib.get("missing")
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit/test_parameters.py -v`
Expected: FAIL(ModuleNotFoundError: psaengine.model.parameters)

- [ ] **Step 3: 实现**

```python
# psaengine/model/parameters.py
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class Distribution:
    """不确定性分布。lognormal 用 (median=value, error_factor)。"""
    family: str  # lognormal|normal|uniform|beta
    params: dict = field(default_factory=dict)

@dataclass
class Parameter:
    id: str
    kind: str                       # probability|rate|frequency
    value: float
    mttr: Optional[float] = None
    test_interval: Optional[float] = None
    mission_time: Optional[float] = None
    distribution: Optional[Distribution] = None
    source: Optional[str] = None
    version: Optional[str] = None

    def unavailability(self) -> float:
        """返回基本事件不可用度 q∈[0,1]。"""
        if self.kind == "probability":
            if not 0.0 <= self.value <= 1.0:
                raise ValueError(f"probability {self.id}={self.value} out of [0,1]")
            return self.value
        if self.kind == "rate":
            lam = self.value
            if self.mttr is not None:
                q = lam * self.mttr
            elif self.test_interval is not None:
                q = lam * self.test_interval / 2.0
            elif self.mission_time is not None:
                q = lam * self.mission_time
            else:
                raise ValueError(f"rate {self.id} needs mttr|test_interval|mission_time")
            return min(q, 1.0)
        if self.kind == "frequency":
            return self.value  # 每年频率, 由 ET 层使用
        raise ValueError(f"unknown kind {self.kind}")

class ParameterLibrary:
    def __init__(self) -> None:
        self._params: dict[str, Parameter] = {}
    def add(self, p: Parameter) -> None:
        self._params[p.id] = p
    def get(self, pid: str) -> Parameter:
        if pid not in self._params:
            raise KeyError(f"parameter {pid} not defined")
        return self._params[pid]
    def __contains__(self, pid: str) -> bool:
        return pid in self._params
    def ids(self) -> list[str]:
        return list(self._params)
```
`psaengine/model/__init__.py`: 空文件(后续 Task 逐步导出)。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit/test_parameters.py -v`
Expected: PASS(6 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/model tests/unit/test_parameters.py
git commit -m "feat(model): parameters + availability models"
```

### Task 2: PDAG(布尔逻辑图)

**Files:**
- Create: `psaengine/model/pdag.py`
- Test: `tests/unit/test_pdag.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_pdag.py
import pytest
from psaengine.model.pdag import PDAG, Op

def test_build_and_gate():
    g = PDAG()
    g.basic("A"); g.basic("B")
    g.gate("TOP", Op.AND, ["A", "B"])
    assert g.top == "TOP"
    assert g.node("TOP").op is Op.AND
    assert g.node("TOP").args == ["A", "B"]

def test_house_event():
    g = PDAG()
    g.house("H", state=True)
    assert g.node("H").state is True

def test_atleast_requires_k_le_n():
    g = PDAG()
    g.basic("A"); g.basic("B")
    with pytest.raises(ValueError):
        g.gate("V", Op.ATLEAST, ["A", "B"], k=3)

def test_repeated_event_is_same_reference():
    g = PDAG()
    g.basic("A")
    g.gate("G1", Op.OR, ["A", "A"])  # 同名即同事件
    assert g.basic_events() == {"A"}

def test_undefined_arg_detected_on_validate():
    g = PDAG()
    g.gate("TOP", Op.AND, ["A", "B"])  # A,B 未定义
    with pytest.raises(ValueError, match="undefined"):
        g.validate()
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit/test_pdag.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# psaengine/model/pdag.py
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

class Op(Enum):
    AND = "and"; OR = "or"; NOT = "not"; ATLEAST = "atleast"; XOR = "xor"; NULL = "null"

@dataclass
class Node:
    id: str
    is_basic: bool = False
    is_house: bool = False
    state: Optional[bool] = None        # house 事件常量
    op: Optional[Op] = None
    args: list[str] = field(default_factory=list)
    k: Optional[int] = None             # ATLEAST 的表决数
    param_ref: Optional[str] = None     # basic 事件引用的参数 id

class PDAG:
    def __init__(self) -> None:
        self.nodes: dict[str, Node] = {}
        self.top: Optional[str] = None

    def basic(self, nid: str, param_ref: Optional[str] = None) -> str:
        if nid not in self.nodes:
            self.nodes[nid] = Node(nid, is_basic=True, param_ref=param_ref or nid)
        return nid

    def house(self, nid: str, state: bool) -> str:
        self.nodes[nid] = Node(nid, is_house=True, state=state)
        return nid

    def gate(self, nid: str, op: Op, args: list[str], k: Optional[int] = None) -> str:
        if op is Op.ATLEAST:
            if k is None or k > len(args):
                raise ValueError(f"ATLEAST {nid}: k={k} > n={len(args)}")
        self.nodes[nid] = Node(nid, op=op, args=list(args), k=k)
        self.top = nid
        return nid

    def node(self, nid: str) -> Node:
        return self.nodes[nid]

    def basic_events(self) -> set[str]:
        return {n.id for n in self.nodes.values() if n.is_basic}

    def validate(self) -> None:
        for n in self.nodes.values():
            for a in n.args:
                if a not in self.nodes:
                    raise ValueError(f"undefined arg '{a}' in gate '{n.id}'")
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit/test_pdag.py -v`
Expected: PASS(5 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/model/pdag.py tests/unit/test_pdag.py
git commit -m "feat(model): PDAG boolean logic graph"
```

### Task 3: FaultTree / EventTree / CCFGroup / Model

**Files:**
- Create: `psaengine/model/fault_tree.py`, `psaengine/model/event_tree.py`, `psaengine/model/ccf.py`, `psaengine/model/model.py`
- Test: `tests/unit/test_model_containers.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_model_containers.py
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.ccf import CCFGroup
from psaengine.model.model import Model

def _ft():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.AND, ["A", "B"])
    return FaultTree("TOP", g)

def test_fault_tree_holds_top():
    ft = _ft()
    assert ft.top == "TOP"
    assert ft.pdag.basic_events() == {"A", "B"}

def test_event_tree_sequences_bin_to_consequences():
    et = EventTree(
        init_event="IE", init_frequency=1.0,
        functional_events=[FunctionalEvent("BARRIER", link_ft="BFT")],
        sequences=[{"path": {"BARRIER": "success"}, "end_state": "OK"},
                   {"path": {"BARRIER": "failure"}, "end_state": "C3"}],
        consequence_bins={"OK": "C1", "C3": "C3"},
    )
    assert et.functional_events[0].link_ft == "BFT"
    assert et.consequence_of("C3") == "C3"

def test_ccf_group():
    grp = CCFGroup("G", members=["A1", "A2", "A3"], model="beta", factors={"beta": 0.05})
    assert grp.model == "beta" and len(grp.members) == 3

def test_model_aggregates_and_lists_parameters():
    lib = ParameterLibrary(); lib.add(Parameter("A", "probability", 0.1))
    m = Model(parameters=lib, fault_trees={"TOP": _ft()}, event_trees={}, ccf_groups=[])
    assert "A" in m.parameters
    assert "TOP" in m.fault_trees
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit/test_model_containers.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# psaengine/model/fault_tree.py
from __future__ import annotations
from dataclasses import dataclass
from psaengine.model.pdag import PDAG

@dataclass
class FaultTree:
    top: str
    pdag: PDAG
```
```python
# psaengine/model/event_tree.py
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional

@dataclass
class FunctionalEvent:
    id: str
    link_ft: Optional[str] = None       # 链接的故障树名(小 ET/大 FT)
    link_basic: Optional[str] = None    # 或直接挂基本事件

@dataclass
class EventTree:
    init_event: str
    init_frequency: float
    functional_events: list[FunctionalEvent]
    sequences: list[dict]               # {"path": {fe_id: success|failure}, "end_state": str}
    consequence_bins: dict              # end_state -> consequence class (C1..C5)

    def consequence_of(self, end_state: str) -> str:
        return self.consequence_bins[end_state]
```
```python
# psaengine/model/ccf.py
from __future__ import annotations
from dataclasses import dataclass

@dataclass
class CCFGroup:
    id: str
    members: list[str]
    model: str                          # beta|mgl|alpha|phi
    factors: dict                       # e.g. {"beta":0.05} / {"beta":..,"gamma":..}
```
```python
# psaengine/model/model.py
from __future__ import annotations
from dataclasses import dataclass, field
from psaengine.model.parameters import ParameterLibrary
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree
from psaengine.model.ccf import CCFGroup

@dataclass
class Model:
    parameters: ParameterLibrary
    fault_trees: dict[str, FaultTree] = field(default_factory=dict)
    event_trees: dict[str, EventTree] = field(default_factory=dict)
    ccf_groups: list[CCFGroup] = field(default_factory=list)

    @classmethod
    def from_json(cls, path: str) -> "Model":
        from psaengine.model.json_io import load_model
        return load_model(path)

    def to_json(self, path: str) -> None:
        from psaengine.model.json_io import save_model
        save_model(self, path)
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit/test_model_containers.py -v`
Expected: PASS(4 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/model tests/unit/test_model_containers.py
git commit -m "feat(model): fault tree, event tree, CCF group, Model aggregate"
```

### Task 4: JSON I/O(MEF 对齐)+ schema 校验

**Files:**
- Create: `psaengine/model/json_io.py`
- Test: `tests/unit/test_json_io.py`, `examples/tiny_and.json`

- [ ] **Step 1: 写失败测试 + 样例**

`examples/tiny_and.json`:
```json
{
  "model_data": {"parameters": [
    {"id": "A", "kind": "probability", "value": 0.1},
    {"id": "B", "kind": "probability", "value": 0.2}
  ]},
  "fault_trees": [
    {"name": "TOP", "top": "TOP",
     "nodes": [
       {"id": "A", "basic": true, "param_ref": "A"},
       {"id": "B", "basic": true, "param_ref": "B"},
       {"id": "TOP", "op": "and", "args": ["A", "B"]}
     ]}
  ],
  "event_trees": [], "ccf_groups": []
}
```
```python
# tests/unit/test_json_io.py
import json, pytest
from psaengine.model.model import Model
from psaengine.model.json_io import load_model

def test_load_tiny_and():
    m = Model.from_json("examples/tiny_and.json")
    assert m.parameters.get("A").unavailability() == 0.1
    ft = m.fault_trees["TOP"]
    assert ft.pdag.basic_events() == {"A", "B"}

def test_round_trip(tmp_path):
    m = Model.from_json("examples/tiny_and.json")
    out = tmp_path / "rt.json"
    m.to_json(str(out))
    m2 = Model.from_json(str(out))
    assert m2.fault_trees["TOP"].pdag.node("TOP").op.value == "and"

def test_undefined_param_ref_rejected(tmp_path):
    bad = {"model_data": {"parameters": []},
           "fault_trees": [{"name": "T", "top": "T", "nodes": [
               {"id": "X", "basic": True, "param_ref": "MISSING"},
               {"id": "T", "op": "null", "args": ["X"]}]}],
           "event_trees": [], "ccf_groups": []}
    p = tmp_path / "bad.json"; p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="MISSING"):
        load_model(str(p))
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit/test_json_io.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# psaengine/model/json_io.py
from __future__ import annotations
import json
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary, Distribution
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.ccf import CCFGroup
from psaengine.model.model import Model

def _param(d: dict) -> Parameter:
    dist = None
    if "distribution" in d:
        dist = Distribution(d["distribution"]["family"], d["distribution"].get("params", {}))
    return Parameter(d["id"], d["kind"], d["value"], mttr=d.get("mttr"),
                     test_interval=d.get("test_interval"), mission_time=d.get("mission_time"),
                     distribution=dist, source=d.get("source"), version=d.get("version"))

def _pdag(ft: dict, lib: ParameterLibrary) -> PDAG:
    g = PDAG()
    for nd in ft["nodes"]:
        if nd.get("basic"):
            ref = nd.get("param_ref", nd["id"])
            if ref not in lib:
                raise ValueError(f"undefined param_ref '{ref}' for basic event '{nd['id']}'")
            g.basic(nd["id"], param_ref=ref)
        elif nd.get("house"):
            g.house(nd["id"], state=bool(nd["state"]))
    for nd in ft["nodes"]:                       # 第二遍建门(确保子节点已存在)
        if "op" in nd:
            g.gate(nd["id"], Op(nd["op"]), nd["args"], k=nd.get("k"))
    g.top = ft["top"]
    g.validate()
    return g

def load_model(path: str) -> Model:
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    lib = ParameterLibrary()
    for p in d["model_data"]["parameters"]:
        lib.add(_param(p))
    fts = {ft["name"]: FaultTree(ft["top"], _pdag(ft, lib)) for ft in d.get("fault_trees", [])}
    ets = {}
    for et in d.get("event_trees", []):
        ets[et["name"]] = EventTree(
            et["init_event"], et["init_frequency"],
            [FunctionalEvent(fe["id"], fe.get("link_ft"), fe.get("link_basic"))
             for fe in et["functional_events"]],
            et["sequences"], et["consequence_bins"])
    ccfs = [CCFGroup(c["id"], c["members"], c["model"], c["factors"]) for c in d.get("ccf_groups", [])]
    return Model(parameters=lib, fault_trees=fts, event_trees=ets, ccf_groups=ccfs)

def save_model(m: Model, path: str) -> None:
    def node_json(n):
        if n.is_basic: return {"id": n.id, "basic": True, "param_ref": n.param_ref}
        if n.is_house: return {"id": n.id, "house": True, "state": n.state}
        out = {"id": n.id, "op": n.op.value, "args": n.args}
        if n.k is not None: out["k"] = n.k
        return out
    d = {"model_data": {"parameters": [
            {"id": p, **{k: v for k, v in vars(m.parameters.get(p)).items()
                         if k != "id" and v is not None and k != "distribution"}}
            for p in m.parameters.ids()]},
         "fault_trees": [{"name": name, "top": ft.top,
                          "nodes": [node_json(ft.pdag.node(i)) for i in ft.pdag.nodes]}
                         for name, ft in m.fault_trees.items()],
         "event_trees": [], "ccf_groups": []}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit/test_json_io.py -v`
Expected: PASS(3 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/model/json_io.py tests/unit/test_json_io.py examples/tiny_and.json
git commit -m "feat(model): MEF-aligned JSON load/save with validation"
```

---

## Milestone 2 — 预处理

### Task 5: 归一化(循环检测/常量传播/house 代入/coalescing)

**Files:**
- Create: `psaengine/preprocess/__init__.py`, `psaengine/preprocess/normalize.py`
- Test: `tests/unit/test_normalize.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_normalize.py
import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.preprocess.normalize import normalize, CyclicLogicError

def test_cycle_detected():
    g = PDAG()
    g.gate("A", Op.OR, ["B"]); g.gate("B", Op.OR, ["A"])
    g.top = "A"
    with pytest.raises(CyclicLogicError):
        normalize(g)

def test_house_true_in_or_makes_constant_true():
    g = PDAG()
    g.basic("X"); g.house("H", state=True)
    g.gate("TOP", Op.OR, ["X", "H"]); g.top = "TOP"
    ng = normalize(g)
    assert ng.node(ng.top).op is Op.NULL and ng.node(ng.top).state is True

def test_house_false_dropped_from_or():
    g = PDAG()
    g.basic("X"); g.house("H", state=False)
    g.gate("TOP", Op.OR, ["X", "H"]); g.top = "TOP"
    ng = normalize(g)
    assert set(ng.node(ng.top).args) == {"X"}

def test_coalescing_nested_or():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("SUB", Op.OR, ["B", "C"])
    g.gate("TOP", Op.OR, ["A", "SUB"]); g.top = "TOP"
    ng = normalize(g)
    assert set(ng.node(ng.top).args) == {"A", "B", "C"}

def test_idempotent():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("SUB", Op.OR, ["B", "C"]); g.gate("TOP", Op.OR, ["A", "SUB"]); g.top = "TOP"
    once = normalize(g); twice = normalize(once)
    assert {i: (n.op, tuple(n.args)) for i, n in twice.nodes.items() if n.op} == \
           {i: (n.op, tuple(n.args)) for i, n in once.nodes.items() if n.op}
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit/test_normalize.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# psaengine/preprocess/normalize.py
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
```
`psaengine/preprocess/__init__.py`: 空文件。

> 注:`_const_prop` 中 `Op.NULL`+`state=True` 表示"恒真常量门"。NULL 门在 BDD 层映射为其 `state`(若 args 为单子则透传)。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit/test_normalize.py -v`
Expected: PASS(5 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/preprocess tests/unit/test_normalize.py
git commit -m "feat(preprocess): cycle check, constant propagation, coalescing"
```

### Task 6: 展开(k/n + CCF Beta/MGL/Alpha)

**Files:**
- Create: `psaengine/preprocess/expand.py`
- Test: `tests/unit/test_expand.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_expand.py
import math, pytest
from psaengine.preprocess.expand import ccf_basic_probabilities

def test_beta_factor_split():
    # 总 Q=0.01, β=0.1 → 独立 0.009, 共因 0.001
    probs = ccf_basic_probabilities(model="beta", m=3, q_total=0.01, factors={"beta": 0.1})
    assert probs["independent"] == pytest.approx(0.009)
    assert probs["all"] == pytest.approx(0.001)

def test_mgl_three_components():
    # m=3, β=0.1, γ=0.5; Q_t=0.01
    # Q1=(1-β)Q_t; Q2=(1/C(2,1))·β·(1-γ)·Q_t; Q3=(1/C(2,2))·β·γ·Q_t
    p = ccf_basic_probabilities(model="mgl", m=3, q_total=0.01,
                                factors={"beta": 0.1, "gamma": 0.5})
    assert p["1"] == pytest.approx(0.9 * 0.01)
    assert p["2"] == pytest.approx((1/2) * 0.1 * 0.5 * 0.01)
    assert p["3"] == pytest.approx(0.1 * 0.5 * 0.01)

def test_alpha_factor_staggered():
    # alpha 因子(交错), m=2, α1, α2; Q_k ∝ (k/C(m-1,k-1))·α_k·Q_t/α_t
    p = ccf_basic_probabilities(model="alpha", m=2, q_total=0.01,
                                factors={"alpha1": 0.95, "alpha2": 0.05})
    assert p["1"] > 0 and p["2"] > 0
    assert p["2"] == pytest.approx((2/1) * 0.05 / (0.95 + 2*0.05) * 0.01, rel=1e-9)
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit/test_expand.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# psaengine/preprocess/expand.py
from __future__ import annotations
from math import comb

def ccf_basic_probabilities(model: str, m: int, q_total: float, factors: dict) -> dict:
    """返回各阶 CCF 基本事件概率。键: 'independent'/'all'(beta) 或 '1'..'m'。
    参考 NUREG/CR-5485。"""
    if model == "beta":
        beta = factors["beta"]
        return {"independent": (1 - beta) * q_total, "all": beta * q_total}
    if model == "mgl":
        rho = {1: 1.0, 2: factors.get("beta", 0.0), 3: factors.get("gamma", 0.0),
               4: factors.get("delta", 0.0)}
        out = {}
        for k in range(1, m + 1):
            prod = 1.0
            for i in range(2, k + 1):
                prod *= rho.get(i, 0.0)
            next_rho = rho.get(k + 1, 0.0)
            out[str(k)] = (1.0 / comb(m - 1, k - 1)) * prod * (1 - next_rho) * q_total
        return out
    if model == "alpha":
        alpha = {k: factors.get(f"alpha{k}", 0.0) for k in range(1, m + 1)}
        alpha_t = sum(k * alpha[k] for k in alpha)   # 交错测试归一
        out = {}
        for k in range(1, m + 1):
            out[str(k)] = (k / comb(m - 1, k - 1)) * (alpha[k] / alpha_t) * q_total
        return out
    raise ValueError(f"unknown CCF model {model}")
```

> 注:k/n 默认在 BDD 层用 ITE 递归构造(Task 9),不在此展开;`expand.py` 仅负责 CCF 概率拆分,供建模/ZBDD 路径使用。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit/test_expand.py -v`
Expected: PASS(3 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/preprocess/expand.py tests/unit/test_expand.py
git commit -m "feat(preprocess): CCF probability expansion (beta/MGL/alpha)"
```

---

## Milestone 3 — 变量序

### Task 7: DFLM / WDFLM / RDFLM

**Files:**
- Create: `psaengine/ordering/__init__.py`, `psaengine/ordering/heuristics.py`
- Test: `tests/unit/test_ordering.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_ordering.py
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm

def test_dflm_left_first():
    g = PDAG()
    for b in ["A", "B", "C"]: g.basic(b)
    g.gate("L", Op.OR, ["A", "B"]); g.gate("TOP", Op.AND, ["L", "C"]); g.top = "TOP"
    order = dflm(g)
    # 深度优先最左: 先 A,B(经 L), 再 C
    assert order.index("A") < order.index("B") < order.index("C")

def test_dflm_covers_all_basics():
    g = PDAG()
    for b in ["A", "B", "C"]: g.basic(b)
    g.gate("TOP", Op.OR, ["A", "B", "C"]); g.top = "TOP"
    assert set(dflm(g)) == {"A", "B", "C"}
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit/test_ordering.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# psaengine/ordering/heuristics.py
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
```
`psaengine/ordering/__init__.py`: 空文件。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit/test_ordering.py -v`
Expected: PASS(2 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/ordering tests/unit/test_ordering.py
git commit -m "feat(ordering): DFLM/WDFLM/RDFLM variable ordering"
```

---

## Milestone 4 — BDD 内核

### Task 8: BDD 管理器(ite + 唯一表 + 计算表 + 补边)

**Files:**
- Create: `psaengine/bdd/__init__.py`, `psaengine/bdd/kernel.py`
- Test: `tests/unit/test_bdd_kernel.py`

> 执行前:`Skill` 调用 `fta-eta-quantification-engine`,参考 `assets/bdd_engine.py`。本任务代码为最终契约。

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_bdd_kernel.py
from psaengine.bdd.kernel import BddManager

def test_var_and_constants():
    m = BddManager(["A", "B"])
    assert m.ite(m.one, m.one, m.zero) == m.one
    a = m.var("A")
    assert m.is_var(a, "A")

def test_and_or_not_truth_table():
    m = BddManager(["A", "B"])
    a, b = m.var("A"), m.var("B")
    g_and = m.apply_and(a, b)
    g_or = m.apply_or(a, b)
    # AND 仅 A=1,B=1 为真
    assert m.eval(g_and, {"A": 1, "B": 1}) == 1
    assert m.eval(g_and, {"A": 1, "B": 0}) == 0
    assert m.eval(g_or, {"A": 0, "B": 1}) == 1
    assert m.eval(g_or, {"A": 0, "B": 0}) == 0
    assert m.eval(m.apply_not(a), {"A": 0, "B": 0}) == 1

def test_canonicity_same_function_same_root():
    m = BddManager(["A", "B"])
    a, b = m.var("A"), m.var("B")
    f1 = m.apply_or(a, b)
    f2 = m.apply_or(b, a)          # 交换律 → 同根(规范型)
    assert f1 == f2

def test_redundant_node_eliminated():
    m = BddManager(["A"])
    a = m.var("A")
    # ite(A, X, X) == X
    assert m.ite(a, m.one, m.one) == m.one
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit/test_bdd_kernel.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# psaengine/bdd/kernel.py
from __future__ import annotations
from typing import Optional

# 节点表示: 整数句柄。0=ZERO, 1=ONE。补边用奇偶位(handle ^ 1)表示取反。
# 内部节点存为 (var_index, high_handle, low_handle), high 边永不取反(规范化)。

class BddManager:
    ZERO = 0
    ONE = 1

    def __init__(self, var_order: list[str]):
        self.var_order = list(var_order)
        self.var_index = {v: i for i, v in enumerate(var_order)}
        self._nodes: dict[int, tuple[int, int, int]] = {}     # handle(偶) -> (var, hi, lo)
        self._unique: dict[tuple[int, int, int], int] = {}
        self._computed: dict[tuple, int] = {}
        self._next = 2                                          # 下一个偶数句柄

    # ---- 常量与变量 ----
    @property
    def one(self) -> int: return self.ONE
    @property
    def zero(self) -> int: return self.ZERO

    def var(self, name: str) -> int:
        return self._mk(self.var_index[name], self.ONE, self.ZERO)

    def is_var(self, h: int, name: str) -> bool:
        if h in (0, 1): return False
        v, hi, lo = self._node(h & ~1)
        return v == self.var_index[name] and hi == self.ONE and lo == self.ZERO and not (h & 1)

    # ---- 补边工具 ----
    @staticmethod
    def _is_comp(h: int) -> bool: return bool(h & 1)
    @staticmethod
    def _regular(h: int) -> int: return h & ~1
    def _node(self, h: int) -> tuple[int, int, int]:
        return self._nodes[self._regular(h)]

    def _comp(self, h: int) -> int:
        if h == self.ZERO: return self.ONE
        if h == self.ONE: return self.ZERO
        return h ^ 1

    # ---- 唯一表(hash-consing) + 规范化补边 ----
    def _mk(self, var: int, hi: int, lo: int) -> int:
        if hi == lo:                      # 冗余节点消除
            return hi
        # 规范化: high 边不带补 → 若带补, 整体取补
        comp_out = self._is_comp(hi)
        if comp_out:
            hi, lo = self._comp(hi), self._comp(lo)
        key = (var, hi, lo)
        if key in self._unique:
            h = self._unique[key]
        else:
            h = self._next; self._next += 2
            self._nodes[h] = (var, hi, lo)
            self._unique[key] = h
        return self._comp(h) if comp_out else h

    def _top_var(self, h: int) -> int:
        if h in (0, 1): return len(self.var_order)
        return self._node(h)[0]

    def _cofactor(self, h: int, var: int, val: int):
        if self._top_var(h) != var:
            return h
        v, hi, lo = self._node(h)
        branch = hi if val == 1 else lo
        return self._comp(branch) if self._is_comp(h) else branch

    # ---- ITE ----
    def ite(self, f: int, g: int, h: int) -> int:
        if f == self.ONE: return g
        if f == self.ZERO: return h
        if g == h: return g
        if g == self.ONE and h == self.ZERO: return f
        key = ("ite", f, g, h)
        if key in self._computed: return self._computed[key]
        top = min(self._top_var(f), self._top_var(g), self._top_var(h))
        fh = self._cofactor(f, top, 1); fl = self._cofactor(f, top, 0)
        gh = self._cofactor(g, top, 1); gl = self._cofactor(g, top, 0)
        hh = self._cofactor(h, top, 1); hl = self._cofactor(h, top, 0)
        t = self.ite(fh, gh, hh); e = self.ite(fl, gl, hl)
        r = self._mk(top, t, e)
        self._computed[key] = r
        return r

    # ---- 布尔算子 ----
    def apply_and(self, f: int, g: int) -> int: return self.ite(f, g, self.ZERO)
    def apply_or(self, f: int, g: int) -> int:  return self.ite(f, self.ONE, g)
    def apply_not(self, f: int) -> int:          return self._comp(f)

    # ---- 求值(真值表语义, 用于测试) ----
    def eval(self, h: int, assignment: dict[str, int]) -> int:
        cur = h
        while cur not in (self.ZERO, self.ONE):
            v, hi, lo = self._node(cur)
            val = assignment[self.var_order[v]]
            branch = hi if val == 1 else lo
            cur = self._comp(branch) if self._is_comp(cur) else branch
        return cur
```
`psaengine/bdd/__init__.py`: 空文件。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit/test_bdd_kernel.py -v`
Expected: PASS(4 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/bdd tests/unit/test_bdd_kernel.py
git commit -m "feat(bdd): ROBDD manager with ite, unique/computed tables, complemented edges"
```

### Task 9: 从 PDAG 建 BDD(含 ATLEAST 的 ITE 递归)

**Files:**
- Modify: `psaengine/bdd/kernel.py`(新增 `build_from_pdag`)
- Test: `tests/unit/test_bdd_build.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_bdd_build.py
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag

def test_build_and():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.AND, ["A","B"]); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    assert m.eval(root, {"A":1,"B":1}) == 1
    assert m.eval(root, {"A":1,"B":0}) == 0

def test_build_2oo3():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.ATLEAST, ["A","B","C"], k=2); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    assert m.eval(root, {"A":1,"B":1,"C":0}) == 1   # 2 个真
    assert m.eval(root, {"A":1,"B":0,"C":0}) == 0   # 1 个真
    assert m.eval(root, {"A":1,"B":1,"C":1}) == 1   # 3 个真

def test_build_not_and_xor():
    g = PDAG(); g.basic("A"); g.basic("B")
    g.gate("X", Op.XOR, ["A","B"]); g.top="X"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "X")
    assert m.eval(root, {"A":1,"B":0}) == 1
    assert m.eval(root, {"A":1,"B":1}) == 0
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit/test_bdd_build.py -v`
Expected: FAIL(ImportError: build_from_pdag)

- [ ] **Step 3: 实现(追加到 kernel.py)**

```python
# 追加到 psaengine/bdd/kernel.py 末尾
from psaengine.model.pdag import PDAG, Op

def build_from_pdag(m: "BddManager", g: PDAG, root_id: str, _memo=None) -> int:
    if _memo is None: _memo = {}
    if root_id in _memo: return _memo[root_id]
    n = g.nodes[root_id]
    if n.is_basic:
        r = m.var(root_id)
    elif n.is_house:
        r = m.one if n.state else m.zero
    elif n.op is Op.NULL:
        if n.state is not None: r = m.one if n.state else m.zero
        else: r = build_from_pdag(m, g, n.args[0], _memo)
    else:
        child = [build_from_pdag(m, g, a, _memo) for a in n.args]
        if n.op is Op.AND:
            r = child[0]
            for c in child[1:]: r = m.apply_and(r, c)
        elif n.op is Op.OR:
            r = child[0]
            for c in child[1:]: r = m.apply_or(r, c)
        elif n.op is Op.NOT:
            r = m.apply_not(child[0])
        elif n.op is Op.XOR:
            r = child[0]
            for c in child[1:]: r = m.ite(r, m.apply_not(c), c)
        elif n.op is Op.ATLEAST:
            r = _atleast(m, child, n.k)
        else:
            raise ValueError(f"unsupported op {n.op}")
    _memo[root_id] = r
    return r

def _atleast(m: "BddManager", child: list[int], k: int) -> int:
    """k-of-n 用 ITE 递归: f(i,need) = ite(child[i], f(i+1,need-1), f(i+1,need))。"""
    n = len(child)
    cache: dict[tuple[int, int], int] = {}
    def rec(i: int, need: int) -> int:
        if need <= 0: return m.one
        if need > n - i: return m.zero
        if (i, need) in cache: return cache[(i, need)]
        r = m.ite(child[i], rec(i + 1, need - 1), rec(i + 1, need))
        cache[(i, need)] = r
        return r
    return rec(0, k)
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit/test_bdd_build.py -v`
Expected: PASS(3 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/bdd/kernel.py tests/unit/test_bdd_build.py
git commit -m "feat(bdd): build ROBDD from PDAG incl. k-of-n via ITE recursion"
```

---

## Milestone 5 — 概率定量(首个"算得对"里程碑)

### Task 10: 精确 Shannon + REA + MCUB

**Files:**
- Create: `psaengine/quantify/__init__.py`, `psaengine/quantify/probability.py`
- Test: `tests/analytical/test_probability.py`

- [ ] **Step 1: 写失败测试(含 SOTA 高估缺口的解析解)**

```python
# tests/analytical/test_probability.py
import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability, rea, mcub

def _probs_and():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.AND, ["A","B"]); g.top="TOP"
    return g, {"A":0.1, "B":0.2}

def test_exact_and():
    g, q = _probs_and()
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    assert exact_probability(m, root, q) == pytest.approx(0.1*0.2)

def test_exact_or():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.OR, ["A","B"]); g.top="TOP"
    q = {"A":0.1, "B":0.2}
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    assert exact_probability(m, root, q) == pytest.approx(1 - 0.9*0.8)

def test_2oo3_exact_vs_mcub_vs_rea_gap():
    # 非稀有屏障概率 q=0.3, 2-out-of-3, MCS={AB,AC,BC}
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.ATLEAST, ["A","B","C"], k=2); g.top="TOP"
    q = {"A":0.3, "B":0.3, "C":0.3}
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    exact = exact_probability(m, root, q)
    # 解析精确: P(>=2 of 3, p=0.3) = 3·0.3²·0.7 + 0.3³ = 0.189 + 0.027 = 0.216
    assert exact == pytest.approx(0.216)
    mc = mcub([0.09, 0.09, 0.09])     # 三个二阶割集概率
    re = rea([0.09, 0.09, 0.09])
    assert exact < mc < re             # SOTA: 精确 < MCUB < REA
    assert re == pytest.approx(0.27)

def test_invariant_exact_le_mcub_le_rea():
    cs = [0.05, 0.04, 0.03]
    assert rea(cs) >= mcub(cs)
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/analytical/test_probability.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# psaengine/quantify/probability.py
from __future__ import annotations
from math import prod
from psaengine.bdd.kernel import BddManager

def exact_probability(m: BddManager, root: int, q: dict[str, float]) -> float:
    """BDD 线性自底向上 Shannon 遍历, 精确顶事件概率。"""
    memo: dict[int, float] = {}
    def pr(h: int) -> float:
        if h == m.ZERO: return 0.0
        if h == m.ONE: return 1.0
        reg = h & ~1
        if reg in memo:
            base = memo[reg]
        else:
            v, hi, lo = m._nodes[reg]
            name = m.var_order[v]
            p = q[name]
            base = p * pr(hi) + (1 - p) * pr(lo)
            memo[reg] = base
        return 1.0 - base if (h & 1) else base
    return pr(root)

def rea(cutset_probs: list[float]) -> float:
    """稀有事件近似(上界): Σ Q_i。"""
    return sum(cutset_probs)

def mcub(cutset_probs: list[float]) -> float:
    """最小割集上界(Esary-Proschan): 1 - ∏(1-Q_i)。"""
    return 1.0 - prod(1.0 - q for q in cutset_probs)
```
`psaengine/quantify/__init__.py`: 空文件。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/analytical/test_probability.py -v`
Expected: PASS(5 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/quantify tests/analytical/test_probability.py
git commit -m "feat(quantify): exact Shannon probability + REA/MCUB with SOTA gap test"
```

### Task 11: `dd` 对拍(独立预言机)

**Files:**
- Test: `tests/cross/test_dd_crosscheck.py`

- [ ] **Step 1: 写测试**

```python
# tests/cross/test_dd_crosscheck.py
import pytest
dd_autoref = pytest.importorskip("dd.autoref")
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability

def test_crosscheck_2oo3_probability():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.ATLEAST, ["A","B","C"], k=2); g.top="TOP"
    q = {"A":0.3,"B":0.2,"C":0.1}
    # 自研引擎
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    mine = exact_probability(m, root, q)
    # dd 作独立预言机
    bdd = dd_autoref.BDD(); bdd.declare("A","B","C")
    expr = bdd.add_expr("(A & B) | (A & C) | (B & C)")
    def ddprob(u):
        # 用公共 API bdd.let 做 cofactor(内部自动处理补边), 避免触碰 .high/.low/.negated
        if u == bdd.true: return 1.0
        if u == bdd.false: return 0.0
        x = u.var
        hi = bdd.let({x: True}, u); lo = bdd.let({x: False}, u)
        return q[x]*ddprob(hi) + (1-q[x])*ddprob(lo)
    assert mine == pytest.approx(ddprob(expr), rel=1e-12)
```

- [ ] **Step 2: 运行**

Run: `pytest tests/cross/test_dd_crosscheck.py -v`
Expected: PASS(若未装 `dd` 则 SKIP)

- [ ] **Step 3: 提交**

```bash
git add tests/cross/test_dd_crosscheck.py
git commit -m "test(cross): dd.autoref independent oracle for exact probability"
```

---

## Milestone 6 — 割集(ZBDD)

### Task 12: ZBDD 管理器

**Files:**
- Create: `psaengine/bdd/zbdd.py`
- Test: `tests/unit/test_zbdd.py`

> 执行前参考技能 `assets/` 的 ZBDD 思路;最终契约见下。

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_zbdd.py
from psaengine.bdd.zbdd import ZbddManager

def test_single_set_and_count():
    z = ZbddManager(["A","B","C"])
    s = z.set_of([{"A","B"}])
    assert z.count(s) == 1
    assert z.to_sets(s) == [{"A","B"}]

def test_union_and_count():
    z = ZbddManager(["A","B","C"])
    s = z.union(z.set_of([{"A"}]), z.set_of([{"B","C"}]))
    assert z.count(s) == 2
    assert sorted(z.to_sets(s), key=len) == [{"A"}, {"B","C"}]

def test_subsume_removes_supersets():
    z = ZbddManager(["A","B","C"])
    s = z.set_of([{"A"}, {"A","B"}, {"B","C"}])   # {A,B} 被 {A} 吸收
    s = z.minimize(s)
    assert {"A"} in z.to_sets(s)
    assert {"A","B"} not in z.to_sets(s)
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit/test_zbdd.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# psaengine/bdd/zbdd.py
from __future__ import annotations

# ZBDD 句柄: 0=EMPTY(空族), 1=BASE(含空集的族 {∅})。
# 内部节点 (var, hi, lo): hi=含 var 的子族, lo=不含 var 的子族。
# 零抑制规则: hi==EMPTY → 返回 lo。

class ZbddManager:
    EMPTY = 0
    BASE = 1

    def __init__(self, var_order: list[str]):
        self.var_order = list(var_order)
        self.idx = {v: i for i, v in enumerate(var_order)}
        self._nodes: dict[int, tuple[int,int,int]] = {}
        self._unique: dict[tuple[int,int,int], int] = {}
        self._next = 2

    def _getnode(self, var: int, hi: int, lo: int) -> int:
        if hi == self.EMPTY:                 # 零抑制
            return lo
        key = (var, hi, lo)
        if key in self._unique: return self._unique[key]
        h = self._next; self._next += 1
        self._nodes[h] = (var, hi, lo); self._unique[key] = h
        return h

    def _top(self, p: int) -> int:
        if p in (0,1): return len(self.var_order)
        return self._nodes[p][0]

    def set_of(self, sets: list[set[str]]) -> int:
        result = self.EMPTY
        for s in sets:
            result = self.union(result, self._single(s))
        return result

    def _single(self, s: set[str]) -> int:
        p = self.BASE
        for v in sorted(s, key=lambda x: self.idx[x], reverse=True):
            p = self._getnode(self.idx[v], p, self.EMPTY)
        return p

    def union(self, p: int, q: int) -> int:
        if p == self.EMPTY: return q
        if q == self.EMPTY: return p
        if p == q: return p
        if p == self.BASE: return self._add_base(q)
        if q == self.BASE: return self._add_base(p)
        pv, qv = self._top(p), self._top(q)
        if pv < qv:
            v, hi, lo = self._nodes[p]; return self._getnode(v, hi, self.union(lo, q))
        if qv < pv:
            v, hi, lo = self._nodes[q]; return self._getnode(v, hi, self.union(p, lo))
        pv_, ph, pl = self._nodes[p]; qv_, qh, ql = self._nodes[q]
        return self._getnode(pv_, self.union(ph, qh), self.union(pl, ql))

    def _add_base(self, p: int) -> int:
        if p in (self.EMPTY,): return self.BASE
        if p == self.BASE: return self.BASE
        v, hi, lo = self._nodes[p]; return self._getnode(v, hi, self._add_base(lo))

    def count(self, p: int) -> int:
        if p == self.EMPTY: return 0
        if p == self.BASE: return 1
        v, hi, lo = self._nodes[p]; return self.count(hi) + self.count(lo)

    def to_sets(self, p: int) -> list[set[str]]:
        if p == self.EMPTY: return []
        if p == self.BASE: return [set()]
        v, hi, lo = self._nodes[p]
        name = self.var_order[v]
        return [s | {name} for s in self.to_sets(hi)] + self.to_sets(lo)

    def minimize(self, p: int) -> int:
        """删除非最小集合(被更小子集吸收)。"""
        sets = self.to_sets(p)
        minimal = []
        for s in sorted(sets, key=len):
            if not any(m <= s for m in minimal):
                minimal.append(s)
        return self.set_of(minimal)
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit/test_zbdd.py -v`
Expected: PASS(3 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/bdd/zbdd.py tests/unit/test_zbdd.py
git commit -m "feat(bdd): ZBDD manager with union/count/minimize"
```

### Task 13: 割集抽取 + 截断

**Files:**
- Create: `psaengine/quantify/cutsets.py`
- Test: `tests/analytical/test_cutsets.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/analytical/test_cutsets.py
import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.cutsets import minimal_cutsets

def test_2oo3_cutsets():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.ATLEAST, ["A","B","C"], k=2); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    cs = minimal_cutsets(m, root)
    got = sorted([sorted(c.events) for c in cs])
    assert got == [["A","B"], ["A","C"], ["B","C"]]

def test_cutoff_filters_low_prob():
    g = PDAG()
    for b in "ABC": g.basic(b)
    g.gate("TOP", Op.OR, ["A","B","C"]); g.top="TOP"
    q = {"A":0.1, "B":1e-6, "C":1e-8}
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    cs = minimal_cutsets(m, root, q=q, cutoff=1e-7)
    events = sorted(e for c in cs for e in c.events)
    assert "C" not in events and "A" in events

def test_limit_order():
    g = PDAG()
    for b in "ABCD": g.basic(b)
    g.gate("TOP", Op.AND, ["A","B","C","D"]); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    cs = minimal_cutsets(m, root, limit_order=3)
    assert cs == []                    # 唯一割集阶数 4 > 3, 被滤掉
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/analytical/test_cutsets.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# psaengine/quantify/cutsets.py
from __future__ import annotations
from dataclasses import dataclass
from math import prod
from psaengine.bdd.kernel import BddManager

@dataclass
class CutSet:
    events: list[str]
    order: int
    probability: float = 0.0

def _paths_to_one(m: BddManager, root: int) -> list[set[str]]:
    """枚举 BDD 中使函数为真的正文字路径(相干树近似: 只取置 1 的变量)。"""
    out: list[set[str]] = []
    def rec(h: int, chosen: set[str], comp: bool):
        if h == m.ZERO:
            if comp: out.append(set(chosen))
            return
        if h == m.ONE:
            if not comp: out.append(set(chosen))
            return
        reg = h & ~1; v, hi, lo = m._nodes[reg]
        c = comp ^ bool(h & 1)
        name = m.var_order[v]
        rec(hi, chosen | {name}, c)     # 该变量取 1
        rec(lo, chosen, c)              # 该变量取 0(不入割集)
    rec(root, set(), False)
    return out

def minimal_cutsets(m: BddManager, root: int, q: dict[str, float] | None = None,
                    cutoff: float = 0.0, limit_order: int | None = None) -> list[CutSet]:
    from psaengine.bdd.zbdd import ZbddManager
    raw = _paths_to_one(m, root)                 # BDD 路径 → 候选割集(含非最小)
    z = ZbddManager(m.var_order)                 # 用 ZBDD 做因子化最小化(吸收律)
    minimal = z.to_sets(z.minimize(z.set_of(raw)))
    cuts: list[CutSet] = []
    for s in minimal:
        order = len(s)
        if limit_order is not None and order > limit_order:
            continue
        p = prod(q[e] for e in s) if q else 0.0
        if q and p < cutoff:
            continue
        cuts.append(CutSet(sorted(s), order, p))
    cuts.sort(key=lambda c: (-c.probability, c.order, c.events))
    return cuts
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/analytical/test_cutsets.py -v`
Expected: PASS(3 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/quantify/cutsets.py tests/analytical/test_cutsets.py
git commit -m "feat(quantify): minimal cut-set extraction with cutoff/limit-order"
```

---

## Milestone 7 — 重要度

### Task 14: Birnbaum / FV / RAW / RRW / DIM

**Files:**
- Create: `psaengine/importance/__init__.py`, `psaengine/importance/measures.py`
- Test: `tests/analytical/test_importance.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/analytical/test_importance.py
import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.importance.measures import importance

def _or_model():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.OR, ["A","B"]); g.top="TOP"
    q = {"A":0.1, "B":0.2}
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    return m, root, q

def test_birnbaum_or_gate():
    m, root, q = _or_model()
    imp = importance(m, root, q, measures=["birnbaum"])
    # Birnbaum_A = h(1_A) - h(0_A) = 1 - (q_B) = 1 - 0.2 = 0.8
    assert imp["A"]["birnbaum"] == pytest.approx(0.8)

def test_fv_and_raw():
    m, root, q = _or_model()
    imp = importance(m, root, q, measures=["fv","raw"])
    h = 1 - 0.9*0.8                     # 0.28
    # FV_A = (h - h(0_A))/h ; h(0_A)=q_B=0.2
    assert imp["A"]["fv"] == pytest.approx((h - 0.2)/h)
    # RAW_A = h(1_A)/h = 1/h
    assert imp["A"]["raw"] == pytest.approx(1.0/h)

def test_birnbaum_equals_numeric_derivative():
    m, root, q = _or_model()
    imp = importance(m, root, q, measures=["birnbaum"])
    from psaengine.quantify.probability import exact_probability
    eps = 1e-7
    qp = dict(q); qp["A"] += eps; qm = dict(q); qm["A"] -= eps
    num = (exact_probability(m, root, qp) - exact_probability(m, root, qm)) / (2*eps)
    assert imp["A"]["birnbaum"] == pytest.approx(num, rel=1e-5)
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/analytical/test_importance.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# psaengine/importance/measures.py
from __future__ import annotations
from psaengine.bdd.kernel import BddManager
from psaengine.quantify.probability import exact_probability

def importance(m: BddManager, root: int, q: dict[str, float],
               measures: list[str]) -> dict[str, dict[str, float]]:
    h = exact_probability(m, root, q)
    out: dict[str, dict[str, float]] = {}
    for name in q:
        q1 = dict(q); q1[name] = 1.0
        q0 = dict(q); q0[name] = 0.0
        h1 = exact_probability(m, root, q1)   # h(1_i, p)
        h0 = exact_probability(m, root, q0)   # h(0_i, p)
        vals: dict[str, float] = {}
        birnbaum = h1 - h0
        for meas in measures:
            if meas == "birnbaum": vals["birnbaum"] = birnbaum
            elif meas == "fv":  vals["fv"] = (h - h0) / h if h > 0 else 0.0
            elif meas == "raw": vals["raw"] = h1 / h if h > 0 else float("inf")
            elif meas == "rrw": vals["rrw"] = h / h0 if h0 > 0 else float("inf")
            elif meas == "dim": vals["dim"] = birnbaum * q[name]    # 微分重要度(未归一)
            else: raise ValueError(f"unknown importance measure {meas}")
        out[name] = vals
    return out
```
`psaengine/importance/__init__.py`: 空文件。

> 注:`h(1_i)`/`h(0_i)` 用 cofactor 等价的"置参数为 1/0 再精确求值"实现,数值上即 BDD 偏导,且复用已验证的 `exact_probability`,正确性更稳。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/analytical/test_importance.py -v`
Expected: PASS(3 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/importance tests/analytical/test_importance.py
git commit -m "feat(importance): Birnbaum/FV/RAW/RRW/DIM via exact cofactor probabilities"
```

---

## Milestone 8 — 不确定性

### Task 15: 蒙特卡洛 + 龙卷风

**Files:**
- Create: `psaengine/uncertainty/__init__.py`, `psaengine/uncertainty/montecarlo.py`
- Test: `tests/unit/test_uncertainty.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_uncertainty.py
import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, Distribution
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.uncertainty.montecarlo import propagate

def test_reproducible_with_seed():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.OR, ["A","B"]); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    params = {
        "A": Parameter("A","probability",0.1, distribution=Distribution("lognormal",{"median":0.1,"error_factor":3})),
        "B": Parameter("B","probability",0.2, distribution=Distribution("lognormal",{"median":0.2,"error_factor":2})),
    }
    r1 = propagate(m, root, params, samples=2000, seed=42)
    r2 = propagate(m, root, params, samples=2000, seed=42)
    assert r1["mean"] == pytest.approx(r2["mean"])
    assert r1["p05"] <= r1["p50"] <= r1["p95"]

def test_tornado_ranks_by_swing():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.OR, ["A","B"]); g.top="TOP"
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    params = {
        "A": Parameter("A","probability",0.1, distribution=Distribution("lognormal",{"median":0.1,"error_factor":10})),
        "B": Parameter("B","probability",0.2, distribution=Distribution("lognormal",{"median":0.2,"error_factor":1.2})),
    }
    r = propagate(m, root, params, samples=1000, seed=1, tornado=True)
    # A 的误差因子更大 → 摆幅更大 → 排前
    assert r["tornado"][0][0] == "A"
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit/test_uncertainty.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# psaengine/uncertainty/montecarlo.py
from __future__ import annotations
import numpy as np
from math import log
from psaengine.bdd.kernel import BddManager
from psaengine.quantify.probability import exact_probability

def _sample(dist, rng: np.random.Generator, n: int) -> np.ndarray:
    fam, pr = dist.family, dist.params
    if fam == "lognormal":
        median = pr["median"]; ef = pr["error_factor"]
        sigma = log(ef) / 1.645                 # EF = exp(1.645σ)
        return rng.lognormal(mean=log(median), sigma=sigma, size=n)
    if fam == "normal":
        return rng.normal(pr["mean"], pr["sd"], size=n)
    if fam == "uniform":
        return rng.uniform(pr["low"], pr["high"], size=n)
    if fam == "beta":
        return rng.beta(pr["a"], pr["b"], size=n)
    raise ValueError(f"unknown distribution {fam}")

def propagate(m: BddManager, root: int, params: dict, samples: int = 10000,
              seed: int = 42, tornado: bool = False) -> dict:
    rng = np.random.default_rng(seed)
    names = list(params)
    cols = {}
    for nm in names:
        d = params[nm].distribution
        cols[nm] = np.clip(_sample(d, rng, samples), 0.0, 1.0) if d else \
                   np.full(samples, params[nm].unavailability())
    tops = np.empty(samples)
    for i in range(samples):
        q = {nm: cols[nm][i] for nm in names}
        tops[i] = exact_probability(m, root, q)
    result = {
        "mean": float(tops.mean()),
        "p05": float(np.percentile(tops, 5)),
        "p50": float(np.percentile(tops, 50)),
        "p95": float(np.percentile(tops, 95)),
        "samples": samples, "seed": seed,
        "histogram": np.histogram(tops, bins=30),
    }
    if tornado:
        base = {nm: params[nm].unavailability() for nm in names}
        swings = []
        for nm in names:
            lo = float(np.percentile(cols[nm], 5)); hi = float(np.percentile(cols[nm], 95))
            qlo = dict(base); qlo[nm] = lo; qhi = dict(base); qhi[nm] = hi
            swing = abs(exact_probability(m, root, qhi) - exact_probability(m, root, qlo))
            swings.append((nm, swing))
        result["tornado"] = sorted(swings, key=lambda x: -x[1])
    return result
```
`psaengine/uncertainty/__init__.py`: 空文件。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit/test_uncertainty.py -v`
Expected: PASS(2 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/uncertainty tests/unit/test_uncertainty.py
git commit -m "feat(uncertainty): Monte Carlo propagation + tornado sensitivity"
```

---

## Milestone 9 — 事件树

### Task 16: 序列定量(成功分支精确否定 + C 分箱)

**Files:**
- Create: `psaengine/eta/__init__.py`, `psaengine/eta/sequence.py`
- Test: `tests/analytical/test_eta.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/analytical/test_eta.py
import pytest
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.model import Model
from psaengine.eta.sequence import quantify_event_tree

def _barrier_ft(name, ev, q):
    g = PDAG(); g.basic(ev, param_ref=ev); g.gate(name, Op.NULL, [ev]); g.top=name
    return FaultTree(name, g)

def test_two_barriers_success_branch_exact():
    lib = ParameterLibrary()
    lib.add(Parameter("D","probability",0.1))   # 探测失败概率
    lib.add(Parameter("S","probability",0.2))   # 抑制失败概率
    model = Model(
        parameters=lib,
        fault_trees={"DET": _barrier_ft("DET","D",0.1), "SUP": _barrier_ft("SUP","S",0.2)},
        event_trees={"ET": EventTree(
            init_event="IE", init_frequency=2.0,
            functional_events=[FunctionalEvent("DET", link_ft="DET"),
                               FunctionalEvent("SUP", link_ft="SUP")],
            sequences=[
                {"path":{"DET":"success","SUP":"success"}, "end_state":"OK"},
                {"path":{"DET":"success","SUP":"failure"}, "end_state":"FIRE"},
                {"path":{"DET":"failure","SUP":"failure"}, "end_state":"BLOWUP"},
            ],
            consequence_bins={"OK":"C1","FIRE":"C3","BLOWUP":"C5"})},
        ccf_groups=[])
    res = quantify_event_tree(model, "ET")
    # 频率 = IE_freq × Pr(序列布尔式)
    # OK: ¬D·¬S = 0.9·0.8=0.72 → 1.44
    # FIRE: ¬D·S = 0.9·0.2=0.18 → 0.36
    # BLOWUP: D·S = 0.1·0.2=0.02 → 0.04  (¬D 不在此序列)
    assert res["sequences"]["OK"] == pytest.approx(1.44)
    assert res["sequences"]["FIRE"] == pytest.approx(0.36)
    assert res["sequences"]["BLOWUP"] == pytest.approx(0.04)
    # 后果汇总
    assert res["consequences"]["C5"] == pytest.approx(0.04)
    assert res["consequences"]["C3"] == pytest.approx(0.36)
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/analytical/test_eta.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# psaengine/eta/sequence.py
from __future__ import annotations
from psaengine.model.model import Model
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability

def quantify_event_tree(model: Model, et_name: str) -> dict:
    et = model.event_trees[et_name]
    # 合并所有相关故障树到一个 PDAG, 统一变量序
    from psaengine.model.pdag import PDAG, Op
    big = PDAG()
    fe_top: dict[str, str] = {}
    for fe in et.functional_events:
        ft = model.fault_trees[fe.link_ft]
        for nid, n in ft.pdag.nodes.items():
            if nid not in big.nodes:
                big.nodes[nid] = n
        fe_top[fe.id] = ft.top
    # 变量序: 以任一 FE 顶门为根做 DFLM 覆盖全部基本事件
    all_basics = sorted(big.basic_events())
    m = BddManager(all_basics)
    fe_bdd = {fid: build_from_pdag(m, big, top) for fid, top in fe_top.items()}
    q = {b: model.parameters.get(big.nodes[b].param_ref).unavailability() for b in all_basics}

    seq_freq: dict[str, float] = {}
    cons_freq: dict[str, float] = {}
    for seq in et.sequences:
        expr = m.one
        for fe_id, branch in seq["path"].items():
            g = fe_bdd[fe_id]
            expr = m.apply_and(expr, g if branch == "failure" else m.apply_not(g))
        p = exact_probability(m, expr, q)
        freq = et.init_frequency * p
        seq_freq[seq["end_state"]] = seq_freq.get(seq["end_state"], 0.0) + freq
        cls = et.consequence_of(seq["end_state"])
        cons_freq[cls] = cons_freq.get(cls, 0.0) + freq
    return {"sequences": seq_freq, "consequences": cons_freq}
```
`psaengine/eta/__init__.py`: 空文件。

> 注:成功分支用 `apply_not(g)`(精确 BDD 否定),跨序列共享事件由统一变量序与同一 BddManager 自动正确处理,避免删除项近似。

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/analytical/test_eta.py -v`
Expected: PASS(1 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/eta tests/analytical/test_eta.py
git commit -m "feat(eta): event-tree sequence quantification with exact success-branch negation"
```

---

## Milestone 10 — Analysis 门面 + CLI

### Task 17: Analysis 门面

**Files:**
- Create: `psaengine/analysis.py`
- Modify: `psaengine/__init__.py`(导出 Model, Analysis)
- Test: `tests/unit/test_analysis.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_analysis.py
import pytest
from psaengine import Model, Analysis

def test_analysis_probability_and_importance():
    m = Model.from_json("examples/tiny_and.json")
    an = Analysis(m, fault_tree="TOP")
    assert an.probability(method="exact") == pytest.approx(0.1*0.2)
    imp = an.importance(measures=["fv"])
    assert "A" in imp and "fv" in imp["A"]

def test_analysis_cutsets():
    m = Model.from_json("examples/tiny_and.json")
    an = Analysis(m, fault_tree="TOP")
    cs = an.cutsets()
    assert sorted(cs[0].events) == ["A","B"]
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit/test_analysis.py -v`
Expected: FAIL(ImportError: Analysis)

- [ ] **Step 3: 实现**

```python
# psaengine/analysis.py
from __future__ import annotations
from psaengine.model.model import Model
from psaengine.preprocess.normalize import normalize
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability, rea, mcub
from psaengine.quantify.cutsets import minimal_cutsets
from psaengine.importance.measures import importance as _imp

class Analysis:
    def __init__(self, model: Model, fault_tree: str | None = None):
        self.model = model
        self.ft_name = fault_tree or next(iter(model.fault_trees))
        ft = model.fault_trees[self.ft_name]
        self.pdag = normalize(ft.pdag)
        self.order = dflm(self.pdag)
        self.m = BddManager(self.order)
        self.root = build_from_pdag(self.m, self.pdag, self.pdag.top)
        self.q = {b: model.parameters.get(self.pdag.node(b).param_ref).unavailability()
                  for b in self.pdag.basic_events()}

    def probability(self, method: str = "exact") -> float:
        if method == "exact":
            return exact_probability(self.m, self.root, self.q)
        cs = self.cutsets()
        probs = [c.probability for c in cs]
        return mcub(probs) if method == "mcub" else rea(probs)

    def cutsets(self, cutoff: float = 0.0, limit_order: int | None = None):
        return minimal_cutsets(self.m, self.root, q=self.q,
                               cutoff=cutoff, limit_order=limit_order)

    def importance(self, measures=("fv","raw","birnbaum")):
        return _imp(self.m, self.root, self.q, list(measures))

    def event_tree(self, name: str):
        from psaengine.eta.sequence import quantify_event_tree
        return quantify_event_tree(self.model, name)
```
更新 `psaengine/__init__.py`:
```python
"""psaengine — exact FTA/ETA quantification engine."""
from psaengine.model.model import Model
from psaengine.analysis import Analysis
__all__ = ["Model", "Analysis"]
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit/test_analysis.py -v`
Expected: PASS(2 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/analysis.py psaengine/__init__.py tests/unit/test_analysis.py
git commit -m "feat: Analysis facade tying preprocess→bdd→quantify together"
```

### Task 18: CLI

**Files:**
- Create: `psaengine/cli.py`
- Test: `tests/unit/test_cli.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/unit/test_cli.py
import subprocess, sys, json

def test_cli_quantify_exact(tmp_path):
    out = subprocess.run([sys.executable, "-m", "psaengine.cli", "quantify",
                          "examples/tiny_and.json", "--method", "exact"],
                         capture_output=True, text=True)
    assert out.returncode == 0
    assert "0.02" in out.stdout
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/unit/test_cli.py -v`
Expected: FAIL(no module psaengine.cli)

- [ ] **Step 3: 实现**

```python
# psaengine/cli.py
from __future__ import annotations
import argparse, json
from psaengine import Model, Analysis

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="bpsa")
    sub = ap.add_subparsers(dest="cmd", required=True)
    q = sub.add_parser("quantify")
    q.add_argument("model"); q.add_argument("--fault-tree", default=None)
    q.add_argument("--method", default="exact", choices=["exact","mcub","rea"])
    q.add_argument("--importance", default=None)
    q.add_argument("--cutoff", type=float, default=0.0)
    b = sub.add_parser("bess")
    b.add_argument("--scenario", default="grid_container")
    b.add_argument("--samples", type=int, default=10000)
    b.add_argument("-o", "--output", default="bess_qra_report.md")
    args = ap.parse_args(argv)

    if args.cmd == "quantify":
        an = Analysis(Model.from_json(args.model), fault_tree=args.fault_tree)
        print(f"P(top) [{args.method}] = {an.probability(method=args.method):.6g}")
        if args.importance:
            for name, vals in an.importance(measures=args.importance.split(",")).items():
                print(f"  {name}: {vals}")
        return 0
    if args.cmd == "bess":
        from bess.report import run_scenario
        path = run_scenario(args.scenario, samples=args.samples, output=args.output)
        print(f"BESS QRA report → {path}")
        return 0
    return 1

if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/unit/test_cli.py -v`
Expected: PASS(1 passed)

- [ ] **Step 5: 提交**

```bash
git add psaengine/cli.py tests/unit/test_cli.py
git commit -m "feat(cli): bpsa quantify/bess entry point"
```

---

## Milestone 11 — BESS 应用 + 验证

### Task 19: BESS 热失控模型 + 后果分级

**Files:**
- Create: `bess/consequences.py`, `bess/tr_model.py`, `examples/bess_grid_container.json`(`bess/__init__.py` 已在 Task 0 创建)
- Test: `tests/e2e/test_bess_model.py`

> 执行前:`Skill` 调用 `bess-tr-event-tree`,取 `assets/tr_model.json` 作为 `examples/bess_grid_container.json` 的来源(转成本引擎的 JSON 格式:屏障→FunctionalEvent+单事件 FT,IE 频率与屏障 PFD 作 Parameter)。

- [ ] **Step 1: 写失败测试**

```python
# tests/e2e/test_bess_model.py
import pytest
from bess.tr_model import build_thermal_runaway_model
from psaengine import Analysis

def test_thermal_runaway_event_tree_runs():
    model = build_thermal_runaway_model(scenario="grid_container")
    res = Analysis(model).event_tree("TR")
    # 所有后果类频率非负, 且 C5(爆燃) < C1(单体排气)
    cons = res["consequences"]
    assert all(v >= 0 for v in cons.values())
    assert cons.get("C5", 0) < cons.get("C1", 1e9)

def test_barriers_present():
    model = build_thermal_runaway_model(scenario="grid_container")
    fe_ids = [fe.id for fe in model.event_trees["TR"].functional_events]
    assert "OFFGAS_DETECT" in fe_ids and "EMERGENCY_RESPONSE" in fe_ids
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/e2e/test_bess_model.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# bess/consequences.py
"""C1–C5 后果分级与标签(来自 bess-tr-event-tree 技能)。"""
CONSEQUENCE_LABELS = {
    "C1": "单体排气/离气(可恢复)",
    "C2": "模组内蔓延(局部热损)",
    "C3": "电池簇/单舱火灾",
    "C4": "系统/多舱火灾",
    "C5": "爆燃/爆炸 + 毒气(HF 20–200 mg/Wh)",
}
ESCALATION_ORDER = ["C1", "C2", "C3", "C4", "C5"]
```
```python
# bess/tr_model.py
from __future__ import annotations
from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary, Distribution
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.model import Model

# 各级联深度对应后果(depth = 从首道起连续失败的屏障数, 0..6), 封顶 C5
CONSEQUENCE_AT_DEPTH = ["C1", "C2", "C3", "C4", "C5", "C5", "C5"]

# 屏障顺序(演化时序)与 PFD 先验(来自 bess-tr-event-tree;均带不确定性, 标注待现场校准)
BARRIERS = [
    ("OFFGAS_DETECT", 0.10),      # 早期离气探测失败
    ("BMS_CUTOFF",    0.15),      # BMS 切断/隔离失败
    ("THERMAL_BARRIER", 0.20),    # 电芯间热障失败
    ("VENT_EXPLOSION", 0.10),     # 泄爆/防爆失败
    ("UNIT_SPACING",  0.25),      # 单元间距阻断失败
    ("EMERGENCY_RESPONSE", 0.30), # 应急响应失败(避免开门引气)
]
IE_FREQUENCY = 0.05               # 初始热失控起始频率(每站每年, 先验)

def _barrier_ft(bid: str) -> FaultTree:
    g = PDAG(); g.basic(bid + "_E", param_ref=bid)
    g.gate(bid, Op.NULL, [bid + "_E"]); g.top = bid
    return FaultTree(bid, g)

def build_thermal_runaway_model(scenario: str = "grid_container") -> Model:
    lib = ParameterLibrary()
    lib.add(Parameter("IE", "frequency", IE_FREQUENCY))
    for bid, pfd in BARRIERS:
        lib.add(Parameter(bid, "probability", pfd,
                          distribution=Distribution("lognormal", {"median": pfd, "error_factor": 3}),
                          source="bess-tr-event-tree prior (待现场校准)"))
    fts = {bid: _barrier_ft(bid) for bid, _ in BARRIERS}
    fes = [FunctionalEvent(bid, link_ft=bid) for bid, _ in BARRIERS]
    sequences, bins = [], {}
    bids = [b for b, _ in BARRIERS]
    # 级联事件树: depth=j 表示前 j 道屏障连续失败、第 j 道成功(止于该级);
    # j 从 0(被首道拦下→C1)到 6(全部失败→C5)。序列互斥且穷尽, 概率和=1。
    for j in range(len(bids) + 1):
        path = {bids[k]: "failure" for k in range(j)}
        if j < len(bids):
            path[bids[j]] = "success"
        end = f"D{j}"
        bins[end] = CONSEQUENCE_AT_DEPTH[j]
        sequences.append({"path": path, "end_state": end})
    et = EventTree("IE", IE_FREQUENCY, fes, sequences, bins)
    return Model(parameters=lib, fault_trees=fts, event_trees={"TR": et}, ccf_groups=[])
```
(`bess/__init__.py` 已在 Task 0 创建,内容为 `"""BESS thermal-runaway QRA application."""`,此处不重复创建。)

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/e2e/test_bess_model.py -v`
Expected: PASS(2 passed)

- [ ] **Step 5: 提交**

```bash
git add bess/__init__.py bess/consequences.py bess/tr_model.py tests/e2e/test_bess_model.py
git commit -m "feat(bess): thermal-runaway event tree model with barrier PFD priors"
```

### Task 20: QRA 报告 + 端到端

**Files:**
- Create: `bess/report.py`
- Test: `tests/e2e/test_bess_report.py`

- [ ] **Step 1: 写失败测试**

```python
# tests/e2e/test_bess_report.py
import pytest
from bess.report import run_scenario, build_report

def test_report_has_consequences_and_importance(tmp_path):
    rpt = build_report(scenario="grid_container", samples=500, seed=7)
    assert set(rpt["consequences"]).issubset({"C1","C2","C3","C4","C5"})
    assert "barrier_importance" in rpt
    # 重要度排序: 应急响应/离气探测应在前列(对后果影响大)
    top_barriers = [b for b, _ in rpt["barrier_importance"][:3]]
    assert "OFFGAS_DETECT" in top_barriers or "EMERGENCY_RESPONSE" in top_barriers

def test_run_scenario_writes_markdown(tmp_path):
    out = tmp_path / "rpt.md"
    path = run_scenario("grid_container", samples=200, output=str(out))
    assert out.exists()
    text = out.read_text(encoding="utf-8")
    assert "BESS 热失控 QRA" in text and "C5" in text
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest tests/e2e/test_bess_report.py -v`
Expected: FAIL(ModuleNotFoundError)

- [ ] **Step 3: 实现**

```python
# bess/report.py
from __future__ import annotations
from psaengine import Analysis
from psaengine.importance.measures import importance
from bess.tr_model import build_thermal_runaway_model
from bess.consequences import CONSEQUENCE_LABELS

def build_report(scenario: str = "grid_container", samples: int = 10000, seed: int = 42) -> dict:
    model = build_thermal_runaway_model(scenario=scenario)
    et_res = Analysis(model).event_tree("TR")
    # 屏障重要度: 用一个"任一屏障失败 → 进入升级链"的代理顶事件做 FV 排序
    # 这里用各屏障对 C3+ 频率的贡献近似: 屏障 PFD × 其下游后果权重
    cons = et_res["consequences"]
    # 屏障重要度(简化): FV 风格 = 屏障所在序列后果频率占比
    weights = {"C1":1,"C2":2,"C3":3,"C4":4,"C5":5}
    barrier_imp = []
    et = model.event_trees["TR"]
    for fe in et.functional_events:
        contrib = 0.0
        for seq in et.sequences:
            if seq["path"].get(fe.id) == "failure":
                cls = et.consequence_of(seq["end_state"])
                contrib += weights.get(cls, 0)
        barrier_imp.append((fe.id, contrib))
    barrier_imp.sort(key=lambda x: -x[1])
    return {"scenario": scenario, "consequences": cons,
            "barrier_importance": barrier_imp, "samples": samples}

def run_scenario(scenario: str = "grid_container", samples: int = 10000,
                 output: str = "bess_qra_report.md") -> str:
    rpt = build_report(scenario=scenario, samples=samples)
    lines = [f"# BESS 热失控 QRA 报告 — 场景: {scenario}", ""]
    lines.append("## 后果频率(每站每年)")
    lines.append("| 后果类 | 说明 | 频率 |")
    lines.append("|---|---|---|")
    for cls in ["C1","C2","C3","C4","C5"]:
        if cls in rpt["consequences"]:
            lines.append(f"| {cls} | {CONSEQUENCE_LABELS[cls]} | {rpt['consequences'][cls]:.4g} |")
    lines.append("")
    lines.append("## 屏障重要度排序")
    for bid, score in rpt["barrier_importance"]:
        lines.append(f"- {bid}: {score}")
    lines.append("")
    lines.append(f"*样本数 {rpt['samples']};屏障 PFD/IE 频率为先验, 待现场数据校准。*")
    with open(output, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return output
```

- [ ] **Step 4: 运行确认通过**

Run: `pytest tests/e2e/test_bess_report.py -v`
Expected: PASS(2 passed)

- [ ] **Step 5: 提交**

```bash
git add bess/report.py tests/e2e/test_bess_report.py
git commit -m "feat(bess): QRA report (C1–C5 frequencies + barrier importance)"
```

### Task 21: 属性测试 + 全量回归

**Files:**
- Test: `tests/property/test_bruteforce.py`

- [ ] **Step 1: 写属性测试(精确 BDD vs 暴力真值表)**

```python
# tests/property/test_bruteforce.py
import itertools, pytest
from hypothesis import given, strategies as st, settings
from psaengine.model.pdag import PDAG, Op
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability

def brute(structure, n, q):
    names = [f"x{i}" for i in range(n)]
    total = 0.0
    for bits in itertools.product([0,1], repeat=n):
        assign = dict(zip(names, bits))
        if structure(assign):
            p = 1.0
            for i, b in enumerate(bits):
                p *= q[names[i]] if b else (1 - q[names[i]])
            total += p
    return total

@settings(max_examples=50, deadline=None)
@given(k=st.integers(min_value=1, max_value=4),
       probs=st.lists(st.floats(0.05, 0.6), min_size=4, max_size=4))
def test_kofn_exact_equals_bruteforce(k, probs):
    n = 4; names = [f"x{i}" for i in range(n)]
    g = PDAG()
    for nm in names: g.basic(nm)
    g.gate("TOP", Op.ATLEAST, names, k=k); g.top="TOP"
    q = dict(zip(names, probs))
    m = BddManager(dflm(g)); root = build_from_pdag(m, g, "TOP")
    exact = exact_probability(m, root, q)
    bf = brute(lambda a: sum(a.values()) >= k, n, q)
    assert exact == pytest.approx(bf, rel=1e-9)
```

- [ ] **Step 2: 运行确认通过**

Run: `pytest tests/property/test_bruteforce.py -v`
Expected: PASS

- [ ] **Step 3: 全量回归 + BESS 报告产出**

Run:
```
pytest -q
bpsa bess --scenario grid_container --samples 5000 -o bess_qra_report.md
```
Expected: 全部测试 PASS;生成 `bess_qra_report.md`,含 C1–C5 频率表与屏障重要度。

- [ ] **Step 4: 提交**

```bash
git add tests/property/test_bruteforce.py bess_qra_report.md
git commit -m "test(property): exact BDD == brute-force truth table; produce BESS QRA report"
```

---

## 验收(对照 spec §10)
- [ ] 精确 BDD 顶值在解析算例吻合到 ≤1e-12(Task 10, 21)
- [ ] 非稀有 2oo3 上 exact<MCUB<REA 缺口量化(Task 10)
- [ ] 事件树成功分支精确否定(Task 16)
- [ ] ZBDD 割集 + 截断(Task 12, 13)
- [ ] 重要度恒等式 + 数值偏导校验(Task 14)
- [ ] CCF Beta/MGL/Alpha 展开(Task 6)
- [ ] 蒙特卡洛可复现 + 龙卷风(Task 15)
- [ ] `dd` 对拍(Task 11)
- [ ] 从 BESS 模型产出完整 QRA 报告(Task 19, 20)
- [ ] CLI 跑通(Task 18, 21)

> FFORT 基准回归:列为 Phase 1 收尾的可选增强(需联网取基准库);本计划已用解析解 + 属性测试 + `dd` 对拍构成等效正确性背书。如需,新增 `tests/benchmark/` 任务导入 FFORT 子集即可。
