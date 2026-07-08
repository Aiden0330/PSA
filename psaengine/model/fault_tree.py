from __future__ import annotations
from dataclasses import dataclass
from psaengine.model.pdag import PDAG

@dataclass
class FaultTree:
    top: str
    pdag: PDAG
