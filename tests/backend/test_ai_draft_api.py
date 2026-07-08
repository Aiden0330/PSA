from fastapi.testclient import TestClient

from backend.app import app

client = TestClient(app)


def _request():
    return {
        "goal": "电池舱液冷泄漏导致外短",
        "target": "eta_with_fta",
        "current_project": {"v": 2, "etas": [], "activeKey": "", "checkedKeys": {}},
        "active_eta_key": None,
        "user_context": {"library": {"barrier_effectiveness": [], "component_failure_rates": []}},
    }


def _valid_draft():
    return {
        "draft_id": "draft-test",
        "summary": "生成液冷泄漏外短 ETA 草案",
        "assumptions": ["数值均来自参考库或用户输入,需人工复核"],
        "questions": ["是否存在液冷泄漏检测联锁?"],
        "etas": [
            {
                "key": "ai_eta_1",
                "name": "液冷泄漏外短 AI 草案",
                "model": {
                    "initEvent": "电池舱液冷泄漏导致外短",
                    "initFreq": 0.001,
                    "functionalEvents": [
                        {"id": "B_DET", "label": "泄漏检测联锁", "failProb": 0.05, "source": "AI 草案,待人工审核"},
                        {"id": "B_ISO", "label": "BMS 隔离", "failProb": 0.1, "source": "AI 草案,待人工审核"},
                    ],
                    "root": {
                        "kind": "branch",
                        "feId": "B_DET",
                        "success": {"kind": "leaf", "consequence": "C1"},
                        "failure": {
                            "kind": "branch",
                            "feId": "B_ISO",
                            "success": {"kind": "leaf", "consequence": "C2"},
                            "failure": {"kind": "leaf", "consequence": "C4"},
                        },
                    },
                    "consequences": [
                        {"id": "C1", "desc": "安全停机", "level": "C1"},
                        {"id": "C2", "desc": "局部冒烟", "level": "C2"},
                        {"id": "C4", "desc": "箱级起火", "level": "C4"},
                    ],
                },
                "fts": {"model_data": {"parameters": []}, "fault_trees": []},
                "pfds": {},
            }
        ],
        "fts": {
            "model_data": {"parameters": [{"id": "LEAK_SENSOR", "kind": "probability", "value": 0.02}]},
            "fault_trees": [
                {
                    "name": "泄漏检测联锁 FTA",
                    "top": "TOP",
                    "nodes": [
                        {"id": "LEAK_SENSOR", "basic": True, "param_ref": "LEAK_SENSOR"},
                        {"id": "TOP", "op": "or", "args": ["LEAK_SENSOR"]},
                    ],
                }
            ],
        },
        "traceability": [{"item": "B_DET", "source": "参考库 warn-imd 类比"}],
        "warnings": ["AI 草案不能替代工程审查"],
    }


def test_ai_draft_disabled_by_default(monkeypatch):
    monkeypatch.delenv("PSA_AI_ENABLED", raising=False)

    r = client.post("/api/ai/draft-model", json=_request())

    assert r.status_code == 503
    assert "disabled" in r.json()["detail"].lower()


def test_ai_draft_with_mock_provider_returns_validated_draft(monkeypatch):
    import backend.ai_draft as ai_draft

    monkeypatch.setenv("PSA_AI_ENABLED", "1")
    monkeypatch.setattr(ai_draft, "call_provider", lambda req: _valid_draft())

    r = client.post("/api/ai/draft-model", json=_request())

    assert r.status_code == 200
    body = r.json()
    assert body["draft_id"] == "draft-test"
    assert body["validation"]["ok"] is True
    assert body["etas"][0]["model"]["functionalEvents"][0]["source"].startswith("AI 草案")
    assert body["traceability"][0]["item"] == "B_DET"


def test_ai_draft_example_provider_returns_coolant_leak_fixture_without_llm_config(monkeypatch):
    monkeypatch.setenv("PSA_AI_ENABLED", "1")
    monkeypatch.setenv("PSA_LLM_PROVIDER", "example")
    monkeypatch.delenv("PSA_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("PSA_LLM_MODEL", raising=False)
    req = {**_request(), "target": "eta"}

    r = client.post("/api/ai/draft-model", json=req)

    assert r.status_code == 200
    body = r.json()
    assert body["draft_id"] == "ai-example-coolant-leak-eta"
    assert body["validation"]["ok"] is True
    assert body["etas"][0]["model"]["initEvent"] == "电池舱液冷泄漏导致外短"
    assert [fe["id"] for fe in body["etas"][0]["model"]["functionalEvents"]] == [
        "B_LEAK_DETECT",
        "B_BMS_ISO",
        "B_FUSE",
    ]


def test_ai_draft_example_provider_returns_fta_for_selected_barrier(monkeypatch):
    monkeypatch.setenv("PSA_AI_ENABLED", "1")
    monkeypatch.setenv("PSA_LLM_PROVIDER", "example")
    monkeypatch.delenv("PSA_LLM_BASE_URL", raising=False)
    monkeypatch.delenv("PSA_LLM_MODEL", raising=False)
    req = {
        **_request(),
        "target": "fta",
        "user_context": {
            "mode": "fta_for_barrier",
            "target_fe_id": "B_BMS_ISO",
            "target_fe_label": "BMS 断开隔离",
        },
    }

    r = client.post("/api/ai/draft-model", json=req)

    assert r.status_code == 200
    body = r.json()
    assert body["draft_id"] == "ai-example-bms-isolation-fta"
    assert body["validation"]["ok"] is True
    assert body["etas"] == []
    assert body["fts"]["fault_trees"][0]["name"] == "B_BMS_ISO"
    assert body["fts"]["fault_trees"][0]["top"] == "B_BMS_ISO_TOP"
    assert len(body["fts"]["model_data"]["parameters"]) >= 2


def test_ai_draft_invalid_json_is_returned_as_validation_error(monkeypatch):
    import backend.ai_draft as ai_draft

    monkeypatch.setenv("PSA_AI_ENABLED", "1")
    monkeypatch.setattr(ai_draft, "call_provider", lambda req: "{not json")

    r = client.post("/api/ai/draft-model", json=_request())

    assert r.status_code == 200
    body = r.json()
    assert body["validation"]["ok"] is False
    assert any("JSON" in e for e in body["validation"]["errors"])


def test_ai_draft_validation_rejects_bad_eta_and_fta(monkeypatch):
    import backend.ai_draft as ai_draft

    bad = _valid_draft()
    bad["etas"][0]["model"]["functionalEvents"][0]["failProb"] = 1.2
    bad["fts"]["fault_trees"][0]["top"] = "MISSING"
    monkeypatch.setenv("PSA_AI_ENABLED", "1")
    monkeypatch.setattr(ai_draft, "call_provider", lambda req: bad)

    r = client.post("/api/ai/draft-model", json=_request())

    assert r.status_code == 200
    errors = r.json()["validation"]["errors"]
    assert any("failProb" in e for e in errors)
    assert any("top" in e for e in errors)
