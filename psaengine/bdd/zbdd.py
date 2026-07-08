from __future__ import annotations

# ZBDD 句柄: 0=EMPTY(空族), 1=BASE(含空集的族 {∅})。
# 内部节点 (var, hi, lo): hi=含 var 的子族, lo=不含 var 的子族。
# 零抑制规则: hi==EMPTY → 返回 lo。

class ZbddManager:
    EMPTY = 0
    BASE = 1

    def __init__(self, var_order: list[str]):
        self.var_order = list(var_order)
        self.idx = {v: i for i, v in enumerate(var_order)}
        self._nodes: dict[int, tuple[int, int, int]] = {}
        self._unique: dict[tuple[int, int, int], int] = {}
        self._next = 2

    def _getnode(self, var: int, hi: int, lo: int) -> int:
        if hi == self.EMPTY:                 # 零抑制
            return lo
        key = (var, hi, lo)
        if key in self._unique: return self._unique[key]
        h = self._next; self._next += 1
        self._nodes[h] = (var, hi, lo); self._unique[key] = h
        return h

    def _top(self, p: int) -> int:
        if p in (0, 1): return len(self.var_order)
        return self._nodes[p][0]

    def set_of(self, sets: list[set[str]]) -> int:
        result = self.EMPTY
        for s in sets:
            result = self.union(result, self._single(s))
        return result

    def _single(self, s: set[str]) -> int:
        p = self.BASE
        for v in sorted(s, key=lambda x: self.idx[x], reverse=True):
            p = self._getnode(self.idx[v], p, self.EMPTY)
        return p

    def union(self, p: int, q: int) -> int:
        if p == self.EMPTY: return q
        if q == self.EMPTY: return p
        if p == q: return p
        if p == self.BASE: return self._add_base(q)
        if q == self.BASE: return self._add_base(p)
        pv, qv = self._top(p), self._top(q)
        if pv < qv:
            v, hi, lo = self._nodes[p]; return self._getnode(v, hi, self.union(lo, q))
        if qv < pv:
            v, hi, lo = self._nodes[q]; return self._getnode(v, hi, self.union(p, lo))
        pv_, ph, pl = self._nodes[p]; qv_, qh, ql = self._nodes[q]
        return self._getnode(pv_, self.union(ph, qh), self.union(pl, ql))

    def _add_base(self, p: int) -> int:
        if p == self.EMPTY: return self.BASE
        if p == self.BASE: return self.BASE
        v, hi, lo = self._nodes[p]; return self._getnode(v, hi, self._add_base(lo))

    def count(self, p: int) -> int:
        if p == self.EMPTY: return 0
        if p == self.BASE: return 1
        v, hi, lo = self._nodes[p]; return self.count(hi) + self.count(lo)

    def to_sets(self, p: int) -> list[set[str]]:
        if p == self.EMPTY: return []
        if p == self.BASE: return [set()]
        v, hi, lo = self._nodes[p]
        name = self.var_order[v]
        return [s | {name} for s in self.to_sets(hi)] + self.to_sets(lo)

    def minimize(self, p: int) -> int:
        """删除非最小集合(被更小子集吸收)。"""
        sets = self.to_sets(p)
        minimal: list[set[str]] = []
        for s in sorted(sets, key=len):
            if not any(m <= s for m in minimal):
                minimal.append(s)
        return self.set_of(minimal)
