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
            # 量纲护栏(规格 2026-07-13 §2.1):频率(/yr)不是概率,误入概率通道必须响亮——
            # 频率量化走 psaengine.quantify.frequency.fault_tree_frequency(每割集一频率规则)。
            raise ValueError(
                f"frequency parameter {self.id} used in probability context; "
                "use quantify.frequency.fault_tree_frequency for IE frequency trees")
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
