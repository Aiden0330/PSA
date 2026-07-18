"""ADR-3 管线(4b1):接地工具环、修复环、lint、引擎试运行 —— FakeClient 离线全测。"""
import json

import pytest

from backend import ai_draft
from backend.ai_pipeline import (AiTurn, dry_run_draft, generate_draft,
                                 library_id_set, tool_search_reference_library)
from backend.canonical.lint import lint_draft


def _good_fta_draft(library_ref=None):
    p = {"id": "E1", "kind": "probability", "value": 0.02, "source": "AI 草案,待人工审核"}
    if library_ref:
        p["library_ref"] = library_ref
    return {
        "draft_id": "d1", "summary": "s", "assumptions": [], "questions": [],
        "etas": [],
        "fts": {"model_data": {"parameters": [p]},
                "fault_trees": [{"name": "T", "top": "TOP", "nodes": [
                    {"id": "E1", "basic": True, "param_ref": "E1"},
                    {"id": "TOP", "op": "or", "args": ["E1"]}]}]},
        "traceability": [], "warnings": [],
    }


class FakeClient:
    """脚本化客户端:turns 列表按序回放;记录收到的消息(验证修复环反馈)。"""
    supports_tools = True
    supports_repair = True
    model_id = "fake-model"

    def __init__(self, turns):
        self.turns = list(turns)
        self.seen: list[list[dict]] = []

    def complete(self, messages, tools=None):
        self.seen.append(json.loads(json.dumps(messages, ensure_ascii=False, default=str)))
        return self.turns.pop(0)


def test_tool_loop_grounds_draft_and_traces():
    lib_id = sorted(library_id_set())[0]
    draft = _good_fta_draft(library_ref=lib_id)
    client = FakeClient([
        AiTurn(tool_calls=[{"id": "t1", "name": "search_reference_library",
                            "arguments": {"query": lib_id}}], served_by="fake-served"),
        AiTurn(content=json.dumps(draft, ensure_ascii=False)),
    ])
    out, prov = generate_draft({"goal": "g"}, client)
    assert out is not None and out["draft_id"] == "d1"
    assert prov["tool_trace"] and prov["tool_trace"][0]["name"] == "search_reference_library"
    assert prov["served_by"] == "fake-served"
    assert prov["rounds"] == 1
    # 工具结果确实回灌给了模型(第二次调用的消息里有 tool_result)
    second = client.seen[1]
    assert any(isinstance(m.get("content"), list)
               and any(b.get("type") == "tool_result" for b in m["content"]) for m in second)


def test_repair_loop_feeds_errors_and_converges():
    bad = _good_fta_draft()
    bad["fts"]["fault_trees"][0]["top"] = "NOPE"      # schema 错误:top 不存在
    good = _good_fta_draft()
    client = FakeClient([
        AiTurn(content=json.dumps(bad, ensure_ascii=False)),
        AiTurn(content=json.dumps(good, ensure_ascii=False)),
    ])
    out, prov = generate_draft({"goal": "g"}, client)
    assert out == good
    assert prov["rounds"] == 2
    assert prov["repair_trace"][0]["errors"] and not prov["repair_trace"][1]["errors"]
    # 修复请求里带了错误清单
    repair_msg = client.seen[1][-1]
    assert "未通过确定性校验" in str(repair_msg["content"])


def test_lint_rules():
    lib = library_id_set()
    d = _good_fta_draft(library_ref="NOT_A_REAL_ID")
    r = lint_draft(d, lib)
    assert any("library_ref" in e for e in r["errors"])          # 未知引用 = error
    d2 = _good_fta_draft()
    d2["fts"]["model_data"]["parameters"][0]["grade"] = "A"      # AI 自评 A 级
    r2 = lint_draft(d2, lib)
    assert any("不得自评置信" in e for e in r2["errors"])
    d3 = _good_fta_draft()                                       # 无引用 → ungrounded warning
    r3 = lint_draft(d3, lib)
    assert not r3["errors"] and any("ungrounded" in w for w in r3["warnings"])
    # 逻辑环:lint 提前给可读错误
    d4 = _good_fta_draft()
    d4["fts"]["fault_trees"][0]["nodes"] = [
        {"id": "E1", "basic": True, "param_ref": "E1"},
        {"id": "G1", "op": "or", "args": ["G2"]},
        {"id": "G2", "op": "or", "args": ["G1"]},
        {"id": "TOP", "op": "or", "args": ["G1", "E1"]}]
    r4 = lint_draft(d4, lib)
    assert any("逻辑环" in e for e in r4["errors"])


def test_dry_run_catches_engine_invalid_draft():
    d = _good_fta_draft()
    # 悬空 param_ref:schema 层不查跨引用,引擎载入必拒。(原构造"删 kind"已失效:
    # 缺 kind 自 2026-07-17 起默认 probability——遗留存档兼容,见 json_io._param。)
    d["fts"]["fault_trees"][0]["nodes"][0]["param_ref"] = "MISSING"
    errs = dry_run_draft(d)
    assert errs and "试运行失败" in errs[0]
    assert dry_run_draft(_good_fta_draft()) == []


def test_create_draft_carries_provenance_and_stages(monkeypatch):
    client = FakeClient([AiTurn(content=json.dumps(_good_fta_draft(), ensure_ascii=False))])
    resp = ai_draft.create_draft({"goal": "g", "target": "fta"}, client=client)
    assert resp["validation"]["ok"] is True
    assert resp["validation"]["stages"]["dry_run"] == []
    prov = resp["provenance"]
    assert prov["model_id"] == "fake-model"
    assert prov["prompt_version"]
    assert isinstance(prov["repair_trace"], list)


def test_tool_search_returns_cited_entries():
    hits = tool_search_reference_library("接触器")
    assert hits and all(h["id"] and h["citation"] is not None for h in hits)
