from __future__ import annotations
from dataclasses import dataclass, field

from psaengine.quantify.cutsets import CutSet

# 4a3 割集后处理(parity 缺口 #3,RiskSpectrum post-processing 对应物)。
#
# 设计边界(与精确否定架构的关系,账本要求「spec carefully」):
# 规则只作用于 **提取出的 MCS 列表**(ZBDD/MOCUS 之后),不触碰 BDD 概率通道 ——
# `Analysis.probability(method="exact")` 始终是未后处理模型的精确值(卖点不受损)。
# 后处理列表的概率估计用 REA/MCUB(与 RiskSpectrum 的 MCS 级语义一致)。


@dataclass
class PostRule:
    """kind:
    - "mutually_exclusive": events 为互斥组,割集含其中 ≥2 个 → 删(维修态互斥等)。
    - "delete_contains":   割集 ⊇ events → 删(RS delete rules)。
    - "recovery":          割集 ⊇ events → 追加恢复事件 add_event(概率 prob),
                            割集概率 ×prob、阶 +1(RS recovery rules)。
    """
    kind: str
    events: list[str] = field(default_factory=list)
    add_event: str | None = None
    prob: float | None = None

    @classmethod
    def from_dict(cls, d: dict) -> "PostRule":
        r = cls(d["kind"], list(d.get("events", [])), d.get("add_event"), d.get("prob"))
        if r.kind not in ("mutually_exclusive", "delete_contains", "recovery"):
            raise ValueError(f"unknown post-processing rule kind '{r.kind}'")
        if r.kind == "mutually_exclusive" and len(r.events) < 2:
            raise ValueError("mutually_exclusive rule needs >=2 events")
        if r.kind == "delete_contains" and not r.events:
            raise ValueError("delete_contains rule needs >=1 event")
        if r.kind == "recovery":
            if not r.add_event:
                raise ValueError("recovery rule needs add_event")
            if r.prob is None or not 0.0 <= r.prob <= 1.0:
                raise ValueError("recovery rule needs prob in [0,1]")
        return r


def apply_post_rules(cutsets: list[CutSet], rules: list[PostRule]) -> tuple[list[CutSet], dict]:
    """按序应用规则。返回 (处理后割集, 统计 {removed, recovered});
    幂等安全:recovery 不重复追加已含的恢复事件。"""
    removed = 0
    recovered = 0
    out: list[CutSet] = []
    for c in cutsets:
        ev = set(c.events)
        drop = False
        for r in rules:
            if r.kind == "mutually_exclusive" and len(ev & set(r.events)) >= 2:
                drop = True
                break
            if r.kind == "delete_contains" and set(r.events) <= ev:
                drop = True
                break
        if drop:
            removed += 1
            continue
        events, order, p = list(c.events), c.order, c.probability
        for r in rules:
            if r.kind == "recovery" and set(r.events) <= ev and r.add_event not in ev:
                events = sorted(events + [r.add_event])
                ev.add(r.add_event)
                order += 1
                p *= float(r.prob)
                recovered += 1
        out.append(CutSet(events, order, p))
    out.sort(key=lambda c: (-c.probability, c.order, c.events))
    return out, {"removed": removed, "recovered": recovered}
