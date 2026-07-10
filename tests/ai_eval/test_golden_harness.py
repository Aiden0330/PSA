"""4b4 金例评测门:rubric 确定性、端到端(FakeClient 经全管线)、Batch 请求构建。"""
import json

from backend.ai_eval import build_batch_requests, check_case, load_cases, run_cases
from backend.ai_pipeline import AiTurn, DRAFT_MODEL, PROMPT_VERSION


def _eta_draft(n_barriers=3, keywords=("抑制", "间距", "隔热", "探测")):
    fes = [{"id": f"B{i}", "label": keywords[i % len(keywords)] + f"屏障{i}", "failProb": 0.1,
            "source": "AI 草案,待人工审核"} for i in range(n_barriers)]
    node = {"kind": "leaf", "consequence": f"C{min(n_barriers + 1, 5)}"}
    for fe in reversed(fes):
        node = {"kind": "branch", "feId": fe["id"],
                "success": {"kind": "leaf", "consequence": "C1"}, "failure": node}
    return {"draft_id": "g", "summary": "", "assumptions": [], "questions": [],
            "traceability": [], "warnings": [],
            "etas": [{"key": "x", "name": "AI ETA", "renamed": False, "pfds": {},
                      "fts": {"model_data": {"parameters": []}, "fault_trees": []},
                      "model": {"initEvent": "IE", "initFreq": 1e-3,
                                "functionalEvents": fes, "root": node}}],
            "fts": {"model_data": {"parameters": []}, "fault_trees": []}}


class ScriptClient:
    supports_tools = False
    supports_repair = False
    model_id = "fake"

    def __init__(self, drafts):
        self.drafts = list(drafts)

    def complete(self, messages, tools=None):
        return AiTurn(content=json.dumps(self.drafts.pop(0), ensure_ascii=False))


def test_golden_file_loads_six_cases():
    cases = load_cases()
    assert len(cases) == 6
    assert {c["id"] for c in cases} >= {"g1-coolant-leak-eta", "g6-ambiguous-goal-asks"}


def test_rubric_pass_and_fail_paths():
    cases = {c["id"]: c for c in load_cases()}
    ok = _eta_draft(4)
    ok["validation"] = {"ok": True, "errors": [], "warnings": []}
    r = check_case(cases["g4-thermal-propagation-eta"], ok)
    assert r["passed"], r["failures"]
    bad = _eta_draft(2)                                # 屏障数不足 4
    bad["validation"] = {"ok": True, "errors": [], "warnings": []}
    r2 = check_case(cases["g4-thermal-propagation-eta"], bad)
    assert not r2["passed"] and any("屏障数" in f for f in r2["failures"])
    # g6:含糊目标必须提问
    asks = {**_eta_draft(1), "questions": ["请补充系统边界"], "validation": {"ok": True, "errors": [], "warnings": []}}
    assert check_case(cases["g6-ambiguous-goal-asks"], asks)["passed"]
    silent = {**_eta_draft(1), "questions": [], "validation": {"ok": True, "errors": [], "warnings": []}}
    assert not check_case(cases["g6-ambiguous-goal-asks"], silent)["passed"]


def test_run_cases_end_to_end_through_full_pipeline():
    # 两个金例经 create_draft 全管线(schema→lint→引擎试运行)后过 rubric
    cases = [c for c in load_cases() if c["id"] in ("g4-thermal-propagation-eta", "g6-ambiguous-goal-asks")]
    drafts = [_eta_draft(4), {**_eta_draft(1), "questions": ["系统规模?"]}]
    out = run_cases(ScriptClient(drafts), cases)
    assert out["passed"], out["results"]
    assert out["prompt_version"] == PROMPT_VERSION


def test_batch_request_builder_pins_model_and_prompt_version():
    reqs = build_batch_requests()
    assert len(reqs) == 6
    for r in reqs:
        assert r["params"]["model"] == DRAFT_MODEL                    # claude-fable-5 钉住
        assert PROMPT_VERSION in r["custom_id"]                       # 升级门按版本追踪
        assert r["params"]["tools"], "接地工具必须随批量请求下发"
        assert r["params"]["system"]
