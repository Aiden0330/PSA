"""站级评估 v1 锁测(规格 2026-07-27-station-model §2/§3/§5)。

数值语义:连续区间蔓延模型(左右独立;墙=衰减边不截断分布——评审 R-2;跨排不入 ≥k 链)。
公式即锚点——改式必改锚;engine-reviewer 门在实现后执行。
产品 = 已钉扎 report 案例(复用对比页夹具),绝不现算。
"""
import pytest
from fastapi.testclient import TestClient

from backend import station, store
from backend.app import app
from tests.backend.test_compare_assemble import PA, PB, _payload, _pin

client = TestClient(app)


# ── §2 公式单元锚点(纯函数,3 舱一排) ──────────────────────────────

def _row3(wall: bool = False):
    """edges: [e12, e23];墙插 1|2 时 e12=0.03。"""
    return {"edges": [0.03 if wall else 0.10, 0.10]}


def test_any_cabin_exact():
    assert station.f_any([1e-4, 1e-4, 1e-4]) == pytest.approx(1 - (1 - 1e-4) ** 3, rel=1e-12)


def test_escalation_ge2_no_wall():
    esc = station.esc_per_cabin(_row3()["edges"], inter_row_p=0.0, n_other_rows=0)
    assert esc == pytest.approx([0.10, 1 - 0.9 * 0.9, 0.10], rel=1e-12)
    f2 = station.f_ge2([1e-4] * 3, esc, g_sup=0.5)
    assert f2 == pytest.approx(1e-4 * (0.10 + 0.19 + 0.10) * 0.5, rel=1e-12)   # 1.95e-5


def test_escalation_ge2_with_wall():
    esc = station.esc_per_cabin(_row3(wall=True)["edges"], inter_row_p=0.0, n_other_rows=0)
    assert esc == pytest.approx([0.03, 1 - 0.97 * 0.9, 0.10], rel=1e-12)       # [0.03, 0.127, 0.10]


def test_chain_k3_no_wall():
    # 端舱:单向两步 0.1×0.1=0.01;中舱:两向各一步 0.1×0.1=0.01(端部无再停因子)
    ch = station.chain_per_cabin(_row3()["edges"], k=3)
    assert ch == pytest.approx([0.01, 0.01, 0.01], rel=1e-12)
    f3 = station.f_ge_k([1e-4] * 3, ch, g_sup=0.5, g_er=0.5)
    assert f3 == pytest.approx(7.5e-7, rel=1e-12)


def test_chain_k3_with_wall():
    ch = station.chain_per_cabin(_row3(wall=True)["edges"], k=3)
    assert ch == pytest.approx([0.003, 0.003, 0.003], rel=1e-12)
    assert station.f_ge_k([1e-4] * 3, ch, 0.5, 0.5) == pytest.approx(2.25e-7, rel=1e-12)


def test_chain_stop_factor_mid_row():
    # 5 舱排验证"扩恰 a 舱"的停止因子:P(R=1)=p·(1−p_next)
    edges = [0.1, 0.1, 0.1, 0.1]
    ch = station.chain_per_cabin(edges, k=2)   # ≥2 即任一向 ≥1
    # 舱1:P(R≥1)=0.1 ⇒ chain=0.1;中舱3:1−P(L=0)P(R=0)=1−0.9²=0.19
    assert ch[0] == pytest.approx(0.10, rel=1e-12)
    assert ch[2] == pytest.approx(0.19, rel=1e-12)


def _brute_ge_k(edges, k):
    """独立参照:连续区间模型逐向精确分布的暴力卷积(与实现不同构写法)。"""
    def dist(ps):
        out = []
        run = 1.0
        for a in range(len(ps) + 1):
            out.append(run * ((1 - ps[a]) if a < len(ps) else 1.0))
            if a < len(ps):
                run *= ps[a]
        return out
    n = len(edges) + 1
    res = []
    for i in range(n):
        L = dist(list(reversed(edges[:i]))); R = dist(edges[i:])
        res.append(sum(pa * pb for a, pa in enumerate(L) for b, pb in enumerate(R) if a + b >= k - 1))
    return res


def test_ge5_vs_ge_row_diverge_on_long_row():
    """评审 BLOCKING-1 锁:8 舱排下「≥5 舱」(k=5)与「整排」(k=8)相差数量级,
    标签必须与指标一一对应——把整排值挂「≥5」标签即静默低估。"""
    edges = [0.1] * 7
    ch5 = station.chain_per_cabin(edges, k=5)
    ch8 = station.chain_per_cabin(edges, k=8)
    assert ch5 == pytest.approx(_brute_ge_k(edges, 5), rel=1e-12)
    f = [1e-4] * 8
    ge5 = station.f_ge_k(f, ch5, 0.5, 0.5)
    ge_row = station.f_ge_k(f, ch8, 0.5, 0.5)
    assert ge_row == pytest.approx(1e-4 * 8 * 0.1 ** 7 * 0.25, rel=1e-9)   # 整排=全边连乘,源不区分
    assert ge5 / ge_row > 1000                                              # 数量级分离
    # 混合 p 也与独立参照逐位一致
    mixed = [0.3, 0.07, 0.5, 0.12]
    for k in (2, 3, 4, 5):
        assert station.chain_per_cabin(mixed, k) == pytest.approx(_brute_ge_k(mixed, k), rel=1e-12)


def test_offsite_branch_not_nested():
    f = station.f_offsite([1e-5, 1e-5, 1e-5], p_fence=0.2)
    assert f == pytest.approx((1 - (1 - 1e-5) ** 3) * 0.2, rel=1e-12)          # ≈6.0e-6(评审 R-3 修正:初稿注释写低 5×)


# ── §1/§3 实体 CRUD + 端到端 quantify ──────────────────────────────

def _mk_station():
    ca = _pin(PA, "供应商A", _payload(0.10), results={
        "consequences": {"C1": 7e-4, "C2": 5e-5, "C3": 1e-4, "C4": 1e-5, "C5": 0.0}})
    cb = _pin(PB, "供应商B", _payload(0.036), results={
        "consequences": {"C1": 9e-4, "C2": 3e-5, "C3": 2e-4, "C4": 2e-5, "C5": 0.0}})
    return {
        "name": "试点站 v1",
        "products": [{"key": "A", "label": "供应商A", "project_uuid": PA, "case_id": ca},
                      {"key": "B", "label": "供应商B", "project_uuid": PB, "case_id": cb}],
        "rows": [{"id": "Z1", "label": "A 排", "cabins": [
            {"id": "A-01", "product": "A"}, {"id": "A-02", "product": "A"}, {"id": "A-03", "product": "B"}],
            "walls": []}],
        "edge_defaults": {"intra_p": 0.10, "wall_p": 0.03, "inter_row_p": 0.02,
                          "refs": {"intra": "B_SPACING"}},
        "edge_overrides": [],
        "station_barriers": [
            {"key": "sup", "label": "站级消防", "pfd": 0.5, "grade": "D", "scope": "全站", "basis": "测试"},
            {"key": "er", "label": "应急响应", "pfd": 0.5, "grade": "D", "scope": "全站", "basis": "测试"}],
        "ccf_groups": [{"key": "fw-A", "label": "A 固件", "member_products": ["A"], "beta": 0.05, "basis": "同 OTA 批次"}],
        "offsite": {"p_fence": 0.2, "basis": "泄爆朝向+42m"},
    }


def test_station_crud_audit_and_quantify():
    body = _mk_station()
    r = client.post("/api/station", json=body)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    assert any(s["id"] == sid for s in client.get("/api/station").json())

    q = client.get(f"/api/station/{sid}/quantify")
    assert q.status_code == 200, q.text
    d = q.json()
    # 舱级 f = 案例 C3+ 尾和(A: 1e-4+1e-5=1.1e-4;B: 2e-4+2e-5=2.2e-4)——绝不现算
    fs = {c["id"]: c["f"] for c in d["per_cabin"]}
    assert fs["A-01"] == pytest.approx(1.1e-4) and fs["A-03"] == pytest.approx(2.2e-4)
    # 指标闭式复算(3 舱一排 p=0.1 无墙;G_sup=G_er=0.5)
    f = [1.1e-4, 1.1e-4, 2.2e-4]
    assert d["metrics"]["any"] == pytest.approx(1 - (1 - f[0]) * (1 - f[1]) * (1 - f[2]), rel=1e-9)
    esc = [0.10, 0.19, 0.10]
    assert d["metrics"]["ge2"] == pytest.approx(sum(fi * e for fi, e in zip(f, esc)) * 0.5, rel=1e-9)
    ch = [0.01, 0.01, 0.01]
    assert d["metrics"]["ge_row"] == pytest.approx(sum(fi * c for fi, c in zip(f, ch)) * 0.25, rel=1e-9)
    f4 = [1e-5, 1e-5, 2e-5]
    assert d["metrics"]["offsite"] == pytest.approx((1 - (1 - f4[0]) ** 2 * (1 - f4[2])) * 0.2, rel=1e-9)
    # 产品成员携带版本哈希(证据链)+ CCF 只申报不入值
    assert len(d["products"][0]["case"]["version_hash"]) == 64
    assert d["declared"]["ccf_groups"][0]["key"] == "fw-A"
    assert any("CCF" in s for s in d["declared"]["simplifications"])

    # 审计 + 悬空响亮
    with store._conn() as cx:
        acts = [r2["action"] for r2 in cx.execute(
            "SELECT action FROM audit_log WHERE action LIKE 'station.%' ORDER BY id").fetchall()]
    assert "station.create" in acts
    with store._conn() as cx:
        cx.execute("DELETE FROM analysis_cases WHERE id=?", (body["products"][0]["case_id"],))
    rq = client.get(f"/api/station/{sid}/quantify")
    assert rq.status_code == 404 and str(body["products"][0]["case_id"]) in rq.text
    assert client.delete(f"/api/station/{sid}").status_code == 200
    assert client.get(f"/api/station/{sid}/quantify").status_code == 404


def test_station_validation():
    body = _mk_station()
    body["rows"][0]["cabins"][0]["product"] = "缺失键"
    assert client.post("/api/station", json=body).status_code == 422


def test_validation_rejects_silent_noops_and_bad_ranges():
    """评审 R-4/5/6:静默空转与越界一律响亮。"""
    def post(mut):
        b = _mk_station(); mut(b)
        return client.post("/api/station", json=b)
    assert post(lambda b: b["rows"][0]["walls"].append(7)).status_code == 422            # 墙位越界
    assert post(lambda b: b["edge_overrides"].append({"from": "A-01", "to": "A-03", "p": 0.5})).status_code == 422  # 非相邻对
    assert post(lambda b: b["edge_overrides"].append({"from": "A-01", "to": "A-02", "p": -0.4})).status_code == 422 # 负概率
    assert post(lambda b: b["station_barriers"].__setitem__(0, {**b["station_barriers"][0], "pfd": 7.3})).status_code == 422
    assert post(lambda b: b.pop("offsite")).status_code == 422                            # p_fence 必填
    assert post(lambda b: b["edge_defaults"].pop("intra_p")).status_code == 422           # intra_p 必填
    r = post(lambda b: None)
    assert r.status_code == 200                                                           # 基线仍可建


def test_reversed_override_applies():
    """评审 R-4:边物理无向——B→A 写法必须与 A→B 等效,不得静默丢弃。"""
    body = _mk_station()
    body["edge_overrides"] = [{"from": "A-02", "to": "A-01", "p": 0.5}]
    sid = client.post("/api/station", json=body).json()["id"]
    d = client.get(f"/api/station/{sid}/quantify").json()
    esc = {c["id"]: c["esc"] for c in d["per_cabin"]}
    assert esc["A-01"] == pytest.approx(0.5)                       # 首舱唯一边被改写
    assert d["metrics"]["ge5"] == 0.0                              # 3 舱排:literal ≥5 不可达(申报简化)
    assert any("ge5" in s2 for s2 in d["declared"]["simplifications"])
    assert d["rows"] == [{"id": "Z1", "k": 3}]


def test_empty_consequences_case_rejected():
    ca = _pin(PA, "供应商A", _payload(0.10), results={"consequences": {}})
    body = _mk_station()
    body["products"][0]["case_id"] = ca
    r = client.post("/api/station", json=body)
    assert r.status_code == 422 and "consequences" in r.text
