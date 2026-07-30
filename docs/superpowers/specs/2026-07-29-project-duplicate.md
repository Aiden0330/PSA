# 规格:项目复制(以现有项目为底创建新项目)

触点:`projectStore`(多项目槽注册表——**禁独改区**,故本规格 + 锚点先行)+
项目总览页按钮。

## 1. 语义:复制 = 新草稿槽 + 深克隆文档 + **全新空身份**

- 复制走 `openProject` 同构路径:停放当前活动槽,新开 `draft:*` 槽。
- **身份三清零**:`savedId=''`、`projectUuid=''`、`lastVersionHash` 不带
  (CAS 基线不得跨项目泄漏)。`displayName` = 用户输入(默认「原名 副本」)。
  ⇒ 首次保存即创建**新存档 + 新版本库项目 + 新证据链**;源项目的版本历史/审计/
  分析案例**不克隆**——它们是源项目身份的证据,复制品从零开始自己的链
  (监管语义:副本的第一版就是副本的起点)。
  ⇒ 绝无覆写源档案可能(R2-审 F1 跨项目存档覆盖的结构性排除)。
- **深克隆**(house 惯例 JSON 往返):etas + userFts + checkedKeys + FMEA
  行/映射。改副本不得触源(跨项目串染 = 溯源违规级缺陷,锚点断言引用不等 +
  值不变)。
- **派生 PFD 物化**:克隆时把活动侧表 `pfds` 合并进各 ETA 的静态 `pfds` 字段
  (副本打开即显当前派生值;它们是派生缓存,重量化再生)。
- **撤销历史不带**(past/future 清空):副本是新文档谱系,undo 不得走进源
  项目的编辑史。
- activeKey 保留(打开同一页签),openOrder 尾插新槽并激活(openProject 同式)。

## 2. UI

项目总览页「保存项目」旁新增「复制项目」:`window.prompt` 取名(默认
「{当前名} 副本」,取消即中止)→ `duplicateActiveProject(name)` → 副本即成
活动项目(顶栏显「未存档项目」草稿态,树显新名)。按钮永不禁用(草稿也可复制)。

## 3. 锚点(frontend/src/stores/projectStore.duplicate.test.ts)

D-1 新槽:workspaceId 变(draft:*),identity 三清零 + displayName;源槽停放,
身份逐字段原样。D-2 深隔离:改副本 ETA 模型/FMEA,源停放槽文档与 FMEA 逐位不动
(且引用不等)。D-3 派生物化:源侧表 pfds 值出现在副本 etas 静态 pfds 与副本
侧表。D-4 历史清零:past/future 空。D-5 openOrder:源在前副本在后,副本活动。
D-6 lastVersionHash 不带。UI 锁:按钮存在,prompt 确认后店内 displayName 落新名。
