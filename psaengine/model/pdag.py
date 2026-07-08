from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

class Op(Enum):
    AND = "and"; OR = "or"; NOT = "not"; ATLEAST = "atleast"; XOR = "xor"; NULL = "null"

@dataclass
class Node:
    id: str
    is_basic: bool = False
    is_house: bool = False
    state: Optional[bool] = None        # house 事件常量
    op: Optional[Op] = None
    args: list[str] = field(default_factory=list)
    k: Optional[int] = None             # ATLEAST 的表决数
    param_ref: Optional[str] = None     # basic 事件引用的参数 id

class PDAG:
    def __init__(self) -> None:
        self.nodes: dict[str, Node] = {}
        self.top: Optional[str] = None

    def basic(self, nid: str, param_ref: Optional[str] = None) -> str:
        if nid not in self.nodes:
            self.nodes[nid] = Node(nid, is_basic=True, param_ref=param_ref or nid)
        return nid

    def house(self, nid: str, state: bool) -> str:
        self.nodes[nid] = Node(nid, is_house=True, state=state)
        return nid

    def gate(self, nid: str, op: Op, args: list[str], k: Optional[int] = None) -> str:
        if op is Op.ATLEAST:
            if k is None or k > len(args):
                raise ValueError(f"ATLEAST {nid}: k={k} > n={len(args)}")
        self.nodes[nid] = Node(nid, op=op, args=list(args), k=k)
        self.top = nid
        return nid

    def node(self, nid: str) -> Node:
        return self.nodes[nid]

    def basic_events(self) -> set[str]:
        return {n.id for n in self.nodes.values() if n.is_basic}

    def validate(self) -> None:
        for n in self.nodes.values():
            for a in n.args:
                if a not in self.nodes:
                    raise ValueError(f"undefined arg '{a}' in gate '{n.id}'")
