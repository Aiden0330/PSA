from __future__ import annotations
from dataclasses import dataclass, field
from math import isfinite
from numbers import Real
from typing import Optional

# 序列分支的规范枚举:装载边界严格 success|failure(EB-05/O1)。
# 大小写/空白变体(如 'FAILURE')与拼写错误在此点名拒绝,绝不静默按 success 处理
# —— quantify_event_tree 内 `branch == "failure"` 的判断由本层保证输入合法。
_BRANCHES = ("success", "failure")

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

    def __post_init__(self):
        # EB-05/O1 数值域:初因频率必须 finite 且 ≥ 0(静默负/NaN 频率不可接受)。
        f = self.init_frequency
        if not isinstance(f, Real) or isinstance(f, bool) or not isfinite(f) or f < 0:
            raise ValueError(
                f"init_frequency must be a finite number >= 0, got {f!r} "
                f"(event tree init_event={self.init_event!r})")
        # EB-05/O1 branch:序列 path 值严格枚举 success|failure(含大小写/空白变体点名拒绝)。
        for seq in self.sequences:
            for fe_id, branch in seq.get("path", {}).items():
                if branch not in _BRANCHES:
                    raise ValueError(
                        f"event-tree sequence branch for functional event '{fe_id}' "
                        f"must be 'success' or 'failure', got {branch!r} "
                        f"(end_state={seq.get('end_state')!r})")

    def consequence_of(self, end_state: str) -> str:
        return self.consequence_bins[end_state]
