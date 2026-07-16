# BESS PSA / QRA 工具

面向储能系统(BESS)锂离子电池热失控风险的概率安全评价(PSA/QRA)工具:
RiskSpectrum 对标的精确定量后端 + 新一代工作台 UX + AI 辅助 ETA/FTA 生成,
面向监管评审——证据链(版本库/审计/评审签发/认证)是产品能力而非附属文书。

## 架构

| 层 | 目录 | 职责 |
|---|---|---|
| 通用引擎 | `psaengine/` | FTA/ETA 精确定量:ROBDD/ZBDD、最小割集、精确概率、重要度、不确定性、CCF、Open-PSA MEF XML |
| BESS 领域 | `bess/` | 热失控事件树与场景、分级参考库(A–D 置信 + 来源引用)、C1–C5 后果分级、报告数据 |
| 后端 | `backend/` | FastAPI + 证据链核心(内容寻址版本库/只增审计/分析案例/评审状态机/本地认证)、组合总览 API、Word/PDF/CSV 导出、AI 管线(默认关闭,`PSA_AI_ENABLED` 开启) |
| 前端 | `frontend/` | React 18 + TypeScript 探索者壳(菜单栏/项目树/状态栏),多项目工作台:总览/ETA/FTA/参数库/参考库/后果/FMEA/报告证据链/组合总览 |

## 环境准备(macOS,主开发平台)

工具链:[uv](https://docs.astral.sh/uv/)(管理 Python 3.12 与 `.venv`)+
[nvm](https://github.com/nvm-sh/nvm)(Node 20)。首次安装:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 20

make setup     # = uv venv(Python 3.12)+ pip install -e ".[test]" + npm ci
```

日常命令(完整清单见 `Makefile`):

```bash
make test        # 前后端全部测试(不含 benchmark)
make benchmark   # 引擎基准对标(SCRAM/OpenFTA):引擎/数值改动的独立强制门,不在 make check 内
make check       # 提交前完整口径:git diff --check + 测试 + 构建(刻意不含 benchmark)
make backend     # FastAPI :8000(托管 frontend/dist)
make frontend    # Vite dev :5173
make run         # 构建前端并在 :8000 一体运行
make bundle      # 离线单文件 bess-eta-standalone.html
```

访问地址:前端 `http://127.0.0.1:5173/`,后端 API 文档 `http://127.0.0.1:8000/docs`。

## Windows(受支持)

开发与部署走 [docs/design/windows-dev-runbook.md](docs/design/windows-dev-runbook.md):
日常开发推荐 WSL2(与 CI 同构,`Makefile` 直接可用),原生 Windows 为备选,
含三种部署形态与门禁口径。历史 PowerShell 入口已归档(`docs/archive/run.ps1`)。

## 基线(2026-07-15,`main`)

- 测试:Python 351 例 + 引擎 benchmark 24 例(SCRAM/OpenFTA 逐位对标)· 前端 Vitest 291 例。
- CI:[github.com/Aiden1981/PSA](https://github.com/Aiden1981/PSA) 四作业全绿且全部阻断
  (Python 测试 / 引擎基准 / CUDD Linux 后端一致性 / 前端测试+构建)。

## 主要功能

- **ETA/FTA 工作台**:内置 BESS 热失控场景、跳过式/级联式事件树、ETA 挂载故障树、最小割集/重要度/不确定性、风险矩阵、MEF/Open-PSA XML 导入导出。
- **参考库与参数库**:器件失效率、屏障 PFD、初因频率;置信分级 A–D、来源引用、现场贝叶斯更新。
- **FMEA/RPN**:从 ETA 与参考库导入,S/O/D 映射配置、RPN/AP、SxD 矩阵。
- **报告与证据链**:Word/PDF/CSV 导出;版本库/审计台账/评审签发/本地认证;组合总览跨项目聚合。
- **AI 辅助**:ETA/FTA 草案生成,输出恒标"AI 草案,待人工审核"、默认 D 级。
- **离线包**:`make bundle` 生成单文件 `bess-eta-standalone.html`。

## 文档

- [TD-001 技术文档与算法手册(Rev C,权威)](docs/BESS-PSA-TD-001-技术文档.html)——方法基础/算法详解/工具手册/SOTA 对比;Word 版同目录
- [docs/ 目录地图](docs/README.md)——全部规格/评审/设计文档的索引;旧手册归档于 `docs/archive/`
- [路线图与实施台账](docs/superpowers/ROADMAP.md)
- [AI 模型策略](docs/design/ai-model-strategy.md)
- 开发协作约定:根 `CLAUDE.md` + `.claude/skills/` + `.claude/agents/`
