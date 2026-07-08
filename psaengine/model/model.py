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
