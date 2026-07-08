import math
import pytest
from psaengine.model.parameters import Parameter, ParameterLibrary

def test_constant_probability():
    p = Parameter("p1", kind="probability", value=0.03)
    assert p.unavailability() == 0.03

def test_periodic_test_model():
    # q ≈ λ·T/2
    p = Parameter("v1", kind="rate", value=1e-6, test_interval=1000.0)
    assert p.unavailability() == pytest.approx(1e-6 * 1000.0 / 2)

def test_repairable_model():
    # q ≈ λ·MTTR
    p = Parameter("m1", kind="rate", value=1e-4, mttr=8.0)
    assert p.unavailability() == pytest.approx(1e-4 * 8.0)

def test_unrepairable_mission_time():
    p = Parameter("u1", kind="rate", value=1e-5, mission_time=720.0)
    assert p.unavailability() == pytest.approx(1e-5 * 720.0)

def test_probability_out_of_range_rejected():
    with pytest.raises(ValueError):
        Parameter("bad", kind="probability", value=1.5).unavailability()

def test_library_shared_reference():
    lib = ParameterLibrary()
    lib.add(Parameter("shared", kind="probability", value=0.1))
    assert lib.get("shared").unavailability() == 0.1
    with pytest.raises(KeyError):
        lib.get("missing")
