"""BANKED 锚点:站级跨舱 CCF 入值 v2(规格 2026-07-27-station-ccf-v2-banked)。

探针:backend.station 暴露纯函数 `closure_ge_k(edges, sources, k)`(无向边闭包
分布,v2 结构标志)⇒ 激活。锚点数值全部由规格 §3 公式手算(§4 表),不从实现取。
恒跑 F-0 守 v1 流:申报-only 组逐位 = v1 闭式——今天就绿,银行不扰现役。
"""
import pytest

from backend import station
from backend.compare import CompareError

PROBE_REASON = ("站级 CCF 入值 v2 未实现——规格 docs/superpowers/specs/"
                "2026-07-27-station-ccf-v2-banked.md")

gated = pytest.mark.skipif(not hasattr(station, "closure_ge_k"), reason=PROBE_REASON)

# 夹具站数值(与 tests/backend/test_station_model._mk_station 同参)。全部锚点走
# 纯入口 quantify_pure(doc, freqs)(规格 §6)——免建库,案例装载铁律留在 quantify 壳。
FA, FB, F4A, F4B = 1.1e-4, 2.2e-4, 1e-5, 2e-5
GS = GE = 0.5
PF = 0.2
EDGES3 = [0.10, 0.10]          # 3 舱一排,无墙
ESC3 = [0.10, 0.19, 0.10]
CH3 = 0.01                     # chain(k=3) 每舱


def _v1_metrics():
    """v1 闭式(test_station_model 锁的同一套手算)。"""
    f = [FA, FA, FB]
    any1 = 1 - (1 - FA) ** 2 * (1 - FB)
    ge2 = sum(fi * e for fi, e in zip(f, ESC3)) * GS
    ge_row = sum(f) * CH3 * GS * GE
    off = (1 - (1 - F4A) ** 2 * (1 - F4B)) * PF
    return any1, ge2, ge_row, off


def test_F0_declared_only_group_keeps_v1_bitwise():
    # 恒跑(不门控):申报-only 组(无 valued)绝不改点值——公式层直接复算 v1 闭式,
    # 与 test_station_model 端到端锁互为印证;银行落地后本测继续守 opt-in 律。
    any1, ge2, ge_row, off = _v1_metrics()
    esc = station.esc_per_cabin(EDGES3, 0.0, 0)
    assert esc == pytest.approx(ESC3)
    assert station.f_ge2([FA, FA, FB], esc, GS) == pytest.approx(ge2, rel=1e-12)
    ch = station.chain_per_cabin(EDGES3, 3)
    assert station.f_ge_k([FA, FA, FB], ch, GS, GE) == pytest.approx(ge_row, rel=1e-12)
    assert station.f_any([FA, FA, FB]) == pytest.approx(any1, rel=1e-12)
    assert station.f_offsite([F4A, F4A, F4B], PF) == pytest.approx(off, rel=1e-12)


@gated
def test_R0_beta_zero_bitwise_equals_v1():
    # β=0 逐位律(规格 §7):valued β=0 ⇔ 无组,五指标 ==(非 approx)。
    m1 = _q(_doc(beta=0.0, valued=True))
    m0 = _q(_doc(groups=[]))
    for k in ("any", "ge2", "ge5", "ge_row", "offsite"):
        assert m1[k] == m0[k], f"{k}: β=0 必须逐位回归 v1"


@gated
def test_R1_fixture_station_four_metric_hand_values():
    # 规格 §4 表:组 {A-01,A-02} β=0.2。
    m = _q(_doc(beta=0.2, valued=True))
    assert m["any"] == pytest.approx(4.179448e-4, rel=1e-6)
    assert m["ge2"] == pytest.approx(4.576e-5, rel=1e-9)
    assert m["ge_row"] == pytest.approx(1.540e-6, rel=1e-9)
    assert m["offsite"] == pytest.approx(7.599909e-6, rel=1e-6)
    # 方向:any/offsite 微降(合并起因),多舱指标升
    v1_any, v1_ge2, v1_row, v1_off = _v1_metrics()
    assert m["any"] < v1_any and m["offsite"] < v1_off
    assert m["ge2"] > v1_ge2 and m["ge_row"] > v1_row


@gated
def test_R2_uniform_fleet_collapse_law_and_magnitude():
    # 8 舱单排全 A,β=0.1,m=8≥k ⇒ ge_k^v2 = (1−β)·ge_k^v1 + β·f(精确闭式);
    # ge5 量级 214×——CCF 入值改变结论量级。
    edges = [0.1] * 7
    ch5 = station.chain_per_cabin(edges, 5)
    ge5_v1 = FA * sum(ch5) * GS * GE
    m = _q(_doc8(beta=0.1))
    assert m["ge5"] == pytest.approx(0.9 * ge5_v1 + 0.1 * FA, rel=1e-9)
    assert m["ge5"] / ge5_v1 > 100, "CCF 直燃通道必须主导长排 ≥5 指标"
    ch8 = station.chain_per_cabin(edges, 8)
    ge8_v1 = FA * sum(ch8) * GS * GE
    assert m["ge_row"] == pytest.approx(0.9 * ge8_v1 + 0.1 * FA, rel=1e-9)


@gated
def test_R3_partial_member_closure_hand_value():
    # 3 舱排源 {0,1}:closure≥3 ⇔ e₂ 通(p=0.1),e₁ 无关。
    assert station.closure_ge_k(EDGES3, [0, 1], 3) == pytest.approx(0.1, rel=1e-12)
    # 源已含全排 ⇒ 概率 1;k ≤ |S| 恒 1
    assert station.closure_ge_k(EDGES3, [0, 1, 2], 3) == pytest.approx(1.0)
    assert station.closure_ge_k(EDGES3, [0, 1], 2) == pytest.approx(1.0)


@gated
def test_R4_single_source_consistency_law():
    # |S|=1 时左右边集不相交 ⇒ 无向闭包 ≡ v1 有向链(全 i×k 网格,非对称边)。
    edges = [0.3, 0.07]
    for k in (2, 3):
        ch = station.chain_per_cabin(edges, k)
        for i in range(3):
            assert station.closure_ge_k(edges, [i], k) == pytest.approx(ch[i], rel=1e-12), \
                f"i={i} k={k}:单源一致律破裂"


@gated
def test_R5_validation_loud_422s():
    for bad, why in [
        (dict(beta=None, valued=True), "beta 必填"),
        (dict(beta=1.5, valued=True), "beta 越界"),
        (dict(beta=0.1, valued=True, basis=""), "入值必须给依据"),
        (dict(beta=0.1, valued=True, member_products=["A", "B"]), "跨产品入值不支持"),
        (dict(beta=0.1, valued=True, member_cabins=["A-01"]), "单舱共因无意义"),
    ]:
        with pytest.raises(CompareError) as e:
            _q(_doc(**bad))
        assert e.value.status == 422, why


@gated
def test_R6_banner_truth():
    simp = _qfull(_doc(beta=0.2, valued=True))["declared"]["simplifications"]
    joined = "\n".join(simp)
    assert "点值未计入跨舱 CCF" not in joined, "入值后横幅还挂缺席文案 = 撒谎"
    assert "已按 β 因子入值" in joined
    base = _qfull(_doc(groups=[]))["declared"]["simplifications"]
    assert any("点值未计入跨舱 CCF" in s for s in base), "无入值组必须保 v1 文案逐字"


# ── 文档构造器 + 纯入口调用(规格 §6:quantify_pure(doc, freqs) 免建库) ──────

FREQS = {"A": {"f": FA, "f4": F4A}, "B": {"f": FB, "f4": F4B}}


def _doc(beta=0.05, valued=False, groups=None, basis="同 OTA 批次", member_products=None,
         member_cabins=None):
    g = {"key": "fw-A", "label": "A 固件",
         "member_products": member_products or ["A"], "beta": beta, "basis": basis}
    if valued:
        g["valued"] = True
    if member_cabins is not None:
        g["member_cabins"] = member_cabins
    return {"name": "锚点站",
            "products": [{"key": "A", "label": "供应商A"}, {"key": "B", "label": "供应商B"}],
            "rows": [{"id": "Z1", "cabins": [
                {"id": "A-01", "product": "A"}, {"id": "A-02", "product": "A"},
                {"id": "A-03", "product": "B"}], "walls": []}],
            "edge_defaults": {"intra_p": 0.10, "wall_p": 0.03},
            "station_barriers": [{"key": "sup", "pfd": GS}, {"key": "er", "pfd": GE}],
            "ccf_groups": groups if groups is not None else [g],
            "offsite": {"p_fence": PF}}


def _doc8(beta):
    return {"name": "8 舱锚点站", "products": [{"key": "A", "label": "供应商A"}],
            "rows": [{"id": "Z1", "cabins": [
                {"id": f"A-{i:02d}", "product": "A"} for i in range(1, 9)], "walls": []}],
            "edge_defaults": {"intra_p": 0.10, "wall_p": 0.03},
            "station_barriers": [{"key": "sup", "pfd": GS}, {"key": "er", "pfd": GE}],
            "ccf_groups": [{"key": "fw-A", "member_products": ["A"], "beta": beta,
                            "basis": "同 OTA 批次", "valued": True}],
            "offsite": {"p_fence": PF}}


def _q(doc):
    """五指标 dict(quantify_pure(doc, freqs):案例装载之外的全部 v1+v2 语义)。"""
    return station.quantify_pure(doc, FREQS)["metrics"]   # type: ignore[attr-defined]


def _qfull(doc):
    return station.quantify_pure(doc, FREQS)              # type: ignore[attr-defined]
