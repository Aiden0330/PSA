# BESS PSA / QRA 工具

面向储能系统(BESS)锂离子电池热失控风险的概率安全评价工具。项目把事件树(ETA)、故障树(FTA)、参考失效率/屏障有效性数据、FMEA/RPN、风险矩阵和报告导出串成一条可运行的工程链路。

## 当前基线

- 主开发平台为 **macOS**(本目录即 Git 仓库,分支 `main`);Windows 侧 `D:\PSA_BESS` 为历史基线,原 git 历史与 `D:\ETA_claude` 模板资产待迁移(见 ROADMAP)。
- Python 运行依赖和测试依赖已写入 `pyproject.toml`，本地 `.venv` 可用。
- 前端项目文件会保存/恢复 ETA、用户自建 FTA、FMEA 行数据和 FMEA 映射配置。
- 后端 JSON 响应显式声明 `application/json; charset=utf-8`，避免含中文接口在 Windows PowerShell 等客户端显示乱码。
- 最近一次基线验证（2026-07-07，macOS）：前端 Vitest 165 例通过、`vite build` 通过；Python 非 benchmark 测试 156 例通过、2 例跳过（CUDD 留待 Linux CI）；引擎 benchmark 24 例通过。

## 架构

| 层 | 目录 | 职责 |
|---|---|---|
| 通用引擎 | `psaengine/` | FTA/ETA 模型、BDD/ZBDD、最小割集、精确概率、重要度、不确定性、CCF、Open-PSA MEF XML |
| BESS 领域 | `bess/` | 热失控事件树、预置参考库、场景模型、C1-C5 后果分级、报告数据 |
| 后端 | `backend/` | FastAPI API、项目存档、MEF 导入、报告导出、前端静态托管 |
| 前端 | `frontend/` | React + TypeScript 工作台，提供 ETA/FTA/FMEA/参考库/后果/报告等界面 |

## 环境准备(macOS,主开发平台)

工具链:[uv](https://docs.astral.sh/uv/)(管理 Python 3.12 与 `.venv`)+ [nvm](https://github.com/nvm-sh/nvm)(Node 20)。首次安装:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 20

make setup     # = uv venv(Python 3.12)+ pip install -e ".[test]" + npm ci
```

日常命令(完整清单见 `Makefile`):

```bash
make test        # 前后端全部测试(不含 benchmark)
make benchmark   # 引擎基准对标(SCRAM/OpenFTA 参考值,已入 CI)
make check       # 提交前完整口径:git diff --check + 测试 + 构建
make backend     # FastAPI :8000(托管 frontend/dist)
make frontend    # Vite dev :5173
make run         # 构建前端并在 :8000 一体运行
make bundle      # 离线单文件 bess-eta-standalone.html
```

## 环境准备(Windows,遗留)

```powershell
cd D:\PSA_BESS

python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\python.exe -m pip install -e ".[test]"

npm --prefix frontend install
```

如果 PowerShell 直接查看中文响应仍出现乱码，可先设置当前终端为 UTF-8：

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
```

## 运行

macOS 一键运行（构建前端 + FastAPI 后端）：

```bash
make run          # 开发模式则分别：make backend + make frontend
```

Windows（遗留）一键运行：

```powershell
.\run.ps1
```

Windows 开发模式建议前后端分开启动：

```powershell
.\.venv\Scripts\python.exe -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
npm --prefix frontend run dev -- --host 127.0.0.1 --port 5173
```

访问地址：

- 前端：`http://127.0.0.1:5173/`
- 后端 API 文档：`http://127.0.0.1:8000/docs`

## 测试与构建

```powershell
git diff --check
npm --prefix frontend run test
npm --prefix frontend run build
.\.venv\Scripts\python.exe -m pytest -q --ignore=tests/benchmark
```

可选 benchmark：

```powershell
.\.venv\Scripts\python.exe -m pytest -q tests/benchmark
```

已知现象：

- Vite 构建会提示主 JS chunk 大于 500 kB，属于当前前端打包体积问题。
- Python 测试中 FastAPI `TestClient` 依赖会给出 Starlette/httpx deprecation warning。
- `dd.autoref` parity 测试在 Windows 下可能出现对象析构 warning，但不影响测试通过；CUDD 后端完整验证仍建议放到 Linux/WSL。

## 主要功能

- ETA 工作台：内置 BESS 热失控场景、自定义屏障、跳过式/级联式事件树、风险矩阵、事故序列路径。
- FTA 工作台：自建故障树、ETA 挂载故障树、最小割集、重要度、热力着色、MEF/Open-PSA XML 导入。
- 参考库：器件失效率、屏障 PFD、初因频率、来源引用、置信等级、现场贝叶斯更新。
- FMEA/RPN：从 ETA 和参考库导入，支持 S/O/D 映射配置、RPN/AP、SxD 矩阵、项目文件持久化。
- 报告：基于当前 ETA 重算并导出 Word/PDF/CSV。
- 离线包：`npm --prefix frontend run bundle` 可生成 `bess-eta-standalone.html`。

## 文档

- [使用手册](docs/USER_GUIDE.md)
- [算法设计说明](docs/ALGORITHM_DESIGN.md)
- [路线图与交接文档](docs/superpowers/ROADMAP.md)
- 开发协作约定：根 `CLAUDE.md` + `.claude/skills/`（4 领域 + 9 流程技能）+ `.claude/agents/`（3 评审/实现代理）
- [AI 模型策略](docs/design/ai-model-strategy.md)；原技能蓝图归档于 `docs/skill-blueprints/`

## 下一步建议

优先迁移 `D:\ETA_claude\eta-tool\src\data\templates.ts` 中的 ETA 模板，补齐“场景/模板库”能力；随后再推进 benchmark regression、参考数据来源校核、CUDD 大规模验证和前端 chunk 拆分。
