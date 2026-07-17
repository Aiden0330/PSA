"""B 阶段(第 2 版):逐格硬超时(SIGALRM,超时即拐点数据)+ 逐行 JSONL 落盘。"""
import json
import resource
import signal
import time

from backend.et_builder import build_model_from_request
from psaengine.eta.sequence import quantify_event_tree
from psaengine.eta.uncertainty import event_tree_uncertainty, barrier_importance_exact

OUT = "/tmp/claude-501/pilot_B_stress.jsonl"
open(OUT, "w").close()


class CellTimeout(Exception):
    pass


def _alarm(sig, frame):
    raise CellTimeout()


signal.signal(signal.SIGALRM, _alarm)


def cell(label, fn, budget_s=90):
    t0 = time.perf_counter()
    signal.alarm(budget_s)
    try:
        note = fn()
        row = {"label": label, "s": round(time.perf_counter() - t0, 3), "ok": True,
               "note": str(note)[:90]}
    except CellTimeout:
        row = {"label": label, "s": budget_s, "ok": False, "note": f"TIMEOUT ≥{budget_s}s(拐点)"}
    except Exception as e:
        row = {"label": label, "s": round(time.perf_counter() - t0, 3), "ok": False,
               "note": f"FAIL {e}"[:120]}
    finally:
        signal.alarm(0)
    row["rss_mb"] = round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1048576, 1)
    with open(OUT, "a") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(row, flush=True)
    return row


def chain_req(n_fe, basics_per_ft=3):
    fes, trees, params, seqs, bins = [], {}, {}, [], {}

    def walk(i, path, fails):
        if i == n_fe:
            es = f"L{len(seqs)}"
            seqs.append({"path": dict(path), "end_state": es})
            bins[es] = f"C{min(5, 1 + fails)}"
            return
        walk(i + 1, {**path, f"FE{i}": "success"}, fails)
        walk(i + 1, {**path, f"FE{i}": "failure"}, fails + 1)
    walk(0, {}, 0)
    for i in range(n_fe):
        fid = f"FE{i}"
        nodes = [{"id": f"B{i}_{b}", "basic": True, "param_ref": f"B{i}_{b}"}
                 for b in range(basics_per_ft)]
        for b in range(basics_per_ft):
            params[f"B{i}_{b}"] = {"value": 0.02 + 0.001 * b}
        nodes.append({"id": f"T{i}", "op": "or", "args": [n["id"] for n in nodes]})
        trees[fid] = {"name": fid, "top": f"T{i}", "nodes": nodes}
        fes.append({"id": fid, "link_ft": fid})
    return {"init_event": "IE", "init_frequency": 1e-2, "functional_events": fes,
            "fault_trees": trees, "parameters": params,
            "sequences": seqs, "consequence_bins": bins}


def wide_ft_req(m_basics):
    nodes = [{"id": f"E{i}", "basic": True, "param_ref": f"E{i}"} for i in range(m_basics)]
    nodes.append({"id": "TOP", "op": "or", "args": [f"E{i}" for i in range(m_basics)]})
    return {"init_event": "IE", "init_frequency": 1e-2,
            "functional_events": [{"id": "FE0", "link_ft": "FE0"}],
            "fault_trees": {"FE0": {"name": "FE0", "top": "TOP", "nodes": nodes}},
            "parameters": {f"E{i}": {"value": 1e-3 + 1e-6 * i} for i in range(m_basics)},
            "sequences": [{"path": {"FE0": "success"}, "end_state": "L0"},
                          {"path": {"FE0": "failure"}, "end_state": "L1"}],
            "consequence_bins": {"L0": "C1", "L1": "C3"}}


def ccf_req(g):
    nodes = [{"id": f"A{i}", "basic": True, "param_ref": f"A{i}"} for i in range(g)]
    nodes.append({"id": "TOP", "op": "and", "args": [f"A{i}" for i in range(g)]})
    return {"init_event": "IE", "init_frequency": 1e-2,
            "functional_events": [{"id": "FE0", "link_ft": "FE0"}],
            "fault_trees": {"FE0": {"name": "FE0", "top": "TOP", "nodes": nodes}},
            "parameters": {f"A{i}": {"value": 0.01} for i in range(g)},
            "sequences": [{"path": {"FE0": "success"}, "end_state": "L0"},
                          {"path": {"FE0": "failure"}, "end_state": "L1"}],
            "consequence_bins": {"L0": "C1", "L1": "C3"},
            "ccf_groups": [{"id": "G", "members": [f"A{i}" for i in range(g)],
                            "model": "alpha",
                            "factors": {f"alpha{k}": 1.0 / g for k in range(1, g + 1)}}]}


# 便宜档在前;昂贵档带各自预算,超时即记拐点
for mb in (100, 300, 600):
    mm = build_model_from_request(wide_ft_req(mb))
    cell(f"wide m={mb}", lambda mm=mm: f"C3={quantify_event_tree(mm, 'TR')['consequences']['C3']:.6e}")
for g in (4, 6, 8):
    mg = build_model_from_request(ccf_req(g))
    cell(f"alpha g={g} ({2**g - 1} exp)", lambda mg=mg: f"C3={quantify_event_tree(mg, 'TR')['consequences']['C3']:.6e}")
for n in (8, 10, 12):
    mn = build_model_from_request(chain_req(n))
    cell(f"chain n={n} ({2**n} seqs)",
         lambda mn=mn: f"C5={quantify_event_tree(mn, 'TR')['consequences'].get('C5', 0):.3e}", budget_s=120)
m13 = build_model_from_request(chain_req(13))
cell("chain n=13 (8192 seqs)", lambda: f"C5={quantify_event_tree(m13, 'TR')['consequences'].get('C5', 0):.3e}",
     budget_s=180)
m14 = build_model_from_request(chain_req(14))
cell("chain n=14 (16384 seqs)", lambda: f"C5={quantify_event_tree(m14, 'TR')['consequences'].get('C5', 0):.3e}",
     budget_s=180)
m10 = build_model_from_request(chain_req(10))
for N in (10000, 50000):
    cell(f"MC N={N} (n=10)",
         lambda N=N: f"p95(C5)={event_tree_uncertainty(m10, 'TR', samples=N, seed=1)['bands']['C5']['p95']:.3e}",
         budget_s=300)
m12 = build_model_from_request(chain_req(12))
cell("importance n=12 (24 requantify)",
     lambda: f"rows={len(barrier_importance_exact(m12, 'TR')['C5'])}", budget_s=300)
print("DONE", flush=True)
