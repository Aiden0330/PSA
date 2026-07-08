import io
from backend.et_builder import build_model_from_request
from backend.report_export import build_report_data, report_csv, report_docx, report_pdf
from psaengine.analysis import Analysis


def _linked_req() -> dict:
    """最小事件树: B1 挂 2-基本 OR 故障树, B2 仅 pfd。"""
    return {
        "init_event": "IE", "init_frequency": 1e-3,
        "functional_events": [{"id": "B1", "link_ft": "B1"}, {"id": "B2", "pfd": 0.1}],
        "fault_trees": {"B1": {"top": "B1", "nodes": [
            {"id": "b1a", "basic": True, "param_ref": "p_a"},
            {"id": "b1b", "basic": True, "param_ref": "p_b"},
            {"id": "B1", "op": "or", "args": ["b1a", "b1b"]}]}},
        "parameters": {"p_a": {"value": 0.05}, "p_b": {"value": 0.02}},
        "sequences": [
            {"path": {"B1": "success"}, "end_state": "L0"},
            {"path": {"B1": "failure", "B2": "success"}, "end_state": "L1"},
            {"path": {"B1": "failure", "B2": "failure"}, "end_state": "L2"}],
        "consequence_bins": {"L0": "C1", "L1": "C3", "L2": "C5"},
    }


def test_build_report_data_new_keys():
    model = build_model_from_request(_linked_req())
    d = build_report_data(model, "TR", consequence_defs={"C5": "自定义C5内涵"},
                          labels={"B1": "屏障一"}, linked_fe_ids=["B1"], samples=50, seed=1)
    # 旧键仍在
    assert set(d) >= {"consequences", "bands", "importance"}
    # 新键
    assert d["consequence_defs"]["C5"] == "自定义C5内涵"
    assert d["consequence_defs"]["C1"]  # 缺省回退非空
    assert isinstance(d["sequences"], list) and len(d["sequences"]) <= 10
    assert {"path_summary", "consequence", "frequency"} <= set(d["sequences"][0])
    # fta 仅含 linked B1, 顶概率与 Analysis 一致
    assert "B1" in d["fta"] and "B2" not in d["fta"]
    fta = d["fta"]["B1"]
    assert fta["label"] == "屏障一"
    assert fta["cutsets"] and {"events", "order", "prob"} <= set(fta["cutsets"][0])
    assert fta["basics"] and {"event", "fv"} <= set(fta["basics"][0])
    exp = Analysis(model, fault_tree="B1").probability()
    assert abs(fta["top_prob"] - exp) <= 1e-9


def test_fta_empty_and_sequences_sorted_without_optional_args():
    """不传 linked_fe_ids/consequence_defs/labels: fta 为空、内涵回退非空、主导序列按频率降序。"""
    model = build_model_from_request(_linked_req())
    d = build_report_data(model, "TR", samples=50, seed=1)
    assert d["fta"] == {}                            # 无挂载 FT → 无 FTA 段
    assert d["consequence_defs"]["C1"]               # consequence_defs 缺省回退非空
    freqs = [s["frequency"] for s in d["sequences"]]
    assert freqs == sorted(freqs, reverse=True)      # 主导序列按频率降序


def _linked_data():
    model = build_model_from_request(_linked_req())
    return build_report_data(model, "TR", consequence_defs={"C5": "自定义C5内涵"},
                             labels={"B1": "屏障一"}, linked_fe_ids=["B1"], samples=50, seed=1)


def test_csv_has_new_sections():
    txt = report_csv(_linked_data()).decode("utf-8")
    assert "主导事故序列" in txt
    assert "FTA" in txt and "屏障一" in txt
    assert "自定义C5内涵" in txt


def test_docx_and_pdf_build_with_new_sections():
    d = _linked_data()
    b1 = report_docx(d, "测试场景", None)
    assert b1[:4] == b"PK\x03\x04" and len(b1) > 1000
    from docx import Document
    doc = Document(io.BytesIO(b1))
    alltext = "\n".join(p.text for p in doc.paragraphs)
    assert "主导事故序列" in alltext and "屏障一" in alltext   # docx 含新章节(标题段)
    b2 = report_pdf(d, "测试场景", None)
    assert b2[:4] == b"%PDF" and len(b2) > 1000
