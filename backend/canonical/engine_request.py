"""Canonical EventTree -> engine EtQuantifyRequest (ADR-1 acceptance #2).

Mirrors the frontend's `toEngineRequest` semantics exactly: DFS success-first
leaf enumeration (end states L0..), subset paths keyed by functional-event
ref, pfd-vs-link_ft selection, and the eta bundle's parameters as {ref:
{value}}. Minted bookkeeping parameters (__minted__) never leak into the
request — a pfd-only tree yields parameters == {}.
"""
from __future__ import annotations

from typing import Any

from backend.canonical import models as M


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
            functional_events.append({"id": fe.ref, "link_ft": ft.ref})
            node_ref = {n.uuid: n.ref for n in ft.nodes}
            fault_trees[ft.ref] = {
                "name": ft.ref, "top": node_ref[ft.top],
                "nodes": [_node_json(n, node_ref, param_ref) for n in ft.nodes],
            }
        else:
            functional_events.append(
                {"id": fe.ref, "pfd": param_by_uuid[fe.pfd_param].value})

    parameters = {p.ref: {"value": p.value} for p in t.parameters
                  if "__minted__" not in p.extra}
    return {
        "init_event": t.initiating_event.description,
        "init_frequency": param_by_uuid[t.initiating_event.frequency_param].value,
        "functional_events": functional_events,
        "fault_trees": fault_trees,
        "parameters": parameters,
        "sequences": sequences,
        "consequence_bins": bins,
    }
