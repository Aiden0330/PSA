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
