from __future__ import annotations
import importlib

# 替代 BDD 后端: 包装 `dd` 库的高层 API(dd.autoref / dd.cudd 接口一致)。
# - dd.autoref: 纯 Python, 本机可用, 用于验证适配器与遍历协议。
# - dd.cudd:    CUDD(C)后端, 需 Cython+CUDD 编译(通常 Linux/WSL), 上万事件规模。
# 暴露与平凡 ROBDD 内核(BddManager)相同的构造算子 + 遍历协议,
# 因此 build_from_pdag 与 exact_probability 可后端无关复用。


class DdBddManager:
    def __init__(self, var_order: list[str], backend: str = "autoref"):
        try:
            mod = importlib.import_module(f"dd.{backend}")
        except Exception as e:  # pragma: no cover - 环境相关
            raise RuntimeError(
                f"dd.{backend} 不可用: {e}. "
                f"cudd 需在 Linux/WSL 编译(pip install dd --install-option=--fetch "
                f"--install-option=--cudd, 或源码 setup.py --fetch --cudd)。"
            ) from e
        self.backend = backend
        self.var_order = list(var_order)
        self.var_index = {v: i for i, v in enumerate(var_order)}
        self._bdd = mod.BDD()
        self._bdd.declare(*var_order)

    # ---- 常量与构造算子(build_from_pdag 所需) ----
    @property
    def one(self):
        return self._bdd.true

    @property
    def zero(self):
        return self._bdd.false

    def var(self, name: str):
        return self._bdd.var(name)

    def apply_and(self, f, g):
        return f & g

    def apply_or(self, f, g):
        return f | g

    def apply_not(self, f):
        return ~f

    def ite(self, f, g, h):
        return self._bdd.ite(f, g, h)

    # ---- 遍历协议(与 BddManager 一致; 供 exact_probability 复用) ----
    def is_terminal(self, h) -> bool:
        return h.var is None

    def terminal_value(self, h) -> int:
        return 1 if h == self._bdd.true else 0

    def top_var_index(self, h) -> int:
        return self.var_index[h.var]

    def cofactor(self, h, var_index: int, val: int):
        if h.var is None or self.var_index[h.var] != var_index:
            return h
        return h.high if val == 1 else h.low

    def var_name(self, var_index: int) -> str:
        return self.var_order[var_index]
