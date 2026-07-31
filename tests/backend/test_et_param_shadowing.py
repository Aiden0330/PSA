"""参数影蔽守卫锁测(报障 2026-07-30:场景残留参数静默覆写手输 PFD)。

病:未挂载功能事件先写入参数 {id: fe.id, value: pfd},请求 parameters 里同 id
残留参数随后追加,ParameterLibrary 后写胜出 ⇒ 引擎用 0.01 而 UI 显示 0.7,
量化结果与前端积式两套数。ie 块同病已有响亮守卫(ed90116 F3)——本守卫补齐
fe-pfd × 请求参数这一对。
"""
from fastapi.testclient import TestClient

from backend.app import app

client = TestClient(app)


def _req(params):
    return {
        "init_event": "IE", "init_frequency": 1e-3,
        "functional_events": [{"id": "B_OFFGAS", "pfd": 0.7}],
        "fault_trees": {}, "parameters": params,
        "sequences": [{"path": {"B_OFFGAS": "success"}, "end_state": "L0"},
                      {"path": {"B_OFFGAS": "failure"}, "end_state": "L1"}],
        "consequence_bins": {"L0": "C1", "L1": "C2"},
    }


def test_same_id_param_vs_fe_pfd_rejected_loudly():
    r = client.post("/api/event-tree/quantify", json=_req({"B_OFFGAS": {"value": 0.01}}))
    assert r.status_code == 400, r.text
    assert "B_OFFGAS" in r.text                              # 点名冲突 id


def test_clean_request_uses_manual_pfd():
    r = client.post("/api/event-tree/quantify", json=_req({}))
    assert r.status_code == 200, r.text
    seqs = r.json()["sequences"]
    assert abs(seqs["L0"] - 1e-3 * 0.3) < 1e-15              # success = 1−0.7
    assert abs(seqs["L1"] - 1e-3 * 0.7) < 1e-15
