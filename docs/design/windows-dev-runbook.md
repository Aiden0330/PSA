# Windows 开发与部署 Runbook

> 面向把 `github.com/Aiden1981/PSA` 克隆到 Windows 机器上继续开发的场景。
> 主开发平台仍是 macOS(`Makefile` 为原生入口),本文给出 Windows 上的两条
> 可行路径与三种部署形态。**结论先行:日常开发用 WSL2(Ubuntu),原生 Windows
> 作为备选。**

版本硬约束(与根 `CLAUDE.md` 一致,勿动):Vite 5 / React 18 / echarts 5 /
ag-grid 32,**Node 20**;Python **3.12**(经 uv 管理 `.venv`)。

---

## 0. 先决判断:选哪条路径

| | WSL2(Ubuntu)**推荐** | 原生 Windows(备选) |
|---|---|---|
| `Makefile` 原生可用 | ✅ 直接 `make test/check/run` | ❌ 无 make,需逐条 PowerShell 命令 |
| 与 GitHub CI 同构 | ✅ CI 四作业均跑在 `ubuntu-latest` | ⚠️ 内核纯 Python 一致,但环境不同构 |
| CUDD 后端(`dd.cudd`) | ✅ **唯一可本地编译的路径** | ❌ Windows 无编译配方,parity 用例 skip |
| 中文/编码坑 | 少 | 需 UTF-8 codepage 处理 |
| 上手成本 | 一次性装 WSL | 直接用现有 PowerShell |

核心引擎是**纯 Python ROBDD 内核**(无补码边,见 `CLAUDE.md`),在两条路径上
数值完全一致。CUDD 只是可选的第三方 BDD 后端**对拍**交叉校验,不参与产品计算 ——
所以原生 Windows 缺 CUDD 不影响任何业务结果,只是少跑 3 个交叉校验用例(见 §2)。

---

## 1. 推荐路径:WSL2(Ubuntu)

**为什么**:`Makefile` 原生可用、CUDD 后端唯一可行的本地编译路径、与 GitHub CI
(全部 `ubuntu-latest`)环境同构 —— 本地绿=CI 绿的确定性最高。

### 1.1 安装 WSL2

在**管理员 PowerShell** 中:

```powershell
wsl --install          # 默认装 Ubuntu + WSL2 内核,装完重启
wsl --status           # 确认 Default Version: 2
```

重启后 Ubuntu 首启会要求建 Linux 用户名/口令(与 Windows 账户无关)。之后全部
操作都在 **Ubuntu 终端**里进行。

> 性能要点:代码放在 **Linux 文件系统**(`~/…`)里,不要放在 `/mnt/c/…`。
> `node_modules` 与 `.venv` 跨 `/mnt/c` 会极慢,且文件权限语义不同。

### 1.2 克隆仓库(SSH)

在 Ubuntu 内生成密钥并把**公钥**加到你自己的 GitHub 账户(账户操作请自行在
GitHub 网页完成,本 runbook 不代操作):

```bash
ssh-keygen -t ed25519 -C "you@example.com"      # 一路回车
cat ~/.ssh/id_ed25519.pub                        # 复制到 GitHub → Settings → SSH keys

git clone git@github.com:Aiden1981/PSA.git
cd PSA
# HTTPS 备选:git clone https://github.com/Aiden1981/PSA.git
```

### 1.3 装 Python 工具链(uv)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
source ~/.bashrc                                 # 让 uv 进 PATH

uv venv --python 3.12 .venv
uv pip install -e ".[test]"
```

### 1.4 装 Node 20(nvm)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 20 && nvm use 20                      # 硬约束:Node 20,勿升级
node -v                                           # v20.x

npm --prefix frontend ci                          # = make npm-ci
```

一次性建议直接 `make setup`(= `venv` + `install` + `npm-ci`),前提是 uv、node
已就绪。

### 1.5 跑门禁与运行

```bash
make test         # 前后端全部测试(不含 benchmark)
make benchmark    # 引擎 SCRAM/OpenFTA 基准对标(引擎改动强制门)
make check        # 提交前完整口径:git diff --check + vitest + build + pytest
make run          # 构建前端 + FastAPI :8000 一体运行
# 开发模式分开启动:make backend(:8000) 另开一个终端 make frontend(:5173)
```

**从 Windows 浏览器访问**:WSL2 自动做 localhost 转发,直接在 Windows 上打开
`http://127.0.0.1:8000/`(一体)或 `http://127.0.0.1:5173/`(dev)。API 文档在
`http://127.0.0.1:8000/docs`。

### 1.6(可选)在 WSL 里编译 CUDD 后端

只有需要本地复现 CI 的 `cudd-parity` 作业时才做;日常开发**不需要**(autoref
对拍 + 纯 Python 内核已足够)。配方与 CI(`.github/workflows/ci.yml` 的
`cudd-parity` 作业,2026-07-15 首次 Linux 跑即过)一致:

```bash
sudo apt-get update && sudo apt-get install -y build-essential
uv pip install cython
pip download dd --no-deps --no-binary :all: -d /tmp/dd-src
cd /tmp/dd-src && tar xzf dd-*.tar.gz && cd dd-*/
python setup.py install --fetch --cudd            # 拉取并静态编译 CUDD
cd -  &&  python -m pytest -q tests/test_dd_parity.py   # 7 passed(cudd 用例不再 skip)
```

---

## 2. 备选:原生 Windows(不推荐日常,但可用)

无 WSL 时可行。核心引擎在纯 Python 下完整工作;后端(uvicorn)、报告导出
(python-docx / reportlab)、前端(Vite/Node)全部有 Windows 轮子,`pip install`
无需本机编译。**唯一差异是 `dd.cudd`**。

### 2.1 CUDD:Windows 无编译配方(预期 skip,非故障)

`dd.cudd` 需要 Cython + 从源码编译 CUDD C 库,Windows 上没有可行配方。
`tests/test_dd_parity.py` 用 `pytest.importorskip("dd.cudd")` 守卫,因此在原生
Windows 上以下 **3 个 CUDD 参数化用例会 skip**(预期行为,不是失败):

- `test_dd_backend_matches_python[cudd]`
- `test_dd_backend_kofn[cudd]`
- `test_dd_backend_noncoherent_matches_python[cudd]`

对应的 `[autoref]` 3 个用例(纯 Python,`dd` 轮子自带)照常跑并通过 —— autoref
与 cudd 走**同一** `DdBddManager` 代码路径,故 autoref 通过即证明 dd 适配器逻辑
正确;cudd 的完整交叉校验由 CI 在 Linux 上兜底(见 §4)。

另:`dd.autoref` 在解释器关闭期可能打印一条**无害的对象析构告警**
(`PytestUnraisableExceptionWarning`/ResourceWarning),历史 ROADMAP 与根
`README` 均记录过,不影响用例通过。测试已用 `gc.collect()` 尽量抑制。

### 2.2 装工具链

```powershell
# uv(Python 3.12 与 .venv)
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
uv venv --python 3.12 .venv
uv pip install -e ".[test]"

# Node 20:nvm-windows(coreybutler)或 fnm 二选一
nvm install 20
nvm use 20
# fnm 等价:fnm install 20 ; fnm use 20
node -v                                  # 必须 v20.x(硬约束)

npm --prefix frontend ci
```

> uv 在 Windows 建的虚拟环境解释器在 **`.venv\Scripts\python.exe`**(不是
> `bin/`)。下表命令沿用此路径;也可用 `uv run python …` 免手写路径。

### 2.3 PowerShell 等价命令表(逐条对照 `Makefile`)

| `make` target | 语义 | PowerShell 等价 |
|---|---|---|
| `make venv` | 建 .venv(Py 3.12) | `uv venv --python 3.12 .venv` |
| `make install` | 装 Python 依赖 | `uv pip install -e ".[test]"` |
| `make npm-ci` | 干净装前端依赖 | `npm --prefix frontend ci` |
| `make test-py` | Python 套件(不含 benchmark) | `.\.venv\Scripts\python.exe -m pytest -q --ignore=tests/benchmark` |
| `make test-fe` | vitest 套件 | `npm --prefix frontend run test` |
| `make test` | 前后端全部(不含 benchmark) | 上两条依次跑 |
| `make benchmark` | 引擎基准对标 | `.\.venv\Scripts\python.exe -m pytest -q tests/benchmark` |
| **tsc -b 类型门** | 前端类型门(独立) | `npm --prefix frontend exec tsc -- -b`(等价 `npx tsc -b`) |
| `make build-fe` | 类型检查 + 生产构建 | `npm --prefix frontend run build`(= `tsc -b && vite build`) |
| `make bundle` | 离线单文件 | `npm --prefix frontend run build; npm --prefix frontend run bundle` |
| `make backend` | FastAPI :8000 | `.\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000` |
| `make frontend` | Vite dev :5173 | `npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173` |
| `make run` | 构建前端 + 一体 :8000 | `npm --prefix frontend run build; .\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000` |
| `make check` | 提交前完整口径 | `git diff --check; npm --prefix frontend run test; npm --prefix frontend run build; .\.venv\Scripts\python.exe -m pytest -q --ignore=tests/benchmark` |

> 注:`npm run build` 内部已含 `tsc -b`,所以 `make build-fe`/`make check` 天然过
> 类型门;单独跑 tsc -b 仅用于快速类型自查。前端类型门以 **`tsc -b`** 为准
> (构建同款项目引用配置),不要用 `tsc --noEmit`(config 更宽松,有漏错前科)。

一键脚本:仓库自带被归档的 `docs/archive/run.ps1`(自动建 dist 缺失时先 build,
再起 :8000),可作原生 Windows 一体运行的现成参考。

### 2.4 中文编码注意

- **源码一律 UTF-8**:仓库文件已是 UTF-8,git 会原样保留,勿让编辑器改存 GBK。
- **克隆前设 `git config core.autocrlf false`**(或 `--global core.autocrlf input`):
  引擎指纹的 `benchmark_corpus_version` 按语料文件**原始字节**哈希——autocrlf=true 检出
  会把 `tests/benchmark/` 语料换行改写为 CRLF,同一套语料在 Windows 上得出不同指纹,
  报告页脚与 macOS/CI 不可对账(F3 收口二轮 F-5 备注)。
- **后端响应无需担心**:`backend/app.py` 用 `UTF8JSONResponse` 强制
  `application/json; charset=utf-8`(约束 #6),CSV 导出也带 `charset=utf-8`,
  客户端不会因编码乱码。
- **PowerShell 控制台显示**:PowerShell 5.1 默认 OEM 代码页,直接打印含中文的接口
  响应可能乱码。两种解法:
  - 临时:`chcp 65001` 切 UTF-8 代码页;或按 `run.ps1` 的做法在会话里设
    `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()` 与
    `$OutputEncoding = [System.Text.UTF8Encoding]::new()`。
  - 一劳永逸:改用 **Windows Terminal + PowerShell 7**(默认 UTF-8)。

---

## 3. 部署形态

### (a) 离线单文件 `bess-eta-standalone.html`

`make bundle`(= `build-fe` + `npm run bundle`)在**仓库根**产出
`bess-eta-standalone.html`,`file://` 双击直开,可拷到任意无网络机器。

**能力边界(重要)**:离线单文件把前端内联成一个 HTML,**没有后端**。因此
依赖 API 的功能全部不可用 —— **BESS 预置场景、引擎精确量化、Word/PDF/CSV 导出、
版本库/评审/组合总览、AI 草案**都需要后端。离线可用的只有客户端「新建 ETA」编辑、
前端积式频率与风险矩阵。给监管/评审用的证据链形态必须走完整服务(见 b)。

### (b) 完整服务:uvicorn + 前端静态产物

**这是关键事实**:前端 `vite build` 后的静态产物**由 FastAPI 自己托管**,不需要
nginx 或任何独立静态服务器。`backend/app.py` 末尾(约 L594–602)的逻辑:

```python
_DIST = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_DIST):
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="static")
else:
    # dist 不存在 → 占位页,提示先 npm run build
```

即:只要 `frontend/dist` 存在,FastAPI 就把它挂在 `/`(`html=True` → SPA 回退到
`index.html`),而 API 全在 `/api/*`、交互文档在 `/docs`。所以完整服务只有两步:

```powershell
npm --prefix frontend run build      # 产出 frontend/dist(含 tsc -b)
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
# WSL/Linux:make run 一条命令等价
```

浏览器打开 `http://127.0.0.1:8000/` 即完整应用。`vite.config.ts` 的 `base: './'`
正是为此静态托管而设。

**服务模式与证据链开关**(默认 off = 单用户,actor 回退 OS 用户;逐位行为不变):

| 环境变量 | 作用 |
|---|---|
| `PSA_AUTH=local` | 开启本地认证/角色/会话(登录、送审、签发口令复核) |
| `PSA_CORS_ORIGINS` | server 模式下的 CORS 白名单(逗号分隔;默认空=仅同源) |
| `PSA_AI_ENABLED=1` | 开启 AI 草案管线(需供应商 API key,见 `docs/design/ai-live-run-runbook.md`) |

对外可达时才把 `--host` 设为 `0.0.0.0`,并同时配好 `PSA_AUTH` 与
`PSA_CORS_ORIGINS`;仅本机则保持 `127.0.0.1`。

### (c) Docker Desktop(附录草案)

Docker Desktop(WSL2 后端)可跑下面的**多阶段**镜像:Node 20 构建前端,
`python:3.12-slim` 装后端并复制 dist,`uvicorn` 一体服务。以下为草案,**未在仓库
落地文件**,按需自建 `Dockerfile`:

```dockerfile
# ---- 阶段 1:构建前端(Node 20,硬约束) ----
FROM node:20-bookworm AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build                         # 产出 /app/frontend/dist(tsc -b && vite build)

# ---- 阶段 2:后端运行(Python 3.12) ----
FROM python:3.12-slim AS runtime
WORKDIR /app
COPY pyproject.toml ./
COPY psaengine/ ./psaengine/
COPY bess/ ./bess/
COPY backend/ ./backend/
RUN pip install --no-cache-dir -e "."     # 运行期无需 [test];核心依赖均有 wheel
COPY --from=frontend /app/frontend/dist ./frontend/dist
EXPOSE 8000
# 对外服务用 0.0.0.0;server 模式再加 -e PSA_AUTH=local -e PSA_CORS_ORIGINS=...
CMD ["python", "-m", "uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
```

构建/运行:`docker build -t bess-psa . && docker run -p 8000:8000 bess-psa`,
浏览器开 `http://127.0.0.1:8000/`。镜像不含 CUDD(与原生 Windows 同,parity 交由
CI);如需 CUDD 可在阶段 2 加 `build-essential + cython` 并按 §1.6 配方编译。

---

## 4. 门禁与规矩

### 4.1 clone 后先跑四道门

新机器克隆后,提交任何改动前先在本地过四道门(与根 `CLAUDE.md` 口径一致):

| 门 | WSL/Linux | 原生 Windows |
|---|---|---|
| pytest(非 benchmark) | `make test-py` | `.\.venv\Scripts\python.exe -m pytest -q --ignore=tests/benchmark` |
| benchmark(引擎强制门) | `make benchmark` | `.\.venv\Scripts\python.exe -m pytest -q tests/benchmark` |
| vitest | `make test-fe` | `npm --prefix frontend run test` |
| tsc -b(类型门) | `npx tsc -b`(在 frontend/) | `npm --prefix frontend exec tsc -- -b` |

参考基线(见 `CLAUDE.md` Current state):Python 366 collected(含 24 benchmark
逐位)、前端 281、bundle 2.78MB。原生 Windows 上 Python 侧会**多 3 个 skip**
(§2.1 的 CUDD 用例),属预期。

### 4.2 CI 在 GitHub 上同样四作业阻断

`.github/workflows/ci.yml` 有**四个全绿全阻断**的作业(均 `ubuntu-latest`):

1. **Python tests** —— `pytest -q --ignore=tests/benchmark`
2. **Engine benchmark corpus** —— `pytest -q tests/benchmark`
3. **CUDD backend parity (Linux)** —— 源码编译 `dd.cudd` 后跑 `tests/test_dd_parity.py`
   (2026-07-15 首跑即过,已提升为阻断门 / parity Gap 6b 收口)
4. **Frontend tests + build** —— `npm ci && npm run test && npm run build`

所以你在 Windows 本地无法跑的第 3 项(CUDD),CI 会在 Linux 上替你把关;push 到
`main` 或开 PR 都会触发。**本地绿不等于可合并,以 CI 四作业全绿为准。**

### 4.3 「后 Fable 运行规则」在 Windows 上同样生效

换到 Windows 机器**不改变**根 `CLAUDE.md`「后 Fable 运行规则」的分级授权。
**禁独改清单**(须已有 Fable 级规格 + 锚点测试在先,否则积压 backlog)照旧约束:

- `psaengine/`、`bess/` 的数值**语义**;
- 隔离/状态机/并发路径(`projectStore`、persistence hook、`store.py` 事务);
- 密码学/会话/身份;
- 监管口径声明(报告/组合总览聚合口径)。

**可放行**的仍是 UI/换皮、报表布局、数据录入、文档、既有锁测覆盖内的重构、按已
评审规格的机械实现。绊线清单见
`docs/reviews/2026-07-14-guardrail-tripwire-audit.md`。

### 4.4 技能/规格随仓库走,新机零额外配置

工作方法全部在仓库内、随 clone 而来,**新机器无需任何额外配置**:

- `.claude/skills/`(5 领域 + 9 流程技能)、`.claude/agents/`(评审/实现代理);
- `docs/superpowers/{specs,plans,ROADMAP.md}`(逐特性规格 / 计划 / 台账);
- `docs/reviews/`、`docs/design/`(评审存档、设计规范与策略)。

Per-feature 循环(`blindspot-pass → interview-me → plan-feature → 实现 →
verify-psa → change-quiz → ROADMAP 追加`)与 `verify-psa` 的对抗审查升级规则
在 Windows 上照常执行 —— 隔离/状态机/并发类改动即便套件全绿仍须冷读审查,无
Fable 级模型时该类改动直接积压。

---

## 附:排障速查

| 现象 | 处置 |
|---|---|
| `tests/test_dd_parity.py` 有 3 个 skip | 原生 Windows 预期(无 CUDD);见 §2.1 |
| `dd.autoref` 关闭期析构告警 | 无害,不影响通过;见 §2.1 |
| PowerShell 打印中文乱码 | `chcp 65001` 或用 Windows Terminal + PS7;见 §2.4 |
| 打开 `:8000` 只见「前端未构建」占位页 | 先 `npm --prefix frontend run build` 生成 `frontend/dist`;见 §3(b) |
| `node -v` 不是 v20 | `nvm use 20`;硬约束勿升级 |
| WSL 里 `npm ci` 极慢 | 确认仓库在 `~/…` 而非 `/mnt/c/…`;见 §1.1 |
