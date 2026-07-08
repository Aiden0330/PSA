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


def test_existing_scenario_ids_preserved():
    ids = {b["id"] for b in load_library()["barrier_effectiveness"]}
    assert {"B_OFFGAS", "B_BMS", "B_THERMAL", "B_DEFLAG", "B_SPACING", "B_RESPONSE"} <= ids

