import pytest
from psaengine.model.pdag import PDAG, Op

def test_build_and_gate():
    g = PDAG()
    g.basic("A"); g.basic("B")
    g.gate("TOP", Op.AND, ["A", "B"])
    assert g.top == "TOP"
    assert g.node("TOP").op is Op.AND
    assert g.node("TOP").args == ["A", "B"]

def test_house_event():
    g = PDAG()
    g.house("H", state=True)
    assert g.node("H").state is True

def test_atleast_requires_k_le_n():
    g = PDAG()
    g.basic("A"); g.basic("B")
    with pytest.raises(ValueError):
        g.gate("V", Op.ATLEAST, ["A", "B"], k=3)

def test_repeated_event_is_same_reference():
    g = PDAG()
    g.basic("A")
    g.gate("G1", Op.OR, ["A", "A"])  # 同名即同事件
    assert g.basic_events() == {"A"}

def test_undefined_arg_detected_on_validate():
    g = PDAG()
    g.gate("TOP", Op.AND, ["A", "B"])  # A,B 未定义
    with pytest.raises(ValueError, match="undefined"):
        g.validate()
