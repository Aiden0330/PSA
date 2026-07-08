from __future__ import annotations
import numpy as np
from math import log
from psaengine.bdd.kernel import BddManager
from psaengine.quantify.probability import exact_probability

def _sample(dist, rng: np.random.Generator, n: int) -> np.ndarray:
    fam, pr = dist.family, dist.params
    if fam == "lognormal":
        median = pr["median"]; ef = pr["error_factor"]
        sigma = log(ef) / 1.645                 # EF = exp(1.645σ)
        return rng.lognormal(mean=log(median), sigma=sigma, size=n)
    if fam == "normal":
        return rng.normal(pr["mean"], pr["sd"], size=n)
    if fam == "uniform":
        return rng.uniform(pr["low"], pr["high"], size=n)
    if fam == "beta":
        return rng.beta(pr["a"], pr["b"], size=n)
    raise ValueError(f"unknown distribution {fam}")

def propagate(m: BddManager, root: int, params: dict, samples: int = 10000,
              seed: int = 42, tornado: bool = False) -> dict:
    rng = np.random.default_rng(seed)
    names = list(params)
    cols = {}
    for nm in names:
        d = params[nm].distribution
        cols[nm] = np.clip(_sample(d, rng, samples), 0.0, 1.0) if d else \
                   np.full(samples, params[nm].unavailability())
    tops = np.empty(samples)
    for i in range(samples):
        q = {nm: cols[nm][i] for nm in names}
        tops[i] = exact_probability(m, root, q)
    result = {
        "mean": float(tops.mean()),
        "p05": float(np.percentile(tops, 5)),
        "p50": float(np.percentile(tops, 50)),
        "p95": float(np.percentile(tops, 95)),
        "samples": samples, "seed": seed,
        "histogram": np.histogram(tops, bins=30),
    }
    if tornado:
        base = {nm: params[nm].unavailability() for nm in names}
        swings = []
        for nm in names:
            lo = float(np.percentile(cols[nm], 5)); hi = float(np.percentile(cols[nm], 95))
            qlo = dict(base); qlo[nm] = lo; qhi = dict(base); qhi[nm] = hi
            swing = abs(exact_probability(m, root, qhi) - exact_probability(m, root, qlo))
            swings.append((nm, swing))
        result["tornado"] = sorted(swings, key=lambda x: -x[1])
    return result
