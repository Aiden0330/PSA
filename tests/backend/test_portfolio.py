"""R5 组合总览数据源 —— store.portfolio() + report_export.risk_placement().

规格:docs/superpowers/specs/2026-07-13-explorer-redesign.md §4.
证据链不变量:数字取自已钉扎案例(绝不现算);无案例 → latest_case=None(前端"未量化");
review_state 锚定最新版本(防旧签发被误读为现状);矩阵格与报告矩阵同源(阈值不重复)。
"""
import pytest

from backend import store
from backend.canonical import to_canonical
from backend import report_export

PUUID = "3f2504e0-4f89-41d3-9a0c-0305e82c3311"
PUUID2 = "3f2504e0-4f89-41d3-9a0c-0305e82c3312"


@pytest.fixture(autouse=True)
def _isolate_saved_dir(tmp_path, monkeypatch):
    """portfolio() 反查 savedId 会读 storage.saved/ —— 隔离到 tmp,避免读真实存档目录
    (共享 conftest 只隔离了 store 库,未隔离 saved/)。"""
    monkeypatch.setattr("backend.storage._DIR", str(tmp_path / "saved"))


def _payload(fail=0.1):
    return {"v": 2,
            "etas": [{"key": "t", "name": "T",
                      "model": {"initEvent": "IE", "initFreq": 0.001,
                                "functionalEvents": [{"id": "FE1", "failProb": fail}],
                                "root": {"kind": "branch", "feId": "FE1",
                                         "success": {"kind": "leaf", "consequence": "C1"},
                                         "failure": {"kind": "leaf", "consequence": "C2"}}},
                      "fts": {"model_data": {"parameters": []}, "fault_trees": []},
                      "pfds": {}}],
            "activeKey": "t", "checkedKeys": {"t": True}}


def _project_with_case(puuid, name, consequences, *, kind="report"):
    store.ensure_project(puuid, name)
    v = store.create_version(puuid, *to_canonical(_payload(), puuid))
    cid = store.create_case(puuid, v["id"], kind, results={"consequences": consequences})
    return v, cid


# ── risk_placement:与报告矩阵同源 ────────────────────────────────────────────

def test_risk_placement_matches_report_matrix_math():
    # C5=1e-3(sev_rank 5, _freq_band(1e-3)=2 → freq_rank 3 → 5*3=15 → extreme)
    pl = report_export.risk_placement({"C1": 0.0, "C5": 1e-3})
    assert pl["worst"]["severity"] == "C5"
    assert pl["worst"]["level"] == "extreme"
    assert pl["worst"]["freq_band"] == report_export._freq_band(1e-3)
    # 与报告内联算法逐格一致
    for cell in pl["cells"]:
        expect = report_export._risk_level(report_export._SEV_RANK[cell["severity"]],
                                           cell["freq_band"] + 1)
        assert cell["level"] == expect


def test_risk_placement_zero_freq_not_placed():
    pl = report_export.risk_placement({"C1": 0.0, "C2": 0.0, "C3": 0.0, "C4": 0.0, "C5": 0.0})
    assert pl["cells"] == [] and pl["worst"] is None


def test_risk_placement_worst_breaks_tie_by_severity():
    # C2@1e-1 → 2*4=8=medium;C4@1e-5 → 4*2=8=medium。同 level 平手 → 取更高后果级 C4
    # (否则组合"最劣格"可能落在低后果格上,误导读者)。
    pl = report_export.risk_placement({"C2": 1e-1, "C4": 1e-5})
    assert pl["worst"]["level"] == "medium"
    assert pl["worst"]["severity"] == "C4"


# ── portfolio():取自钉扎案例,绝不现算 ──────────────────────────────────────

def test_portfolio_numbers_taken_from_pinned_case():
    _project_with_case(PUUID, "已量化项目", {"C1": 1e-2, "C3": 2e-4, "C5": 3e-6})
    rows = store.portfolio()
    row = next(r for r in rows if r["uuid"] == PUUID)
    assert row["latest_case"] is not None
    # 数字逐一等于钉扎值(未被重算/篡改)
    assert row["latest_case"]["consequences"]["C1"] == 1e-2
    assert row["latest_case"]["consequences"]["C3"] == 2e-4
    assert row["latest_case"]["consequences"]["C5"] == 3e-6
    # 缺省级补 0(五级齐全,供矩阵渲染)
    assert row["latest_case"]["consequences"]["C2"] == 0.0
    assert row["latest_case"]["risk"]["worst"] is not None


def test_portfolio_no_case_is_unquantified_not_computed():
    store.ensure_project(PUUID2, "未量化项目")
    store.create_version(PUUID2, *to_canonical(_payload(), PUUID2))
    row = next(r for r in store.portfolio() if r["uuid"] == PUUID2)
    assert row["latest_case"] is None          # "未量化",绝不静默现算
    assert row["versions"] == 1
    assert row["latest_hash"] is not None


def test_portfolio_latest_case_wins_and_carries_version_hash():
    v1, _ = _project_with_case(PUUID, "P", {"C5": 1e-6})
    # 新版本 + 新案例(不同后果)→ 组合总览取最新
    v2 = store.create_version(PUUID, *to_canonical(_payload(0.2), PUUID))
    store.create_case(PUUID, v2["id"], "uncertainty", results={"consequences": {"C5": 9e-4}})
    row = next(r for r in store.portfolio() if r["uuid"] == PUUID)
    assert row["latest_case"]["consequences"]["C5"] == 9e-4
    assert row["latest_case"]["kind"] == "uncertainty"
    assert row["latest_case"]["version_hash"] == v2["content_hash"]   # 溯源锚点


def test_portfolio_review_state_anchored_to_latest_version():
    v1, _ = _project_with_case(PUUID, "P", {"C5": 1e-6})
    store.submit_review(PUUID, v1["id"])
    store.sign_review(PUUID, v1["id"], note="ok")
    # 旧版本已签发,但新版本是草稿 → 现状应为"未签发"(None),而非把旧签发当现状
    v2 = store.create_version(PUUID, *to_canonical(_payload(0.3), PUUID))
    row = next(r for r in store.portfolio() if r["uuid"] == PUUID)
    assert row["latest_hash"] == v2["content_hash"]
    assert row["review_state"] is None        # 关键:防旧签发误读为现状


def test_portfolio_review_state_signed_when_latest_signed():
    v1, _ = _project_with_case(PUUID, "P", {"C5": 1e-6})
    store.submit_review(PUUID, v1["id"])
    store.sign_review(PUUID, v1["id"], note="ok")
    row = next(r for r in store.portfolio() if r["uuid"] == PUUID)
    assert row["review_state"] == "signed"


def test_portfolio_in_review_surfaces_for_queue():
    v1, _ = _project_with_case(PUUID, "P", {"C5": 1e-6})
    store.submit_review(PUUID, v1["id"])
    row = next(r for r in store.portfolio() if r["uuid"] == PUUID)
    assert row["review_state"] == "in_review"  # 前端评审队列据此过滤


def test_portfolio_saved_id_maps_from_legacy_blob():
    from backend import storage
    sid = storage.save_workspace("台账项目", _payload())["id"]
    v = store.save_workspace_version(sid, "台账项目", _payload())   # uuid = legacy_project_uuid(sid)
    store.create_case(v["project_uuid"], v["id"], "report", results={"consequences": {"C5": 1e-4}})
    row = next(r for r in store.portfolio() if r["uuid"] == v["project_uuid"])
    assert row["saved_id"] == sid          # 组合总览据此直达/打开项目


def test_portfolio_saved_id_none_without_blob():
    _project_with_case(PUUID, "无存档项目", {"C5": 1e-6})   # 仅 store 侧,无 saved/ blob
    row = next(r for r in store.portfolio() if r["uuid"] == PUUID)
    assert row["saved_id"] is None         # 降级:前端提示"需先打开",不虚构 savedId


def test_portfolio_empty_when_no_projects():
    assert store.portfolio() == []


# ── 端点连通(无角色门,与 /api/projects 同属只读查询面)──────────────────────

def test_portfolio_endpoint_roundtrip():
    from fastapi.testclient import TestClient
    from backend.app import app
    _project_with_case(PUUID, "端点项目", {"C5": 1e-3})
    r = TestClient(app).get("/api/portfolio")
    assert r.status_code == 200
    assert "application/json" in r.headers["content-type"]
    row = next(x for x in r.json() if x["uuid"] == PUUID)
    assert row["latest_case"]["consequences"]["C5"] == 1e-3
    assert row["latest_case"]["risk"]["worst"]["level"] == "extreme"
