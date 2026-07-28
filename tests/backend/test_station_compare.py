"""站型对比锁测(ST-8,mockup K)。

铁律:成员 = **已钉扎站级案例**(station_cases,doc_hash 锚定,不可变)——绝不
现算,纯装配。Δ = 成员/基准比值;基准指标为 0 ⇒ ratio null(不 inf 不崩);
缺案例 404 点名;成员数 2–4 否则 422。
"""
import pytest
from fastapi.testclient import TestClient

from backend.app import app
from tests.backend.test_station_bands import CONS_A, CONS_B, _pin_with, _station_body
from tests.backend.test_compare_assemble import PA, PB

client = TestClient(app)


def _pin_station(intra_p: float, name: str) -> int:
    ca = _pin_with(PA, "供应商A", CONS_A, None)
    cb = _pin_with(PB, "供应商B", CONS_B, None)
    body = _station_body(ca, cb)
    body["name"] = name
    body["edge_defaults"]["intra_p"] = intra_p
    r = client.post("/api/station", json=body)
    assert r.status_code == 200, r.text
    sid = r.json()["id"]
    p = client.post(f"/api/station/{sid}/pin")
    assert p.status_code == 200, p.text
    return p.json()["id"]


def test_C1_two_member_compare_ratios_and_meta():
    c1 = _pin_station(0.10, "站型甲")
    c2 = _pin_station(0.20, "站型乙")          # 排内升级 p 翻倍 ⇒ ge_row ×4(p² 链)
    r = client.get(f"/api/station/compare?cases={c1},{c2}")
    assert r.status_code == 200, r.text
    d = r.json()
    ms = d["members"]
    assert [m["name"] for m in ms] == ["站型甲", "站型乙"]
    assert all(len(m["doc_hash"]) == 64 and m["engine_version"] for m in ms)
    # 指标直读钉扎结果(3 舱 p=0.1:ge_row = 4.4e-4·0.01·0.25 = 1.1e-6;p=0.2 ⇒ ×4)
    assert ms[0]["metrics"]["ge_row"] == pytest.approx(1.1e-6, rel=1e-9)
    assert ms[1]["metrics"]["ge_row"] == pytest.approx(4.4e-6, rel=1e-9)
    # Δ:成员 vs 基准(首位);基准不出 delta 行
    dl = d["deltas"]
    assert [x["case_id"] for x in dl] == [c2]
    assert dl[0]["ratios"]["ge_row"] == pytest.approx(4.0, rel=1e-9)
    # 基准 ge5=0(3 舱排)且成员 ge5=0 ⇒ ratio null,不 inf 不崩
    assert dl[0]["ratios"]["ge5"] is None
    # 配置摘要(冻结文档直读)
    cfg = ms[0]["config"]
    assert cfg["n_cabins"] == 3 and cfg["n_rows"] == 1
    assert cfg["intra_p"] == pytest.approx(0.10)
    assert ms[1]["config"]["intra_p"] == pytest.approx(0.20)
    assert any(p["version_hash"] for p in cfg["products"])


def test_C2_loud_404_and_member_count_422():
    c1 = _pin_station(0.10, "站型甲")
    r = client.get(f"/api/station/compare?cases={c1},99999")
    assert r.status_code == 404 and "99999" in r.text
    assert client.get(f"/api/station/compare?cases={c1}").status_code == 422
    ids = ",".join(str(_pin_station(0.10, f"站{i}")) for i in range(5))
    assert client.get(f"/api/station/compare?cases={ids}").status_code == 422
    assert client.get("/api/station/compare?cases=abc,def").status_code == 422


def test_C3_same_engine_version_no_mix_note():
    c1 = _pin_station(0.10, "站型甲")
    c2 = _pin_station(0.10, "站型乙")
    d = client.get(f"/api/station/compare?cases={c1},{c2}").json()
    assert not any("引擎版本" in n for n in d["notes"])
