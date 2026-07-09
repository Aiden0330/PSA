from __future__ import annotations
from dataclasses import dataclass

@dataclass
class CCFGroup:
    id: str
    members: list[str]
    model: str                          # beta|mgl|alpha|phi
    factors: dict                       # beta/gamma/…(MGL ρ_2..)、alpha1..m、phi1..m
    staggered: bool = False             # 错峰检验(仅 alpha;NUREG/CR-5485 Table 5-11)
