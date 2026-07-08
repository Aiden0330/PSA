from __future__ import annotations

# 平凡 ROBDD(不用补边): 句柄为整数, 0=ZERO, 1=ONE。
# 内部节点存为 _nodes[handle] = (var_index, high_handle, low_handle), handle 从 2 起。
# 两条约简规则: 冗余节点消除(hi==lo)+ 同构合并(unique table / hash-consing)。
# 规模上限约数百基本事件(BESS QRA 舒适区); 需更大时可将内核切到 dd.cudd。

class BddManager:
    ZERO = 0
    ONE = 1

    def __init__(self, var_order: list[str]):
        self.var_order = list(var_order)
        self.var_index = {v: i for i, v in enumerate(var_order)}
        self._nodes: dict[int, tuple[int, int, int]] = {}   # handle -> (var, hi, lo)
        self._unique: dict[tuple[int, int, int], int] = {}
        self._computed: dict[tuple, int] = {}
        self._next = 2

    # ---- 常量与变量 ----
    @property
    def one(self) -> int: return self.ONE
    @property
    def zero(self) -> int: return self.ZERO

    def _mk(self, var: int, hi: int, lo: int) -> int:
        if hi == lo:                      # 冗余节点消除
            return hi
        key = (var, hi, lo)
        if key in self._unique:           # 同构合并(hash-consing 保证规范型)
            return self._unique[key]
        h = self._next; self._next += 1
        self._nodes[h] = (var, hi, lo)
        self._unique[key] = h
        return h

    def var(self, name: str) -> int:
        return self._mk(self.var_index[name], self.ONE, self.ZERO)

    def is_var(self, h: int, name: str) -> bool:
        if h in (self.ZERO, self.ONE): return False
        v, hi, lo = self._nodes[h]
        return v == self.var_index[name] and hi == self.ONE and lo == self.ZERO

    # ---- 内部: 顶变量与 cofactor ----
    def _top_var(self, h: int) -> int:
        if h in (self.ZERO, self.ONE): return len(self.var_order)
        return self._nodes[h][0]

    def _cofactor(self, h: int, var: int, val: int) -> int:
        if self._top_var(h) != var:
            return h
        v, hi, lo = self._nodes[h]
        return hi if val == 1 else lo

    # ---- ITE ----
    def ite(self, f: int, g: int, h: int) -> int:
        if f == self.ONE: return g
        if f == self.ZERO: return h
        if g == h: return g
        if g == self.ONE and h == self.ZERO: return f
        key = ("ite", f, g, h)
        if key in self._computed: return self._computed[key]
        top = min(self._top_var(f), self._top_var(g), self._top_var(h))
        fh = self._cofactor(f, top, 1); fl = self._cofactor(f, top, 0)
        gh = self._cofactor(g, top, 1); gl = self._cofactor(g, top, 0)
        hh = self._cofactor(h, top, 1); hl = self._cofactor(h, top, 0)
        t = self.ite(fh, gh, hh); e = self.ite(fl, gl, hl)
        r = self._mk(top, t, e)
        self._computed[key] = r
        return r

    # ---- 布尔算子 ----
    def apply_and(self, f: int, g: int) -> int: return self.ite(f, g, self.ZERO)
    def apply_or(self, f: int, g: int) -> int:  return self.ite(f, self.ONE, g)
    def apply_not(self, f: int) -> int:          return self.ite(f, self.ZERO, self.ONE)

    # ---- 求值(真值表语义, 用于测试) ----
    def eval(self, h: int, assignment: dict[str, int]) -> int:
        cur = h
        while cur not in (self.ZERO, self.ONE):
            v, hi, lo = self._nodes[cur]
            cur = hi if assignment[self.var_order[v]] == 1 else lo
        return cur

    # ---- 遍历协议(后端无关; 供量化与替代后端如 CUDD 共用) ----
    def is_terminal(self, h) -> bool:
        return h in (self.ZERO, self.ONE)
    def terminal_value(self, h) -> int:
        return 1 if h == self.ONE else 0
    def top_var_index(self, h) -> int:
        return self._top_var(h)
    def cofactor(self, h, var_index: int, val: int):
        return self._cofactor(h, var_index, val)
    def var_name(self, var_index: int) -> str:
        return self.var_order[var_index]


from psaengine.model.pdag import PDAG, Op

def make_manager(var_order: list[str], backend: str = "python"):
    """BDD 管理器工厂。
    - "python": 内置平凡 ROBDD(默认, 数百事件舒适区)。
    - "autoref": dd 库纯 Python 后端(验证用)。
    - "cudd":   dd.cudd(CUDD)后端, 上万事件规模(需 Linux/WSL 编译)。
    后三者经 DdBddManager, 与本内核共享遍历协议, 可被 build_from_pdag/
    exact_probability 后端无关地复用。"""
    if backend == "python":
        return BddManager(var_order)
    from psaengine.bdd.dd_backend import DdBddManager
    return DdBddManager(var_order, backend=backend)

def build_from_pdag(m: "BddManager", g: PDAG, root_id: str, _memo=None) -> int:
    if _memo is None: _memo = {}
    if root_id in _memo: return _memo[root_id]
    n = g.nodes[root_id]
    if n.is_basic:
        r = m.var(root_id)
    elif n.is_house:
        r = m.one if n.state else m.zero
    elif n.op is Op.NULL:
        if n.state is not None: r = m.one if n.state else m.zero
        else: r = build_from_pdag(m, g, n.args[0], _memo)
    else:
        child = [build_from_pdag(m, g, a, _memo) for a in n.args]
        if n.op is Op.AND:
            r = child[0]
            for c in child[1:]: r = m.apply_and(r, c)
        elif n.op is Op.OR:
            r = child[0]
            for c in child[1:]: r = m.apply_or(r, c)
        elif n.op is Op.NOT:
            r = m.apply_not(child[0])
        elif n.op is Op.XOR:
            r = child[0]
            for c in child[1:]: r = m.ite(r, m.apply_not(c), c)
        elif n.op is Op.ATLEAST:
            r = _atleast(m, child, n.k)
        else:
            raise ValueError(f"unsupported op {n.op}")
    _memo[root_id] = r
    return r

def _atleast(m: "BddManager", child: list[int], k: int) -> int:
    """k-of-n 用 ITE 递归: f(i,need) = ite(child[i], f(i+1,need-1), f(i+1,need))。"""
    n = len(child)
    cache: dict[tuple[int, int], int] = {}
    def rec(i: int, need: int) -> int:
        if need <= 0: return m.one
        if need > n - i: return m.zero
        if (i, need) in cache: return cache[(i, need)]
        r = m.ite(child[i], rec(i + 1, need - 1), rec(i + 1, need))
        cache[(i, need)] = r
        return r
    return rec(0, k)
