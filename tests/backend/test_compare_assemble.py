"""系统对比 assemble 端点锁测(规格 2026-07-26-product-comparison §3-4)。

铁律:对比绝不现算——成员 = 已钉扎 report 案例;数字取 results_json,结构/参数取
版本 canonical 文档(屏障快照 grade/url/note 的第一个跨项目消费者)。
对齐门:ETA 按 ref 配对;FE ref 序列一致 ⇒ shared,否则 divergent;部分成员缺席的
ETA 进 unmatched。禁止静默硬比。
"""
import pytest
from fastapi.testclient import TestClient

from backend import store
from backend.app import app
from backend.canonical import to_canonical

client = TestClient(app)

PA = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
PB = "3f2504e0-4f89-41d3-9a0c-0305e82c3302"
PC = "3f2504e0-4f89-41d3-9a0c-0305e82c3303"


def _payload(pfd_bms: float, extra_fe: bool = False, eta_ref: str = "sc:SC_ISC"):
    fes = [
        {"id": "B_OFFGAS", "label": "早期离气探测+联动", "failProb": 0.05,
         "source": "Sandia JES 2024", "grade": "D",
         "url": "https://iopscience.iop.org/article/10.1149/1945-7111/ad2440",
         "note": "事件级召回口径", "category": "warning"},
        {"id": "B_BMS", "label": "BMS 三级切断", "failProb": pfd_bms, "grade": "C"},
    ]
    if extra_fe:
        fes.append({"id": "B_FUSE", "label": "直流侧熔断", "failProb": 0.2})
    root = {"kind": "branch", "feId": "B_OFFGAS",
            "success": {"kind": "leaf", "consequence": "C1"},
            "failure": {"kind": "branch", "feId": "B_BMS",
                        "success": {"kind": "leaf", "consequence": "C2"},
                        "failure": {"kind": "leaf", "consequence": "C4"}}}
    if extra_fe:
        root = {"kind": "branch", "feId": "B_OFFGAS",
                "success": {"kind": "leaf", "consequence": "C1"},
                "failure": {"kind": "branch", "feId": "B_BMS",
                            "success": {"kind": "leaf", "consequence": "C2"},
                            "failure": {"kind": "branch", "feId": "B_FUSE",
                                        "success": {"kind": "leaf", "consequence": "C3"},
                                        "failure": {"kind": "leaf", "consequence": "C4"}}}}
    return {"v": 2, "etas": [{"key": eta_ref, "name": "电芯内短", "model": {
        "initEvent": "电芯内短", "initFreq": 8.32e-4,
        "functionalEvents": fes, "root": root},
        "fts": {"model_data": {"parameters": []}, "fault_trees": []}, "pfds": {}}],
        "activeKey": eta_ref, "checkedKeys": {eta_ref: True}}


def _pin(puuid: str, name: str, payload: dict, results: dict | None = None) -> int:
    store.ensure_project(puuid, name)
    vid = store.create_version(puuid, *to_canonical(payload, puuid))["id"]
    return store.create_case(puuid, vid, "report", results=results or {
        "consequences": {"C1": 7.5e-4, "C2": 6.1e-5, "C3": 0.0, "C4": 1.64e-6, "C5": 0.0},
        "bands": {"C4": {"p05": 4.2e-7, "p50": 1.6e-6, "p95": 6.7e-6}},
    })


def _assemble(members: str, base: int = 0):
    return client.get(f"/api/compare/assemble?members={members}&base={base}")


def test_two_members_shared_structure():
    ca = _pin(PA, "供应商A", _payload(0.10))
    cb = _pin(PB, "供应商B", _payload(0.036), results={
        "consequences": {"C1": 9.7e-4, "C2": 3.4e-5, "C3": 0.0, "C4": 3.9e-6, "C5": 0.0},
        "bands": {"C4": {"p05": 1.1e-6, "p50": 3.9e-6, "p95": 1.5e-5}}})
    r = _assemble(f"{PA}:{ca},{PB}:{cb}")
    assert r.status_code == 200, r.text
    d = r.json()
    assert len(d["members"]) == 2 and d["base"] == 0
    a, b = d["members"]
    # 数字来自钉扎案例(绝不现算)
    assert a["consequences"]["C4"] == pytest.approx(1.64e-6)
    assert b["bands"]["C4"]["p95"] == pytest.approx(1.5e-5)
    # 案例锚定版本哈希(证据链)
    assert len(a["case"]["version_hash"]) == 64
    # canonical 文档中的 FE 快照字段全量到场
    fe0 = a["etas"][0]["fes"][0]
    assert fe0["ref"] == "B_OFFGAS" and fe0["pfd"] == pytest.approx(0.05)
    assert fe0["grade"] == "D" and fe0["category"] == "warning"
    assert fe0["url"].startswith("https://iopscience")
    assert fe0["note"] == "事件级召回口径" and fe0["citation"] == "Sandia JES 2024"
    assert a["etas"][0]["init_freq"] == pytest.approx(8.32e-4)
    # B 家 BMS 参数差异可读
    assert d["members"][1]["etas"][0]["fes"][1]["pfd"] == pytest.approx(0.036)
    # 对齐门:同 ref、FE 序列一致 ⇒ shared
    m = d["alignment"]["matched"]
    assert len(m) == 1 and m[0]["ref"] == "sc:SC_ISC" and m[0]["structural"] == "shared"
    assert d["alignment"]["unmatched"] == []


def test_divergent_fe_sequence_flagged():
    ca = _pin(PA, "供应商A", _payload(0.10))
    cc = _pin(PC, "供应商C", _payload(0.10, extra_fe=True))
    d = _assemble(f"{PA}:{ca},{PC}:{cc}").json()
    m = d["alignment"]["matched"][0]
    assert m["structural"] == "divergent"
    # 成员各自的 FE ref 列表随行,供 ◇ 区呈现差集
    assert m["fe_refs"][0] == ["B_OFFGAS", "B_BMS"]
    assert m["fe_refs"][1] == ["B_OFFGAS", "B_BMS", "B_FUSE"]


def test_unmatched_eta_quarantined():
    ca = _pin(PA, "供应商A", _payload(0.10))
    cb = _pin(PB, "供应商B", _payload(0.05, eta_ref="sc:SC_OVERCHARGE"))
    d = _assemble(f"{PA}:{ca},{PB}:{cb}").json()
    assert d["alignment"]["matched"] == []
    refs = {(u["member"], u["ref"]) for u in d["alignment"]["unmatched"]}
    assert (0, "sc:SC_ISC") in refs and (1, "sc:SC_OVERCHARGE") in refs


def test_grade_mix_counts():
    ca = _pin(PA, "供应商A", _payload(0.10))
    cb = _pin(PB, "供应商B", _payload(0.036))
    d = _assemble(f"{PA}:{ca},{PB}:{cb}").json()
    assert d["members"][0]["grade_mix"] == {"A": 0, "B": 0, "C": 1, "D": 1, "none": 0}


def test_validation_member_count_and_kind():
    ca = _pin(PA, "供应商A", _payload(0.10))
    assert _assemble(f"{PA}:{ca}").status_code == 422          # <2 成员
    ids = []
    for i, pu in enumerate([PA, PB, PC]):
        ids.append((pu, _pin(pu, f"P{i}", _payload(0.1)) if pu != PA else ca))
    five = ",".join(f"{pu}:{cid}" for pu, cid in ids) + f",{PA}:{ca},{PB}:{ids[1][1]}"
    assert _assemble(five).status_code == 422                  # >4 成员
    # 不存在的案例 → 404 且点名成员
    r = _assemble(f"{PA}:{ca},{PB}:99999")
    assert r.status_code == 404 and "99999" in r.text
    # kind 非 report → 422
    vid = store.list_versions(PA)[-1]["id"]
    imp = store.create_case(PA, vid, "importance", results={})
    r = _assemble(f"{PA}:{ca},{PA}:{imp}")
    assert r.status_code == 422 and "report" in r.text
