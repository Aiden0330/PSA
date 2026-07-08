from bess.scenarios import build_scenario_model
from backend.report_export import build_report_data, report_csv, report_docx, report_pdf, _freq_band, _risk_level


def _data():
    return build_report_data(build_scenario_model("SC_OVERCHARGE"), "TR", samples=100, seed=1)


def test_report_data_shape():
    d = _data()
    assert set(d["consequences"]) >= {"C1", "C5"}
    assert d["bands"]["C5"]["p05"] <= d["bands"]["C5"]["p95"]
    assert "C5" in d["importance"]


def test_coloring_helpers():
    assert _freq_band(5e-5) == 1 and _freq_band(0.5) == 3
    assert _risk_level(5, 5) == "extreme" and _risk_level(1, 1) == "low" and _risk_level(3, 3) == "medium"


def test_csv_contains_consequences():
    txt = report_csv(_data()).decode("utf-8")
    assert "C5" in txt and "FV" in txt


def test_docx_is_zip():
    b = report_docx(_data(), "测试场景", None)
    assert b[:4] == b"PK\x03\x04" and len(b) > 1000


def test_pdf_is_pdf():
    b = report_pdf(_data(), "测试场景", None)
    assert b[:4] == b"%PDF" and len(b) > 1000
