from __future__ import annotations
import argparse, json
from psaengine import Model, Analysis

def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="bpsa")
    sub = ap.add_subparsers(dest="cmd", required=True)
    q = sub.add_parser("quantify")
    q.add_argument("model"); q.add_argument("--fault-tree", default=None)
    q.add_argument("--method", default="exact", choices=["exact","mcub","rea"])
    q.add_argument("--format", default="auto", choices=["auto","json","mef"])
    q.add_argument("--importance", default=None)
    q.add_argument("--cutoff", type=float, default=0.0)
    b = sub.add_parser("bess")
    b.add_argument("--scenario", default="grid_container")
    b.add_argument("--samples", type=int, default=10000)
    b.add_argument("-o", "--output", default="bess_qra_report.md")
    args = ap.parse_args(argv)

    if args.cmd == "quantify":
        fmt = args.format
        if fmt == "auto":
            fmt = "mef" if args.model.lower().endswith(".xml") else "json"
        if fmt == "mef":
            from psaengine.model.mef_xml import load_mef_xml
            model = load_mef_xml(args.model)
        else:
            model = Model.from_json(args.model)
        an = Analysis(model, fault_tree=args.fault_tree)
        print(f"P(top) [{args.method}] = {an.probability(method=args.method):.6g}")
        if args.importance:
            for name, vals in an.importance(measures=args.importance.split(",")).items():
                print(f"  {name}: {vals}")
        return 0
    if args.cmd == "bess":
        from bess.report import run_scenario
        path = run_scenario(args.scenario, samples=args.samples, output=args.output)
        print(f"BESS QRA report → {path}")
        return 0
    return 1

if __name__ == "__main__":
    raise SystemExit(main())
