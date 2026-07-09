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
    # 边界条件集(RiskSpectrum boundary condition sets):命名的 house 事件状态组,
    # 分析时按名引用 → 维修/配置态一键切换(4a2)
    bc_sets: dict[str, dict[str, bool]] = field(default_factory=dict)

    @classmethod
    def from_json(cls, path: str) -> "Model":
        from psaengine.model.json_io import load_model
        return load_model(path)

    def to_json(self, path: str) -> None:
        from psaengine.model.json_io import save_model
        save_model(self, path)
