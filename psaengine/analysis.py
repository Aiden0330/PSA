from __future__ import annotations
from psaengine.model.model import Model
from psaengine.model.pdag import Op
from psaengine.preprocess.normalize import normalize
from psaengine.ordering.heuristics import dflm
from psaengine.bdd.kernel import BddManager, build_from_pdag
from psaengine.quantify.probability import exact_probability, rea, mcub
from psaengine.quantify.cutsets import minimal_cutsets
from psaengine.importance.measures import importance as _imp


def _first_non_coherent_gate(pdag):
    """EB-10/O4:自 top 可达子图中的首个 NOT/XOR 门(非相干判据),否则 None。
    与 frequency._reject_non_coherent 同判据(NOT/XOR),但服务于 cutsets 通道的独立提示语。"""
    seen: set = set()
    stack = [pdag.top]
    while stack:
        nid = stack.pop()
        if nid is None or nid in seen:
            continue
        seen.add(nid)
        n = pdag.nodes.get(nid)
        if n is None:
            continue
        if getattr(n, "op", None) in (Op.NOT, Op.XOR):
            return (nid, n.op)
        stack.extend(getattr(n, "args", []) or [])
    return None

class Analysis:
    def __init__(self, model: Model, fault_tree: str | None = None,
                 house_states: dict[str, bool] | None = None,
                 boundary_condition_set: str | None = None):
        self.model = model
        self.ft_name = fault_tree or next(iter(model.fault_trees))
        ft = model.fault_trees[self.ft_name]
        pdag, params = ft.pdag, model.parameters
        # 4a2 边界条件:命名集 + 显式覆盖 → house 状态(在副本上生效,模型本体不变)
        from psaengine.preprocess.boundary import resolve_house_states, apply_house_states
        states = resolve_house_states(model, house_states, boundary_condition_set)
        if states:
            pdag = apply_house_states(pdag, states)
        if model.ccf_groups:                       # CCF 展开(beta 集总 / mgl·alpha·phi 多层)
            from psaengine.preprocess.ccf_expand import apply_ccf
            pdag, params = apply_ccf(pdag, model.ccf_groups, params)
        self.params = params
        self.pdag = normalize(pdag)
        self.order = dflm(self.pdag)
        self.m = BddManager(self.order)
        self.root = build_from_pdag(self.m, self.pdag, self.pdag.top)
        self.q = {b: params.get(self.pdag.node(b).param_ref).unavailability()
                  for b in self.pdag.basic_events()}

    def probability(self, method: str = "exact") -> float:
        if method == "exact":
            return exact_probability(self.m, self.root, self.q)
        # EB-05/O1:未知 method 不再静默落 REA —— 响亮拒绝(exact|mcub|rea)。
        if method not in ("mcub", "rea"):
            raise ValueError(f"unknown method '{method}' (exact|mcub|rea)")
        cs = self.cutsets()
        probs = [c.probability for c in cs]
        return mcub(probs) if method == "mcub" else rea(probs)

    def cutsets(self, cutoff: float = 0.0, limit_order: int | None = None):
        # EB-10/O4:非相干模型(含 NOT/XOR)无相干最小割集 —— cutsets 枚举只取正文字路径,
        # 会静默丢弃负文字(A∧¬B:精确 .1 却给割集 [A]/REA .2)。点名拒绝并指向 prime_implicants;
        # exact 概率通道走 BDD 精确否定,相干/非相干均正确,不受本守卫影响。
        bad = _first_non_coherent_gate(self.pdag)
        if bad is not None:
            nid, op = bad
            raise ValueError(
                f"minimal cut sets are undefined for non-coherent model "
                f"(gate {op.value.upper()} at '{nid}'); cut-set enumeration silently drops negative "
                f"literals — use prime_implicants for MCS/REA/MCUB (Analysis.prime_implicants); "
                f"exact probability is unaffected")
        return minimal_cutsets(self.m, self.root, q=self.q,
                               cutoff=cutoff, limit_order=limit_order)

    def importance(self, measures=("fv", "raw", "birnbaum")):
        return _imp(self.m, self.root, self.q, list(measures))

    def event_tree(self, name: str):
        from psaengine.eta.sequence import quantify_event_tree
        return quantify_event_tree(self.model, name)

    # ---- Phase 1.5 ----
    def mocus_cutsets(self, limit_order: int | None = None):
        from psaengine.quantify.mocus import mocus_cutsets
        return mocus_cutsets(self.pdag, self.pdag.top, limit_order=limit_order)

    def modular_probability(self) -> float:
        from psaengine.preprocess.modules import modular_probability
        return modular_probability(self.pdag, self.pdag.top, self.q)

    def prime_implicants(self):
        from psaengine.quantify.prime_implicants import prime_implicants
        return prime_implicants(self.m, self.root)

    def truncation_study(self, cutoffs):
        from psaengine.quantify.truncation import truncation_study
        return truncation_study(self.m, self.root, self.q, cutoffs)
