from __future__ import annotations
from dataclasses import dataclass

@dataclass
class CCFGroup:
    id: str
    members: list[str]
    model: str                          # beta|mgl|alpha|phi
    factors: dict                       # e.g. {"beta":0.05} / {"beta":..,"gamma":..}
