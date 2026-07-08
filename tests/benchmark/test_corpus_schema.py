from tests.benchmark.harness import load_corpus, BENCH_DIR, parse_model

REQUIRED = {"id", "model", "tier", "ref_top_prob", "tol_rel",
            "assignment", "source", "engine_feasible"}


def test_corpus_wellformed():
    corpus = load_corpus()
    assert len(corpus) >= 3
    ids = [e["id"] for e in corpus]
    assert len(ids) == len(set(ids)), "duplicate ids"
    for e in corpus:
        missing = REQUIRED - set(e)
        assert not missing, f'{e.get("id", "?")} missing {missing}'
        assert e["tier"] in (1, 2)
        assert e["tol_rel"] > 0
        assert isinstance(e["source"], dict) and e["source"].get("citation")
        assert (BENCH_DIR / e["model"]).exists(), f'missing model file {e["model"]}'


def test_tier1_present():
    assert sum(1 for e in load_corpus() if e["tier"] == 1) >= 3


def test_all_models_parse():
    for e in load_corpus():
        model = parse_model(e["model"])
        assert model.fault_trees, f'{e["id"]}: no fault trees parsed'
