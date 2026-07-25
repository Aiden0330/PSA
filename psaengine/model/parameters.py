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
    gamma: Optional[float] = None       # glm 需求失效概率 γ(缺省 0)/ Complete 检验致害 γ
    alpha: Optional[float] = None       # weibull 尺度 α>0
    beta: Optional[float] = None        # weibull 形状 β>0
    t0: Optional[float] = None          # weibull 时移 t0≥0(缺省 0)
    # periodic_test_complete(banked 规格 2026-07-15;SCRAM 11 参 Complete 同语义):
    # value=λ 运行期率 · lambda_test=λ* 检验期率 · mttr→μ=1/mttr · test_interval=τ ·
    # theta=θ 首检时刻 · test_duration=π 检验时长 · available_at_test=x(必填,不设默认
    # ——方向依场景而异,静默默认即口径事故)· sigma=σ 检出覆盖 · omega=ω 修后坏重启 ·
    # mission_time=t 求值时刻。既有 kind 零扰动(全部 Optional 缺省 None)。
    lambda_test: Optional[float] = None
    theta: Optional[float] = None
    test_duration: Optional[float] = None
    available_at_test: Optional[bool] = None
    sigma: Optional[float] = None
    omega: Optional[float] = None
    distribution: Optional[Distribution] = None
    source: Optional[str] = None
    version: Optional[str] = None
    # CCF 组内认知联动(规格 2026-07-17-ccf-group-sokc-linkage,semver 0.4.0):
    # 铸参(CCF 展开产物)标记其**认知来源** ref —— MC 抽样时不独立抽,而是随源参数
    # 的抽样因子整组共乘(q_levels 对 Q_t 线性)。普通参数恒 None(零扰动边界)。
    epistemic_source: Optional[str] = None

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
            from math import expm1
            # −expm1 与 exponential 同形(round-3 注记 2):β=1 时与 exponential 逐位退化
            return -expm1(-((dt / self.alpha) ** self.beta))
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
            # 小 x 用泰勒级数(x/2 − x²/6 + x³/24;x=1e-4 处截断误差绝对 ~8e-19、相对 ~1.7e-14,
            # 远小于 rel-1e-9 锁);大 x 用 expm1 无消去形;q̄∈[0,1] 由性质测试全域锁定。
            if x < 1e-4:
                return x / 2.0 - x * x / 6.0 + x ** 3 / 24.0
            from math import expm1
            return 1.0 + expm1(-x) / x
        if self.kind == "periodic_test_complete":
            return _ptc_q(self, self.mission_time, require_t=True)
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


# ── periodic_test_complete:三态 Markov {可用 A, 潜伏失效 L, 在修 R} 分相闭式 ──────
# 规范语义源:SCRAM PeriodicTest::Complete 逐行(banked 规格 §2,评审 round-1 PASS);
# 三角验证:float ↔ Decimal-60 ↔ 独立离散事件 MC(2M×2 seeds |z|<1)。
# 数值卫生(§3,违者锚点即红):p_exp 一律 −expm1;p_exp2 禁朴素形
# (λp_μ−μp_λ)/(λ−μ)——λ≈μ 时相对误差 1.8e0 且得负概率,必须用稳定形。

def _ptc_validate(p: Parameter) -> None:
    pid = p.id
    if p.value is None or p.value < 0:
        raise ValueError(f"periodic_test_complete {pid}: lambda {p.value!r} must be >= 0")
    if p.lambda_test is None or p.lambda_test < 0:
        raise ValueError(f"periodic_test_complete {pid}: needs lambda_test >= 0")
    if p.mttr is None or p.mttr <= 0:
        raise ValueError(f"periodic_test_complete {pid}: needs mttr > 0")
    if p.test_interval is None or p.test_interval <= 0:
        raise ValueError(f"periodic_test_complete {pid}: needs test_interval > 0")
    if p.theta is None or p.theta < 0:
        raise ValueError(f"periodic_test_complete {pid}: needs theta >= 0")
    if p.test_duration is None or not 0.0 < p.test_duration < p.test_interval:
        raise ValueError(f"periodic_test_complete {pid}: needs 0 < test_duration < test_interval "
                         f"(got pi={p.test_duration!r}, tau={p.test_interval!r};严格,较 SCRAM 更紧)")
    if not isinstance(p.available_at_test, bool):
        # 评审 F1:仅查 None 会让字符串 "false" 经 bool() 强转按 True 记账——窗内 q 由
        # 1.0 滑到 0.079(12.6× 静默低估)。类型严判,拒绝一切非 bool。
        raise ValueError(f"periodic_test_complete {pid}: needs available_at_test (strict bool, "
                         "不设默认——检验期间可用性方向依场景而异,静默默认/强转即口径事故)")
    if p.gamma is None or not 0.0 <= p.gamma <= 1.0:
        raise ValueError(f"periodic_test_complete {pid}: needs gamma in [0,1]")
    if p.sigma is None or not 0.0 <= p.sigma <= 1.0:
        raise ValueError(f"periodic_test_complete {pid}: needs sigma in [0,1]")
    if p.omega is None or not 0.0 <= p.omega <= 1.0:
        raise ValueError(f"periodic_test_complete {pid}: needs omega in [0,1]")


def _ptc_q(p: Parameter, t: Optional[float], *, require_t: bool) -> float:
    from math import exp, expm1
    _ptc_validate(p)
    if t is None or t < 0:
        if require_t or t is not None:
            raise ValueError(f"periodic_test_complete {p.id}: needs mission_time >= 0")
    lam, lam_t, mu = p.value, p.lambda_test, 1.0 / p.mttr
    tau, theta, g0 = p.test_interval, p.theta, p.gamma
    pi_, x, sig, om = p.test_duration, bool(p.available_at_test), p.sigma, p.omega

    def p_exp(r: float, tt: float) -> float:
        return -expm1(-r * tt)

    def p_exp2(tt: float) -> float:
        # 稳定形 1 − e^{−λt}(1 + λg), g = expm1(δt)/δ, δ = λ−μ(δ=0 → g=t)。
        # 朴素形 (λp_μ−μp_λ)/(λ−μ) 在 λ≈μ 灾难性消去(锚点 A9 以 δ/λ≈1e-12 强制)。
        dlt = lam - mu
        g = tt if dlt == 0.0 else expm1(dlt * tt) / dlt
        return 1.0 - exp(-lam * tt) * (1.0 + lam * g)

    if t <= theta:                                   # ≤:t=θ 走纯老化(评审 D1,锚点 A1b)
        return p_exp(lam, t)

    p_fail = p_exp(lam, theta)
    p_repair = 0.0
    p_avail = 1.0 - p_fail

    def p_ml(p_mu: float, tt: float) -> float:
        # 修完:ω 坏重启→潜伏;否则回可用后再以 λ 老化(修后用 λ 非 λ*,即使身处检验窗)
        return p_mu * om + (1.0 - om) * p_exp2(tt)

    def p_test(w: float, available: bool) -> None:
        nonlocal p_fail, p_repair, p_avail
        p_lt, p_mu = p_exp(lam_t, w), p_exp(mu, w)
        tr = p_fail + p_avail * (g0 + (1.0 - g0) * p_lt)      # 潜伏池:窗前 + γ 冲击 + 检中 λ*
        nf = p_repair * p_ml(p_mu, w) + (1.0 - sig) * tr      # 修出再失效者跳过当窗检出
        nr = (1.0 - p_mu) * p_repair + sig * tr               # σ 检出 → 窗末起修
        na = 1.0 - nf - nr - (0.0 if available
                              else p_avail * (1.0 - g0) * (1.0 - p_lt))
        p_fail, p_repair, p_avail = nf, nr, na

    def p_period(dd: float) -> None:
        nonlocal p_fail, p_repair, p_avail
        p_lam, p_mu = p_exp(lam, dd), p_exp(mu, dd)
        p_fail = p_avail * p_lam + p_fail + p_repair * p_ml(p_mu, dd)
        p_repair = p_repair * (1.0 - p_mu)
        p_avail = 1.0 - p_fail - p_repair

    delta = t - theta
    n = int(delta / tau)                             # C 截断语义(整周期数;误差 O(n·ε),A8 锁)
    for _ in range(n):
        p_test(pi_, True)
        p_period(tau - pi_)
    rem = delta - n * tau
    if rem <= pi_:
        p_test(rem, x)                               # 部分窗同样施加 σ 检出;x 仅在此记账
    else:
        p_test(pi_, True)
        p_period(rem - pi_)
    q = 1.0 - p_avail
    if q < -1e-9 or q > 1.0 + 1e-9:                  # 结构性违界响亮;舍入毛刺夹持(§3)
        raise ValueError(f"periodic_test_complete {p.id}: q={q!r} structurally out of [0,1]")
    return min(max(q, 0.0), 1.0)


def periodic_test_complete_curve(p: Parameter, ts: list[float]) -> list[float]:
    """UI 曲线助手(banked 规格 §1):逐点采样 q(t),纯采样无新数学。"""
    return [_ptc_q(p, float(tt), require_t=True) for tt in ts]
