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
    kind: str    # probability|rate|frequency|exponential|glm|weibull|periodic_test
    value: float
    mttr: Optional[float] = None
    test_interval: Optional[float] = None
    mission_time: Optional[float] = None
    # Gap 7 精确 Q(t) 模型字段(规格 2026-07-15-gap7;MEF/SCRAM/XFTA 同一公式集):
    gamma: Optional[float] = None       # glm 需求失效概率 γ(缺省 0)
    alpha: Optional[float] = None       # weibull 尺度 α>0
    beta: Optional[float] = None        # weibull 形状 β>0
    t0: Optional[float] = None          # weibull 时移 t0≥0(缺省 0)
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
            if lam < 0:
                # review F4:负 λ 经 λ·MTTR 得负 q,再被频率通道的 cutoff 过滤静默吞掉
                # ——垃圾输入变成貌似合理的低估;在源头响亮拒绝。
                raise ValueError(f"rate {self.id}={lam} must be >= 0")
            if self.mttr is not None:
                q = lam * self.mttr
            elif self.test_interval is not None:
                q = lam * self.test_interval / 2.0
            elif self.mission_time is not None:
                q = lam * self.mission_time
            else:
                raise ValueError(f"rate {self.id} needs mttr|test_interval|mission_time")
            if q < 0:
                # review R-1(round-2):负 mttr/test_interval/mission_time 得负 q,
                # 会被频率通道的 cutoff≥0 过滤静默吞成 F=0 —— 与负 λ 同门,源头拒绝。
                raise ValueError(f"rate {self.id}: computed q={q} < 0 (negative time parameter?)")
            return min(q, 1.0)
        if self.kind == "exponential":
            # Gap 7:Q = 1−e^{−λt}(精确;rate+mission_time 的 λt 为其线性化,恒高估)
            lam = self.value
            if lam < 0:
                raise ValueError(f"exponential {self.id}: rate {lam} must be >= 0")
            if self.mission_time is None or self.mission_time < 0:
                raise ValueError(f"exponential {self.id} needs mission_time >= 0")
            from math import expm1
            return -expm1(-lam * self.mission_time)   # 1−e^{−x} 的无消去形(review G 抛光)
        if self.kind == "glm":
            # Gap 7:Q = γe^{−(λ+μ)t} + λ/(λ+μ)(1−e^{−(λ+μ)t});t 缺省 → 稳态 λ/(λ+μ)。
            # μ = 1/mttr;γ = 需求失效概率(缺省 0)。MEF §5 / XFTA eq 6.5 / SCRAM Glm 同式。
            lam = self.value
            if lam < 0:
                raise ValueError(f"glm {self.id}: rate {lam} must be >= 0")
            if self.mttr is None or self.mttr <= 0:
                raise ValueError(f"glm {self.id} needs mttr > 0")
            g = self.gamma if self.gamma is not None else 0.0
            if not 0.0 <= g <= 1.0:
                raise ValueError(f"glm {self.id}: gamma {g} out of [0,1]")
            mu = 1.0 / self.mttr
            r = lam + mu
            if self.mission_time is None:
                return lam / r
            if self.mission_time < 0:
                raise ValueError(f"glm {self.id}: mission_time must be >= 0")
            from math import exp, expm1
            e = exp(-r * self.mission_time)
            return g * e + (lam / r) * (-expm1(-r * self.mission_time))
        if self.kind == "weibull":
            # Gap 7:Q = 1−e^{−((t−t0)/α)^β},t≤t0 → 0(老化/早夭;β=1 退化为指数)
            if self.alpha is None or self.alpha <= 0:
                raise ValueError(f"weibull {self.id} needs alpha > 0")
            if self.beta is None or self.beta <= 0:
                raise ValueError(f"weibull {self.id} needs beta > 0")
            if self.mission_time is None or self.mission_time < 0:
                raise ValueError(f"weibull {self.id} needs mission_time >= 0")
            shift = self.t0 if self.t0 is not None else 0.0
            if shift < 0:
                raise ValueError(f"weibull {self.id}: t0 must be >= 0")
            dt = self.mission_time - shift
            if dt <= 0:
                return 0.0
            from math import exp
            return 1.0 - exp(-((dt / self.alpha) ** self.beta))
        if self.kind == "periodic_test":
            # Gap 7:周期平均 q̄ = 1−(1−e^{−λτ})/(λτ)(3 参形逐周期积分,
            # Vesely/NUREG-0492;λτ/2 为其一阶近似,恒高估)。瞬时曲线/10 参 Complete 留 v2。
            lam = self.value
            if lam < 0:
                raise ValueError(f"periodic_test {self.id}: rate {lam} must be >= 0")
            if self.test_interval is None or self.test_interval <= 0:
                raise ValueError(f"periodic_test {self.id} needs test_interval > 0")
            x = lam * self.test_interval
            if x == 0.0:
                return 0.0
            # review 365e7e5 G1:1−(1−e^{−x})/x 在 x≲1e-6 灾难性消去——x=1e-9 实测 56× 高估,
            # 扫描 [1e-15,1e-6] 有 772/2000 点返回**负值**并静默流入概率通道。
            # 小 x 用泰勒级数(x/2 − x²/6 + x³/24,截断误差 O(x⁴) 在 x<1e-4 时 <1e-17 相对),
            # 大 x 用 expm1 无消去形;q̄∈[0,1] 由性质测试全域锁定。
            if x < 1e-4:
                return x / 2.0 - x * x / 6.0 + x ** 3 / 24.0
            from math import expm1
            return 1.0 + expm1(-x) / x
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
