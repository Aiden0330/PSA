"""Render the benchmark corpus + live engine runs into the validation report.

Run from the repo root:
    .venv/Scripts/python.exe -m tests.benchmark.make_report
"""
from __future__ import annotations
import datetime
import pathlib

from tests.benchmark.harness import load_corpus, solve, rel_err

REPO = pathlib.Path(__file__).resolve().parents[2]
OUT = REPO / "docs" / "benchmark" / "engine-benchmark-validation.md"

HEADER = """# 引擎 vs 标准 PSA 基准模型 — 对标验证报告

> 自动生成自 `tests/benchmark/corpus.json` + 引擎实跑。重生成:
> `.venv/Scripts/python.exe -m tests.benchmark.make_report`

## 方法学
- 指标:精确顶事件概率(BDD,`Analysis.probability("exact")`);小模型并比最小割集数(`Analysis.cutsets()`)。
- 参考值:闭式解(Tier 1)/ 同行工具(SCRAM / OpenFTA)/ 学术基准(Tier 2),逐模型记赋值与出处。
- 容差:Tier 1 ≤1e-9;Tier 2 按公布精度(≤1e-3 或匹配有效位;高精度同行值收紧到 1e-6/1e-9)。
- 语料:3 个 Tier-1 闭式锚点 + 14 个 Tier-2 命名基准(参考值取自 SCRAM 同行工具 test 断言与 OpenFTA 报告,pinned commit b85b789)。其中 2 个非相干模型(XOR / NOT)仅作概率对标(probability-only,不计 MCS,见 spec §2.7 相干语料守卫)。引擎精确 BDD 规模已验证至 cea9601(201 门 / 186 基本事件)。
- 尺度上限:`engine_feasible=false` 的模型记为「尺度上限」(测试 xfail),非失败。

## 结果
"""


def main() -> None:
    rows = []
    for e in load_corpus():
        if not e.get("engine_feasible", True):
            rows.append((e, None, None, None, "尺度上限"))
            continue
        try:
            res = solve(e["model"], e.get("fault_tree"),
                        want_mcs="ref_mcs_count" in e and e["ref_mcs_count"] is not None,
                        mcs_cutoff=e.get("mcs_cutoff", 0.0))
        except Exception as ex:  # pragma: no cover - reported, not raised
            rows.append((e, None, None, None, f"运行失败: {ex!r}"))
            continue
        re_ = rel_err(res["top_prob"], e["ref_top_prob"])
        verdict = "✅" if re_ <= e["tol_rel"] else "❌"
        rows.append((e, res["top_prob"], res["mcs_count"], re_, verdict))

    lines = [HEADER,
             "| 模型 | Tier | 来源 | 参考顶概率 | 引擎顶概率 | 相对误差 | 参考MCS | 引擎MCS | 判定 |",
             "|---|---|---|---|---|---|---|---|---|"]
    for e, p, mcs, re_, verdict in rows:
        cite = e["source"].get("citation", "")[:80].replace("|", "\\|")
        ref = f'{e["ref_top_prob"]:.6g}'
        got = "—" if p is None else f"{p:.6g}"
        rerr = "—" if re_ is None else f"{re_:.2e}"
        rmcs = e.get("ref_mcs_count") if e.get("ref_mcs_count") is not None else "—"
        gmcs = "—" if mcs is None else mcs
        lines.append(
            f'| `{e["id"]}` | {e["tier"]} | {cite} '
            f'| {ref} | {got} | {rerr} | {rmcs} | {gmcs} | {verdict} |'
        )
    lines.append("")
    lines.append("_完整出处 / 赋值 / URL 见 `tests/benchmark/corpus.json`;复现:`.venv/Scripts/python.exe -m pytest tests/benchmark`。_")
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")
    lines.append(f"_生成时间(UTC):{stamp}_")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
