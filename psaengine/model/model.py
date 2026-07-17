from __future__ import annotations
from dataclasses import dataclass, field
from typing import TYPE_CHECKING
from psaengine.model.parameters import ParameterLibrary
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree
from psaengine.model.ccf import CCFGroup

if TYPE_CHECKING:                                    # 避免与 rebind.py / postprocess.py 循环导入
    from psaengine.model.rebind import RebindRule
    from psaengine.quantify.postprocess import PostRule

@dataclass
class Model:
    parameters: ParameterLibrary
    fault_trees: dict[str, FaultTree] = field(default_factory=dict)
    event_trees: dict[str, EventTree] = field(default_factory=dict)
    ccf_groups: list[CCFGroup] = field(default_factory=list)
    # 边界条件集(RiskSpectrum boundary condition sets):命名的 house 事件状态组,
    # 分析时按名引用 → 维修/配置态一键切换(4a2)
    bc_sets: dict[str, dict[str, bool]] = field(default_factory=dict)
    # regime-A 条件参数重绑定(配置依赖的数据语义,与 bc_sets 同性质;非分析级显示过滤)。
    # 有效库视图经 psaengine.model.rebind.effective_parameters,模型本体绝不改写。
    rebind_rules: list["RebindRule"] = field(default_factory=list)
    # 割集后处理规则之家(MEF <define-substitution> 互换)。分析请求仍可临时传 rules,
    # 优先级:请求显式 > model.post_rules。
    post_rules: list["PostRule"] = field(default_factory=list)

    @classmethod
    def from_json(cls, path: str) -> "Model":
        from psaengine.model.json_io import load_model
        return load_model(path)

    def to_json(self, path: str) -> None:
        from psaengine.model.json_io import save_model
        save_model(self, path)
