from bess.library import load_library


def test_three_sections_present_and_ids_unique():
    lib = load_library()
    for sec in ("component_failure_rates", "barrier_effectiveness", "initiating_events"):
        rows = lib[sec]
        assert rows, f"{sec} empty"
        ids = [r["id"] for r in rows]
        assert len(ids) == len(set(ids)), f"{sec} ids not unique"


def test_every_entry_has_nonempty_citation():
    lib = load_library()
    for sec in ("component_failure_rates", "barrier_effectiveness", "initiating_events"):
        for r in lib[sec]:
            assert r["source"]["citation"].strip(), f"{sec}:{r['id']} citation empty"


def test_barrier_pfd_in_open_interval():
    for b in load_library()["barrier_effectiveness"]:
        assert 0.0 < b["pfd"] < 1.0, f"{b['id']} pfd={b['pfd']}"


def test_component_rate_and_ie_freq_positive():
    lib = load_library()
    for c in lib["component_failure_rates"]:
        assert c["rate"] > 0
    for e in lib["initiating_events"]:
        assert e["freq_prior"] > 0


def test_disclaimer_present():
    assert load_library()["meta"]["disclaimer"].strip()


def test_expanded_counts():
    lib = load_library()
    assert len(lib["barrier_effectiveness"]) >= 40
    assert len(lib["component_failure_rates"]) >= 14


def test_grade_present_and_valid():
    lib = load_library()
    for sec in ("barrier_effectiveness", "component_failure_rates"):
        for r in lib[sec]:
            assert r.get("grade") in ("C", "D"), f"{sec}:{r['id']} grade={r.get('grade')}"


def test_initiating_events_governed():
    """2026-07-08 出处评审 F1:IE 分区曾静默豁免治理——单位/分级/推导链全部强制。"""
    lib = load_library()
    for e in lib["initiating_events"]:
        assert e.get("grade") in ("C", "D"), f"IE:{e['id']} grade={e.get('grade')}"
        assert e.get("unit", "").strip(), f"IE:{e['id']} 缺 unit(单位是载荷)"
        note = e["source"].get("note", "")
        assert len(note) >= 20, f"IE:{e['id']} note 须写明频率推导链"


def test_scenario_decomposition_params_come_from_library():
    """F3:scenarios.py 分解树参数收编入库,绕过治理的硬编码不再存在。"""
    ids = {c["id"] for c in load_library()["component_failure_rates"]}
    assert {"CFR_BMS_SENSOR", "CFR_BMS_LOGIC", "CFR_OFFGAS_DET", "CFR_CONTACTOR"} <= ids


def test_offgas_anchor_and_deflag_eff_relocated():
    """F2:B_OFFGAS 对齐 Sandia 实测族(≥0.05)且降 D;F5:η 不再挂在 B_DEFLAG。"""
    b = {x["id"]: x for x in load_library()["barrier_effectiveness"]}
    assert b["B_OFFGAS"]["pfd"] >= 0.05 - 1e-12
    assert b["B_OFFGAS"]["grade"] == "D"
    assert "eff" not in b["B_DEFLAG"]


def test_existing_scenario_ids_preserved():
    ids = {b["id"] for b in load_library()["barrier_effectiveness"]}
    assert {"B_OFFGAS", "B_BMS", "B_THERMAL", "B_DEFLAG", "B_SPACING", "B_RESPONSE"} <= ids

