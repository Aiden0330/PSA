from psaengine.model.pdag import PDAG, Op
from psaengine.model.parameters import Parameter, ParameterLibrary
from psaengine.model.fault_tree import FaultTree
from psaengine.model.event_tree import EventTree, FunctionalEvent
from psaengine.model.ccf import CCFGroup
from psaengine.model.model import Model

def _ft():
    g = PDAG(); g.basic("A"); g.basic("B"); g.gate("TOP", Op.AND, ["A", "B"])
    return FaultTree("TOP", g)

def test_fault_tree_holds_top():
    ft = _ft()
    assert ft.top == "TOP"
    assert ft.pdag.basic_events() == {"A", "B"}

def test_event_tree_sequences_bin_to_consequences():
    et = EventTree(
        init_event="IE", init_frequency=1.0,
        functional_events=[FunctionalEvent("BARRIER", link_ft="BFT")],
        sequences=[{"path": {"BARRIER": "success"}, "end_state": "OK"},
                   {"path": {"BARRIER": "failure"}, "end_state": "C3"}],
        consequence_bins={"OK": "C1", "C3": "C3"},
    )
    assert et.functional_events[0].link_ft == "BFT"
    assert et.consequence_of("C3") == "C3"

def test_ccf_group():
    grp = CCFGroup("G", members=["A1", "A2", "A3"], model="beta", factors={"beta": 0.05})
    assert grp.model == "beta" and len(grp.members) == 3

def test_model_aggregates_and_lists_parameters():
    lib = ParameterLibrary(); lib.add(Parameter("A", "probability", 0.1))
    m = Model(parameters=lib, fault_trees={"TOP": _ft()}, event_trees={}, ccf_groups=[])
    assert "A" in m.parameters
    assert "TOP" in m.fault_trees
