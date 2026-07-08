# BESS PSA — macOS-first developer entry points.
# Toolchain: uv (Python 3.12 venv) + nvm/Node 20. Windows legacy: run.ps1.
# One-time machine setup: `make setup` (assumes uv and node are installed;
# see README «环境准备 (macOS)»).

UV  := $(shell command -v uv 2>/dev/null || echo $(HOME)/.local/bin/uv)
PY  := .venv/bin/python
NPM := npm --prefix frontend

.PHONY: setup venv install npm-ci test test-py test-fe benchmark \
        build-fe bundle backend frontend run check clean

## ---- setup -------------------------------------------------------------
setup: venv install npm-ci        ## full dev setup on a fresh machine

venv:                             ## create .venv with managed Python 3.12
	$(UV) venv --python 3.12 .venv

install:                          ## install python deps (editable + test)
	$(UV) pip install -e ".[test]"

npm-ci:                           ## clean-install frontend deps for this OS
	$(NPM) ci

## ---- verify ------------------------------------------------------------
test: test-py test-fe             ## the standing gate (excl. benchmarks)

test-py:                          ## python suite (~147 tests)
	$(PY) -m pytest -q --ignore=tests/benchmark

test-fe:                          ## vitest suite (~143 tests)
	$(NPM) run test

benchmark:                        ## engine vs SCRAM/OpenFTA reference corpus
	$(PY) -m pytest -q tests/benchmark

check:                            ## full pre-commit gate (matches ROADMAP 口径)
	git diff --check
	$(MAKE) test-fe
	$(MAKE) build-fe
	$(MAKE) test-py

## ---- build / run -------------------------------------------------------
build-fe:                         ## typecheck + production build
	$(NPM) run build

bundle: build-fe                  ## offline single-file bess-eta-standalone.html
	$(NPM) run bundle

backend:                          ## FastAPI on :8000 (serves frontend/dist)
	$(PY) -m uvicorn backend.app:app --host 127.0.0.1 --port 8000

frontend:                         ## vite dev server on :5173
	$(NPM) run dev -- --host 127.0.0.1 --port 5173

run: build-fe backend             ## build frontend then serve everything on :8000

clean:
	rm -rf .venv frontend/node_modules frontend/dist
