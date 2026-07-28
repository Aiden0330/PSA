"""站级评估 v1(规格 2026-07-27-station-model §2-3)。

数值语义:连续区间蔓延模型——火沿排内向左右独立扩展,逐边成功概率相乘;**墙 = 低通过
率边(衰减),不截断分布**(评审 R-2 措辞更正,数学一直如此);跨排相邻只入 ≥2 舱通道,
不入 ≥k 链(已声明的非保守简化,与跨舱 CCF 缺席同向)。
双指标(评审 BLOCKING-1):ge5 = 固定 k=5(「≥5 舱」标签唯一合法绑定;排长 <5 贡献 0),
ge_row = 整排(k=排长,「整排」标签唯一合法绑定)——二者在长排下相差数量级,错绑即静默低估。
舱级频率 = 产品钉扎案例的 C3+/C4+ 尾和(绝不现算,compare 同铁律)。
公式与 tests/backend/test_station_model.py 锚点一一对应——改式必改锚。
"""
from __future__ import annotations

import json
from math import prod
from typing import Any

from backend import store
from backend.compare import CompareError, _load_case


# ── §2 纯公式层 ────────────────────────────────────────────────────

def f_any(fs: list[float]) -> float:
    return 1.0 - prod(1.0 - f for f in fs)


def esc_per_cabin(edges: list[float], inter_row_p: float, n_other_rows: int) -> list[float]:
    """任一邻舱受累概率:排内左右边 + 每个其他排一个同列邻居。"""
    n = len(edges) + 1
    out = []
    for i in range(n):
        ps = []
        if i > 0:
            ps.append(edges[i - 1])
        if i < n - 1:
            ps.append(edges[i])
        ps.extend([inter_row_p] * n_other_rows)
        out.append(1.0 - prod(1.0 - p for p in ps))
    return out


def _dir_dist(ps: list[float]) -> list[float]:
    """单向扩展的精确分布:P(恰扩 a 舱) = Π_{1..a} p · (1−p_{a+1},若还有下一边)。"""
    dist = []
    run = 1.0
    for a in range(len(ps) + 1):
        stop = (1.0 - ps[a]) if a < len(ps) else 1.0
        dist.append(run * stop)
        if a < len(ps):
            run *= ps[a]
    return dist


def chain_per_cabin(edges: list[float], k: int) -> list[float]:
    """P(排内总受累 ≥ k | 舱 i 起火):左右分布卷积,a+b ≥ k−1。"""
    n = len(edges) + 1
    out = []
    for i in range(n):
        left = _dir_dist(list(reversed(edges[:i])))
        right = _dir_dist(edges[i:])
        s = 0.0
        for a, pa in enumerate(left):
            for b, pb in enumerate(right):
                if a + b >= k - 1:
                    s += pa * pb
        out.append(s)
    return out


def f_ge2(fs: list[float], esc: list[float], g_sup: float) -> float:
    return sum(f * e for f, e in zip(fs, esc)) * g_sup


def f_ge_k(fs: list[float], chain: list[float], g_sup: float, g_er: float) -> float:
    return sum(f * c for f, c in zip(fs, chain)) * g_sup * g_er


def f_offsite(f4s: list[float], p_fence: float) -> float:
    return (1.0 - prod(1.0 - f for f in f4s)) * p_fence


# ── §3 组装与量化 ──────────────────────────────────────────────────

_SIMPLIFICATIONS = [
    "点值未计入跨舱 CCF(同厂固件/共享水源/同班组)——低估方向,计入通道为引擎级组内联动(v2)",
    "蔓延按排内连续区间模型:忽略跳跃蔓延(飞火/爆炸抛射)与跨排链式——非保守,与 CCF 缺席同向",
    "时间相位不给消防增信(保守)",
    "ge5 只计排内连片:排长 <5 的排对 ge5 贡献 0(排内模型下 literal ≥5 不可达)",
    "≥3 排时跨排邻居按(排数−1)计,对边排属保守高估",
    "any/offsite 为年概率变换、ge* 为速率线性和;量纲 /站·年,f≪1 时差异 <0.05%",
]


def _tail(c: dict, keys: tuple[str, ...]) -> float:
    return sum(c.get(k, 0.0) for k in keys)


def _row_edges(row: dict, defaults: dict, overrides: list[dict]) -> list[float]:
    """边序列;override 无序匹配(A→B 与 B→A 等价——边物理上无向,评审 R-4)。"""
    cabs = row["cabins"]
    walls = set(row.get("walls") or [])
    edges = []
    for i in range(len(cabs) - 1):
        p = defaults.get("wall_p", 0.03) if i in walls else defaults["intra_p"]
        pair = {cabs[i]["id"], cabs[i + 1]["id"]}
        for ov in overrides:
            if {ov.get("from"), ov.get("to")} == pair:
                p = float(ov["p"])
        edges.append(float(p))
    return edges


def _chk01(v: Any, what: str) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        raise CompareError(422, f"{what} 非数值:{v!r}")
    if not 0.0 <= f <= 1.0:
        raise CompareError(422, f"{what} 越界 [0,1]:{f}")
    return f


def validate_station(doc: dict) -> None:
    products = doc.get("products") or []
    if not 1 <= len(products) <= 4:
        raise CompareError(422, f"产品数须为 1–4,实得 {len(products)}")
    keys = {p["key"] for p in products}
    rows = doc.get("rows") or []
    for row in rows:
        cabs = row.get("cabins") or []
        for c in cabs:
            if c.get("product") not in keys:
                raise CompareError(422, f"舱 {c.get('id')} 引用未定义产品 '{c.get('product')}'")
        for w in row.get("walls") or []:
            if not 0 <= int(w) <= len(cabs) - 2:
                raise CompareError(422, f"排 {row.get('id')} 墙位 {w} 越界 [0,{len(cabs)-2}]——静默丢墙是非保守空转(评审 R-4)")
    # 概率必填 + [0,1](评审 R-5/6:零默认是风险抹除方向,缺省必须显式)
    defaults = doc.get("edge_defaults") or {}
    if "intra_p" not in defaults:
        raise CompareError(422, "edge_defaults.intra_p 必填(排内间距升级概率)")
    _chk01(defaults["intra_p"], "edge_defaults.intra_p")
    _chk01(defaults.get("wall_p", 0.03), "edge_defaults.wall_p")
    if len(rows) >= 2:
        if "inter_row_p" not in defaults:
            raise CompareError(422, "≥2 排时 edge_defaults.inter_row_p 必填(缺省为 0 = 抹除跨排耦合)")
        _chk01(defaults["inter_row_p"], "edge_defaults.inter_row_p")
    off = doc.get("offsite") or {}
    if "p_fence" not in off:
        raise CompareError(422, "offsite.p_fence 必填(显式 0 合法,隐式缺省不合法)")
    _chk01(off["p_fence"], "offsite.p_fence")
    for b in doc.get("station_barriers") or []:
        _chk01(b.get("pfd"), f"station_barriers[{b.get('key')}].pfd")
    # override 必须命中某条排内相邻对(无序),否则响亮拒绝(评审 R-4:禁静默空转)
    pairs = set()
    for row in rows:
        cabs = row.get("cabins") or []
        for i in range(len(cabs) - 1):
            pairs.add(frozenset({cabs[i]["id"], cabs[i + 1]["id"]}))
    for ov in doc.get("edge_overrides") or []:
        _chk01(ov.get("p"), f"edge_overrides[{ov.get('from')}→{ov.get('to')}].p")
        if frozenset({ov.get("from"), ov.get("to")}) not in pairs:
            raise CompareError(422, f"edge_override {ov.get('from')}↔{ov.get('to')} 未命中任何排内相邻对(跨排边 v1 不可改写)")
    for p in products:
        case = _load_case(p["project_uuid"], int(p["case_id"]))   # 存在性/kind=report(响亮点名)
        cons = (json.loads(case.get("results_json") or "{}")).get("consequences") or {}
        if not cons:
            raise CompareError(422, f"产品 '{p.get('key')}' 案例 {p['case_id']} 无 consequences——不得以 0 频率静默入站(评审 R-6)")


_QS = ("p05", "p50", "p95")


def _eval_metrics(doc: dict, fmap: dict[str, tuple[float, float]]) -> tuple[dict, list, list, dict]:
    """五指标 + per_cabin + row_meta;fmap: 产品键 → (f, f4)。点值与带走同一条代码路
    (规格 ST-6 §4:点/带永不分叉;点值调用即 v1 原算式原顺序,逐位不变有锁)。"""
    barriers = {b["key"]: b for b in doc.get("station_barriers") or []}
    g_sup = float(barriers.get("sup", {}).get("pfd", 1.0))
    g_er = float(barriers.get("er", {}).get("pfd", 1.0))
    defaults = doc.get("edge_defaults") or {}
    overrides = doc.get("edge_overrides") or []
    rows = doc.get("rows") or []
    n_other = max(0, len(rows) - 1)
    inter_p = float(defaults.get("inter_row_p", 0.0))

    all_f: list[float] = []
    all_f4: list[float] = []
    per_cabin: list[dict] = []
    row_meta: list[dict] = []
    ge2 = 0.0
    ge5 = 0.0
    ge_row = 0.0
    for row in rows:
        cabs = row["cabins"]
        edges = _row_edges(row, defaults, overrides)
        fs = [fmap[c["product"]][0] for c in cabs]
        f4s = [fmap[c["product"]][1] for c in cabs]
        esc = esc_per_cabin(edges, inter_p, n_other)
        chain_row = chain_per_cabin(edges, k=len(cabs)) if len(cabs) >= 2 else [0.0] * len(cabs)
        chain5 = chain_per_cabin(edges, k=5) if len(cabs) >= 5 else [0.0] * len(cabs)
        ge2 += f_ge2(fs, esc, g_sup)
        ge5 += f_ge_k(fs, chain5, g_sup, g_er)
        ge_row += f_ge_k(fs, chain_row, g_sup, g_er)
        row_meta.append({"id": row["id"], "k": len(cabs)})
        all_f.extend(fs)
        all_f4.extend(f4s)
        for c, f, f4v, e, ch, c5 in zip(cabs, fs, f4s, esc, chain_row, chain5):
            per_cabin.append({"id": c["id"], "product": c["product"], "row": row["id"],
                              "f": f, "f4": f4v, "esc": e, "chain_row": ch, "chain5": c5,
                              "source_rank_value": f * c5})
    offsite = f_offsite(all_f4, float((doc.get("offsite") or {}).get("p_fence", 0.0)))
    metrics = {"any": f_any(all_f), "ge2": ge2, "ge5": ge5, "ge_row": ge_row, "offsite": offsite}
    return metrics, per_cabin, row_meta, {"g_sup": g_sup, "g_er": g_er}


def _chk_case_bands(pkey: str, bands: dict) -> None:
    """带健全性:C3/C4/C5 出现即须三分位齐、数值、≥0、p05≤p50≤p95(倒挂带喂出
    倒挂站级带 = 静默胡说,422 点名产品与箱)。C1/C2 不参与不校验。"""
    for k in ("C3", "C4", "C5"):
        if k not in bands:
            continue
        b = bands[k]
        try:
            vs = [float(b[q]) for q in _QS]
        except (KeyError, TypeError, ValueError):
            raise CompareError(422, f"产品 {pkey} 箱 {k} 带残缺/非数值:{b!r}")
        if any(v < 0 for v in vs) or not vs[0] <= vs[1] <= vs[2]:
            raise CompareError(422, f"产品 {pkey} 箱 {k} 带倒挂或越界:p05={vs[0]} p50={vs[1]} p95={vs[2]}")


def _product_tail_bands(pkey: str, cons: dict, bands: dict) -> tuple[str, dict | None, list[str]]:
    """尾和分位(规格 §2):tail_q = Σ 箱 band[q](有带)或点值(无带退化)。
    返回 (band_status, {q: (f_q, f4_q)} | None, notes)。"""
    participating = [k for k in ("C3", "C4", "C5") if float(cons.get(k, 0.0)) > 0.0]
    have = [k for k in participating if k in bands]
    notes: list[str] = []
    if not have and participating:
        return "none", None, [f"产品 {pkey} 无不确定带,以点值参与全部分位"]
    status = "full" if len(have) == len(participating) else "partial"
    for k in participating:
        if k not in bands:
            notes.append(f"产品 {pkey}:箱 {k} 点值>0 无带,以点值参与全部分位")
    tails = {}
    for q in _QS:
        def _t(keys: tuple[str, ...]) -> float:
            return sum(float(bands[k][q]) if k in bands else float(cons.get(k, 0.0)) for k in keys)
        tails[q] = (_t(("C3", "C4", "C5")), _t(("C4", "C5")))
    return status, tails, notes


def quantify(doc: dict) -> dict:
    validate_station(doc)
    prods: dict[str, dict] = {}
    cons_by_key: dict[str, dict] = {}
    bands_by_key: dict[str, dict] = {}
    for p in doc["products"]:
        case = _load_case(p["project_uuid"], int(p["case_id"]))
        res = json.loads(case.get("results_json") or "{}")
        cons = res.get("consequences") or {}
        cons_by_key[p["key"]] = cons
        bands_by_key[p["key"]] = res.get("bands") or {}
        _chk_case_bands(p["key"], bands_by_key[p["key"]])
        proj = store.get_project(p["project_uuid"]) or {}
        prods[p["key"]] = {
            "key": p["key"], "label": p.get("label") or proj.get("name"),
            "project": {"uuid": p["project_uuid"], "name": proj.get("name")},
            "case": {"id": case["id"], "vid": case["version_id"],
                     "created_at": case["created_at"], "version_hash": case["content_hash"]},
            "f": _tail(cons, ("C3", "C4", "C5")),
            "f4": _tail(cons, ("C4", "C5")),
        }
    fmap_point = {k: (p["f"], p["f4"]) for k, p in prods.items()}
    metrics, per_cabin, row_meta, gates = _eval_metrics(doc, fmap_point)

    # ── 站级带(规格 ST-6:同分位代入 = 全联动包络;绝不现算,只合成已存分位)──
    band_notes: list[str] = []
    tails_by_key: dict[str, dict | None] = {}
    for k in prods:
        status, tails, notes = _product_tail_bands(k, cons_by_key[k], bands_by_key[k])
        prods[k]["band_status"] = status
        prods[k]["f_band"] = ({q: tails[q][0] for q in _QS} if tails else None)
        tails_by_key[k] = tails
        band_notes.extend(notes)
    if all(t is None for t in tails_by_key.values()):
        bands = None
        band_notes.append("全部产品案例无不确定带(bands)——站级带不可合成;需在系统项目跑不确定性并重新钉扎")
    else:
        bands = {m: {} for m in metrics}
        for q in _QS:
            fmap_q = {k: (tails_by_key[k][q] if tails_by_key[k] else fmap_point[k]) for k in prods}
            m_q, _, _, _ = _eval_metrics(doc, fmap_q)
            for m in metrics:
                bands[m][q] = m_q[m]
        band_notes.append("带口径:同分位代入=认知全联动包络(同产品跨舱为精确 SOKC;跨产品同分位为保守包络);"
                          "站级参数(边概率/站级屏障 PFD/围栏)以点值参与,不贡献带宽")

    rank = sorted(per_cabin, key=lambda c: c["source_rank_value"], reverse=True)[:5]
    return {
        "metrics": metrics,
        "bands": bands,
        "band_notes": band_notes,
        "rows": row_meta,
        "per_cabin": per_cabin,
        "per_source_rank": [{"id": r["id"], "value": r["source_rank_value"]} for r in rank],
        "products": list(prods.values()),
        "gates": gates,
        "declared": {"ccf_groups": doc.get("ccf_groups") or [],
                     "simplifications": _SIMPLIFICATIONS},
    }
