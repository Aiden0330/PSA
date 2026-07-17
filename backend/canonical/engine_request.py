"""Canonical EventTree -> engine EtQuantifyRequest (ADR-1 acceptance #2).

Mirrors the frontend's `toEngineRequest` semantics exactly, so a request
rebuilt from a pinned canonical version is byte-comparable (via
backend.execution.request_hash) with the request the frontend actually sent —
the premise EB-02's pin-consistency check relies on:

- DFS success-first leaf enumeration (end states L0..);
- functional events carry `{id, link_ft: id}` (linked) or `{id, pfd}` — the
  fault tree is keyed by the functional-event ref, exactly as the frontend
  keys `fault_trees[fe.id]`, with the tree's own ref kept as its inner `name`;
- CCF groups round-trip (EB-08 / G6: previously dropped, so beta-CCF replayed
  as .01 instead of .018019);
- parameters serialize as `{value}` for probability (frontend parity) and as a
  full typed dict `{kind, value, <typed fields>}` for the six non-probability
  kinds, so a replayed Q(t) model (weibull/glm/periodic_test/…) rebuilds the
  exact unavailability rather than being flattened to a probability scalar.

Minted bookkeeping parameters (__minted__) never leak into the request — a
pfd-only tree yields parameters == {}.
"""
from __future__ import annotations

from typing import Any

from backend.canonical import models as M

# Typed fields carried per Q(t) kind (engine parity). value + these fully
# describe the unavailability model on replay.
_TYPED_FIELDS = ("mttr", "test_interval", "mission_time", "gamma", "alpha", "beta", "t0")


def _node_json(n: M.FtNode, node_ref: dict[str, str], param_ref: dict[str, str]) -> dict:
    if n.type == "basic-event":
        out: dict[str, Any] = {"id": n.ref, "basic": True}
        if n.param is not None:
            out["param_ref"] = param_ref[n.param]
        return out
    if n.type == "house-event":
        return {"id": n.ref, "house": True, "state": n.state}
    out = {"id": n.ref, "op": n.op, "args": [node_ref[a] for a in n.args]}
    if n.k is not None:
        out["k"] = n.k
    return out


def _param_json(p: M.Parameter) -> dict:
    """Frontend parity: probability params ride as `{value}` (the shape
    `toEngineRequest` emits); typed kinds carry kind + non-None typed fields so
    replay rebuilds the exact Q(t) unavailability instead of a flat scalar."""
    if p.kind == "probability":
        return {"value": p.value}
    out: dict[str, Any] = {"kind": p.kind, "value": p.value}
    for f in _TYPED_FIELDS:
        v = getattr(p, f)
        if v is not None:
            out[f] = v
    return out


def build_engine_request(doc: M.ProjectDocument, et_ref: str) -> dict:
    t = next((x for x in doc.event_trees if x.ref == et_ref or x.uuid == et_ref), None)
    if t is None:
        raise KeyError(f"no event tree '{et_ref}' in document")
    param_by_uuid = {p.uuid: p for p in t.parameters}
    param_ref = {p.uuid: p.ref for p in t.parameters}
    tree_by_uuid = {ft.uuid: ft for ft in t.fault_trees}
    fe_by_uuid = {fe.uuid: fe for fe in t.functional_events}
    cons_by_uuid = {c.uuid: c for c in t.consequences}

    sequences: list[dict] = []
    bins: dict[str, str] = {}
    counter = [0]

    def walk(node: M.EtNode, path: dict[str, str]) -> None:
        if isinstance(node, M.EtLeaf):
            es = f"L{counter[0]}"
            counter[0] += 1
            sequences.append({"path": dict(path), "end_state": es})
            bins[es] = cons_by_uuid[node.consequence].level
            return
        fe = fe_by_uuid[node.fe]
        walk(node.success, {**path, fe.ref: "success"})
        walk(node.failure, {**path, fe.ref: "failure"})

    walk(t.root, {})

    functional_events: list[dict] = []
    fault_trees: dict[str, Any] = {}
    for fe in t.functional_events:
        ft = tree_by_uuid.get(fe.linked_fault_tree) if fe.linked_fault_tree else None
        if ft is not None:
            # Frontend parity: key by the functional-event ref, keep the tree's
            # own ref as inner `name` (fault_trees[fe.id] = <tree with name=ftRef>).
            functional_events.append({"id": fe.ref, "link_ft": fe.ref})
            node_ref = {n.uuid: n.ref for n in ft.nodes}
            fault_trees[fe.ref] = {
                "name": ft.ref, "top": node_ref[ft.top],
                "nodes": [_node_json(n, node_ref, param_ref) for n in ft.nodes],
            }
        else:
            functional_events.append(
                {"id": fe.ref, "pfd": param_by_uuid[fe.pfd_param].value})

    parameters = {p.ref: _param_json(p) for p in t.parameters
                  if "__minted__" not in p.extra}
    req: dict[str, Any] = {
        "init_event": t.initiating_event.description,
        "init_frequency": param_by_uuid[t.initiating_event.frequency_param].value,
        "functional_events": functional_events,
        "fault_trees": fault_trees,
        "parameters": parameters,
        "sequences": sequences,
        "consequence_bins": bins,
    }
    # EB-08 / G6: CCF groups round-trip so beta/MGL/alpha common-cause is
    # reapplied on replay. Emitted only when present (pfd-only trees keep the
    # historical request shape byte-for-byte — test_canonical_engine_request).
    if t.ccf_groups:
        req["ccf_groups"] = [
            {"id": c.ref, "members": list(c.members), "model": c.model,
             "factors": dict(c.factors)} for c in t.ccf_groups]
    return req
