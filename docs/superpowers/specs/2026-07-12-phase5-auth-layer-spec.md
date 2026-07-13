# Phase 5 · 认证层实施规格(auth overlay + 修复项 1-3 + 并发冲突)

*2026-07-12 · 状态:**已实施(B1–B5 全部完成)**,Phase 5 收官 · 决策来源:ADR-4
`2026-07-10-adr4-multiuser-design.md`(D-P5-2 本地账户 / D-P5-3 三角色 / D-P5-4 乐观并发 /
修复项 1-3 / 约束 #0)· 评审签发工作流已落地(`fb07019`),本规格是 Phase 5 最后一块 ·
实施记录见 ROADMAP 2026-07-12 收尾条目;提交范围 `e0e6c6c`..`ac83512`(18 个提交)*

## 0 · 范围与非目标

**做**:`PSA_AUTH=off|local` 部署开关;本地账户(argon2id)+ HttpOnly 会话 cookie +
provider 接口;身份贯通 `store.actor()`;三角色路由守卫;修复项 1-3(api.ts 401 地雷 /
actor 会话身份 / CORS 收紧);乐观并发 409 冲突流 + 前端三路径对话;登录页 + 角色感知 UI。

**不做(留缝)**:OIDC/SSO provider(接口预留,`local` 是第一个实现);项目级 ACL
(全局可见,D-P5-3);check-out 锁(否决,乐观并发);CRDT(Phase 6)。

**约束 #0 是最高优先不变量**:`PSA_AUTH=off`(默认)下,现全部行为**逐位不变** ——
离线单文件、本地免登录、OS-用户 actor、localStorage 回退全部保留。认证是叠加层,
不是代码分叉。每个批次的验收都含 off 模式回归门。

## 1 · 模型分配(用户手动切换;每批次同构,批次边界=停点)

| 批次 | 模型 | 内容 |
|---|---|---|
| **B1** | **Opus 4.8** | 本规格 + CORS 收紧 + `PSA_AUTH` 模式脚手架(非加密配置) |
| **B2** | **Fable 5** | auth 核心(accounts/argon2id · sessions/cookie · provider)+ actor 身份 + api.ts 401 地雷 —— 安全关键簇 |
| **B3** | **Opus 4.8** | 三角色路由守卫 + 乐观并发 409 后端 |
| **B4** | **Sonnet 5**(`frontend-dev` 子代理) | 登录页 + 角色感知 UI + 409 冲突三路径对话 |
| **B5** | **Opus / Haiku** | 探针 P1/P3 + 验收回归 + closeout(bundle + check + ROADMAP) |

**B2 安全常量(已钉定,2026-07-12 Fable 批次)**:
- argon2id 用 argon2-cffi **库默认**(25.1.0:t=3、m=64 MiB、p=4、16B 盐)——随库演进,
  `check_needs_rehash` 在成功登录时透明升级旧哈希;口令最短 8 字符(长度是底线,不推复杂度规则)。
- 会话 token = `secrets.token_urlsafe(32)`(256 bit);**库中只存 sha256(token)**——
  备份=库文件拷贝(ADR-4),库泄露不得等于会话劫持(对规格 §4.1 DDL 的语义细化)。
- Cookie `psa_session`:HttpOnly + SameSite=Lax + Secure 跟随请求 scheme(反代终结 TLS 时
  `uvicorn --proxy-headers`)+ Max-Age=TTL。
- TTL 12h,消耗过半滑动续期(写库有界);过期懒删;**停用账户即撤销全部在途会话**。
- 枚举防御:未知用户走 dummy-hash 等时校验;未知/错口令/停用一律 401「用户名或口令错误」,
  真实原因只进审计(`auth.login_failed`);登录限速留 future(内网 3-10 人)。
- 引导:`python -m backend.auth.create_account <user> --role admin`(口令 getpass 交互,
  **绝不走 argv**——ps/shell 历史泄漏)。
**B2 完成后强制 `domain-reviewer`(fable)轻扫** actor/签发身份进报告页脚的口径。

**domain-review 结论(2026-07-12,PASS,0 blocker)**——已落码:finding-1 每行审计
details 注入 `auth: off|local` 标记(同链区分 OS 用户行与认证行);finding-7 签发行禁删
触发器(对称硬化)。**移交 B3**:finding-3 签发/退回审计 details 须快照 `role`
(签发授权依据不得依赖可变的 accounts 表;display_name 若上页脚也须签发时快照)。
**文档化决定**(不改码):finding-2 actor 后缀 `@bess-psa/<ver>` = 记录时工具版本,
与页脚"引擎"字段(计算时版本)可合法不同 —— 报告附录须写明;finding-4 off 模式签发
身份 = 环境派生 OS 用户且 submitter==signer(自审非独立评审)—— 方法学文档规定
**正式对外提交须 PSA_AUTH=local**(桌面工具惯例 RS 同为 OS 戳,可辩护);finding-5
login_failed 审计记录尝试用户名,只增日志不可事后涂抹(误把口令输进用户名框即永久
留痕)—— 接受该风险并记录于此,project_uuid=NULL 使其不出现在任何项目过滤读面;
finding-6 **B3 守卫落地前不得部署 local 模式**(端点未被门禁,签发会记为守护进程 OS 用户)。

## 2 · 模式脚手架(B1,Opus · `backend/auth/mode.py` 新建)

```python
# PSA_AUTH 部署开关:off(默认,现行为)| local(登录墙 + 会话身份)
def auth_mode() -> str:            # 读 env,未知值→"off",大小写不敏感
    return "local" if os.environ.get("PSA_AUTH", "").lower() == "local" else "off"
def is_server_mode() -> bool:      # 语义别名,守卫/CORS/actor 判据
    return auth_mode() == "local"
```

- 纯读 env,无副作用,无状态;测试用 `monkeypatch.setenv`。
- **默认 off**:未设或任何非 `local` 值 → off(约束 #0 安全默认;宁可少拦不可误开)。
- 这是唯一的模式判据入口;B2/B3 的所有 enforcement 点都调它,不散读 env。

## 3 · CORS 收紧(B1,Opus · `backend/app.py:18-19`)

现 `allow_origins=["*"]`。改:server 模式读 `PSA_CORS_ORIGINS`(逗号分隔白名单,
默认空=同源)→ 传具体 origins;off 模式**保持 `["*"]`**(本地/离线开发不变,约束 #0)。

```python
_origins = ["*"] if not is_server_mode() else [
    o.strip() for o in os.environ.get("PSA_CORS_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])
```

注:`allow_credentials=True`(cookie 需要)与 `allow_origins=["*"]` 在 CORS 规范下
不能并存于凭据请求 —— off 模式无 cookie 无妨;server 模式必走白名单,天然一致。
测试:off → `*`;设 `PSA_AUTH=local` + `PSA_CORS_ORIGINS=https://a,https://b` → 两个 origin。

## 4 · auth 核心(B2,Fable · `backend/auth/` + store 表)

### 4.1 存储(`store.py` DDL 追加,idiom 同 reviews)

```sql
CREATE TABLE IF NOT EXISTS accounts(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pw_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','analyst','reviewer')),
  display_name TEXT, created_at TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL);
```

函数:`create_account(username, password, role, display_name=None)`(argon2id 哈希;
重名 → IntegrityError)· `verify_credentials(username, password) -> account|None`
(argon2 verify;disabled 账户拒绝;哈希失败恒定时间)· `create_session/get_session/
delete_session`(TTL 过期即失效)· `set_password` · `set_disabled`。审计:
`account.create` / `account.disable` / `auth.login` / `auth.logout`(actor=操作者)。

### 4.2 provider 接口(`backend/auth/provider.py`)

```python
class AuthProvider(Protocol):
    def authenticate(self, username, password) -> Optional[Identity]: ...
class LocalProvider:   # 第一个实现,包 verify_credentials + create_session
    ...
# 将来 OidcProvider 实现同协议;auth_mode 之外的第二维扩展点。
```

### 4.3 API(`backend/app.py` 或 `backend/auth/routes.py`)

| 端点 | 语义 |
|---|---|
| `POST /api/auth/login` `{username,password}` | 验证 → Set-Cookie(HttpOnly session)→ 返回 `{username,role,display_name}`;失败 401 |
| `POST /api/auth/logout` | 删会话 + 清 cookie |
| `GET /api/auth/me` | 当前身份(cookie 无效→401);前端启动判登录态 |
| `POST /api/admin/accounts` 等 | 账户 CRUD,**admin only**(B3 守卫) |

`current_identity(request) -> Identity|None`:读 cookie → get_session → account。
off 模式:恒返回 OS 用户身份(`getpass`),`/api/auth/*` 可返回 501/未启用。

### 4.4 actor 身份贯通(修复项 ②,`store.py:104`)

`actor()` 现 `getpass.getuser()`。改为:**server 模式**取当前会话身份
(用户名 + 引擎版本),**off 模式**沿用 OS 用户(现行为,约束 #0 不破审计)。
难点:`store.actor()` 是无参函数,被 record_audit 深处调用 —— 用 **contextvar**
(`_current_actor: ContextVar`)在请求中间件里 set,actor() 优先读 contextvar,
空则回退 getpass。中间件只在 server 模式 set。测试:off 模式 actor 不变(逐位回归)。

### 4.5 api.ts 401 地雷(修复项 ①,`frontend/src/api.ts:155-199`)

现 `/api/saved` 全家 `catch → lsSave`(旗标"离线存档")。**区分**:
- **网络不可达**(fetch reject / TypeError)→ localStorage 回退**仅当** off 模式(探测:
  启动时 `GET /api/auth/me`,401 或明确 local → server 模式旗标);
- **401/403**(`r.status`)→ **绝不回退**,抛显式"未登录/无权限",前端弹登录页。

关键:现在的 `catch` 吞掉了 `!r.ok` 之后 throw 的 Error —— 要在 catch 里辨别
"HTTP 错误(有 status)" vs "网络异常(无 response)",前者按状态码显式处理。

## 5 · 三角色守卫 + 并发冲突(B3,Opus)

### 5.1 路由守卫(`backend/auth/guards.py`)

FastAPI 依赖:`require_role(*roles)` → server 模式校验 current_identity.role ∈ roles,
否则 403;off 模式放行(单用户即全权)。挂载:
- 分析端点(quantify / event-tree / report / import)= analyst+(analyst|admin)
- 签发/退回(reviews sign/return)= reviewer+(reviewer|admin);送审 = analyst+
- 账户管理 = admin only
- 签发口令复核:sign 端点已预留 `password` 字段(app.py:366)→ server 模式二次校验
  当前用户口令,off 忽略。
- **domain-review finding-3(移交项)**:签发/退回的审计 details 快照会话 `role`
  ——"签发人当时持评审人角色"必须可从只增链重建,不得依赖可变的 accounts 表。
矩阵测试:analyst 不可签发(403)、reviewer 不可改模型(403)、admin 可建账户。

### 5.2 乐观并发 409(修复项延伸,D-P5-4)

`POST /api/saved` 携带可选 `base_version_hash`。服务器:项目最新版本哈希 ≠ base
且 base 非空 → **409** + `{server_hash, base_hash}`(不覆盖工作区头)。
版本库内容寻址已保底双方版本俱在(ADR-2)—— 409 只是让前端有机会选路,不是防丢。
`SaveWorkspaceRequest` 加 `base_version_hash: str | None`。测试:双客户端交替保存
→ 后者带旧 base → 409;不带 base(单用户/首存)→ 正常(现行为)。

## 6 · 前端(B4,Sonnet via frontend-dev)

- **登录页**:PSA_AUTH=local 且未登录 → 登录墙(用户名/口令 → `login()` → 存身份)。
  off 模式或已登录 → 直接进 workbench。启动 `getMe()` 判定。
- **角色感知 UI**:reviewer 隐藏建模写操作入口;analyst 隐藏签发按钮(后端已守卫,
  前端只是不呈现);admin 多账户管理面。角色来自 `getMe()`。
- **409 冲突对话**:保存 → 409 → 弹窗三路径:①查看双方 diff(复用版本对比组件)、
  ②另存副本(新 sid)、③确认覆盖(重发不带 base)。任一路径零数据丢失(版本库双方在)。
- api.ts:`login/logout/getMe`、saveWorkspace 加 base_version_hash 参数 + 409 分支。

## 7 · 依赖

`pyproject.toml` dependencies 加 `argon2-cffi>=23.1`(B2 前置)。无其他新增
(会话用 stdlib secrets;cookie 用 Starlette 原生;不引 python-jose/passlib)。

## 8 · 实施顺序(TDD 一任务一提交;批次边界停点换模型)

B1: ①本规格 ②CORS + mode 脚手架(+测试)。
B2: ③argon2-cffi 依赖 + accounts/sessions store + 测试 ④provider + login/logout/me + 测试
⑤actor contextvar 贯通(off 回归)⑥api.ts 401 地雷辨别 + vitest → **domain-reviewer 轻扫**。
B3: ⑦三角色守卫 + 矩阵测试 ⑧base_version_hash 409 + 测试。
B4: ⑨登录页 + 角色感知 UI + 冲突对话(frontend-dev)+ vitest。
B5: ⑩探针 P1(双客户端 LWW)/P3(SQLite 并发写基准)⑪验收全套 + bundle + check + ROADMAP。

## 9 · 验收(实施期 · 约束 #0 是回归门)

- **off 模式**:现全部 py 255 + fe 218 逐位不变;离线单文件行为不变;actor=OS 用户;
  `/api/auth/*` 不干扰。**每批次跑此门**。
- **local 模式**:未登录 → API 401 / 前端登录页;三角色路由矩阵;会话过期 → 显式提示
  不丢编辑(本地草稿暂存);签发口令复核。
- **并发**:双客户端同项目 → 后者 409 → 三路径全可走,零丢失(版本台账双方可见)。
- **证据链**:server 模式签发/AI 应用/贝叶斯升 A 的审计行携带认证身份;签发进报告页脚;
  审计只增性质测试仍绿。
- **迁移**:单机 `data/projects.db` 导入共享服务器幂等无损。

## 10 · 实施结果(2026-07-12,对照 §8 计划)

六批全部落地,`e0e6c6c`..`ac83512`(18 commits)。py 255→307、fe 218→239,off 模式
每批次回归绿(约束 #0 全程未破)。三处偏离/超出原计划,均记录在案:

- **P3 探针意外揪出真 bug**:`create_version` 的 check-then-insert 在并发下有竞态——
  两线程都没查到既有版本、都尝试 INSERT,后者撞 `UNIQUE(project_uuid,content_hash)`
  崩溃,而不是按 ADR-2 D6 承诺的"同内容→幂等命中"退让。16 线程 Barrier 强制撞车
  复现后修复(捕获 IntegrityError → 按幂等命中处理)。ADR-2 的幂等承诺此前只在**顺序**
  调用下成立,现在并发下也成立。测试:`test_p3_sqlite_concurrency.py`。
- **会话过期草稿暂存**(spec §9 原有条目,§2-§7 未单列实施小节):落在
  `features/persistence/sessionDraft.ts`(纯模块,同目录 bootstrap.ts/projectIo.ts
  的既有分解模式)+ `useProjectPersistence.ts` 的 `onSaveWorkspace`/`onSaveAs` catch
  分支 + `App.tsx` 顶部横幅(恢复/丢弃两个显式动作,不自动覆盖当前编辑)。复查自己的
  改动时发现一个真 bug 并当场修:新项目首次保存分支里,用户刚输入的项目名活在
  `else{}` 块作用域,catch 分支拿不到,会话过期时草稿会存成兜底名"ETA 项目"而不是
  用户实际输入的名字——已把取名逻辑提到 try 外统一处理。
- **迁移验收 = 验证既有设计,不是写新迁移代码**:没有"导入"端点——机制就是拷贝
  db 文件,之所以安全,是 ADR-2 三个已有设计决策的合力(uuid 派生的项目身份、内容
  哈希寻址的版本、`_conn()` 每次开库都幂等重跑全量 DDL)。测试用手搭一个
  Phase-5-之前形状的三表库,验证当前代码打开它零迁移脚本、新表自动就位、
  重复"拷贝"(重新指向同一文件)不重复写。见 `test_migration_idempotent.py`。

domain-reviewer 于 B2 完成后轻扫过身份链路(PASS,0 blocker;2 项已落码 —— 每条审计
携带 `auth: off|local` 标记、签发行禁删触发器;3 项文档化决定见 §4 段落)。
