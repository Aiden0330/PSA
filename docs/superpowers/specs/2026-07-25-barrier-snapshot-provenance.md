# 规格:屏障库引用快照补全(grade/note/url/category)+ 手改失效

*2026-07-25 · Fable 5 · 源:参考库审计 §7.2-1(F-1 只能改名兜底的底层原因)。
CLAUDE.md 已声明的语义:"节点从库引用时快照 grade;手改数值即清快照(按 D 计并标注)"
—— 本规格是让实现追上声明,非新语义。*

## 1 · 现状与缺口

- `eventtree.ts:296` `addBarrierFromLib` 只快照 `name/pfd/citation`;`FuncEvent.grade`
  字段**已存在**(贝叶斯路径在用),检视器 281 行**已渲染**置信徽章 —— 缺口只在入口。
- `setFailProb`(手改 PFD 唯一咽喉)不清快照:改完值后 grade 徽章仍显示库分级,
  **展示的是不再成立的置信声明**。
- canonical 层:`Source{citation,url,note}` 与 `Provenance.grade` **既有 schema 已够用**,
  `_prov_from_fe` 只是没读 url/note;`_FE_OPT_FIELDS` 白名单没有新键。

## 2 · 语义(按易变序)

1. **快照集** = `grade` + `note`(source.note,口径警示所在)+ `url`(可点核对)+
   `category`(warning/active/passive)+ 既有 `citation`。`LibBarrier` 类型随之加宽。
   undefined 键不落对象(JSON 边界会丢 undefined,模型保持无冗键)。
2. **手改失效**(仅 `setFailProb`;贝叶斯 `applyFieldUpdate` 有意设 A,不受影响):
   值**实际变化**且 `grade` 存在 ⇒ `grade→'D'` + `evidence` 追加
   `手改数值,库快照失效(原 <grade>/<value>)`;`citation/url/note/category` **保留**
   (出处事实不因手改消失,失效的是置信分级)。值未变/无 grade ⇒ 恒等。
3. **canonical 往返**:`_FE_OPT_FIELDS += ["url","note"]`;`_prov_from_fe` 把 url/note
   并进 `Source`;emit 侧按 `present` 门控回写。`category` 走侧车
   `fe_fields[ref]["category"]`(linkFt_raw 先例)——展示性分类,不进签名内容;
   **哈希不变量**:旧载荷(无新键)canonical 文档逐位不变(既有金锚哈希测试为证)。
4. **检视器**:置信行追加 category 徽章、note 悬浮(title)、url ↗ 外链
   (`_blank + noopener noreferrer`,同参考库表格样式)。

## 3 · 锚点

- vitest `eventtree.barrierSnapshot.test.ts`:快照五字段;undefined 不落键;
  手改失效矩阵(变+有级→D+标注+出处保留 ‖ 不变→恒等 ‖ 无级→恒等);贝叶斯 A 路径不受扰。
- py canonical:带新字段 FE 往返逐位;legacy FE(仅 citation)往返不变;
  既有金锚哈希测试全绿即哈希不变量成立。

## 4 · 非目标

- FTA 侧 `addBasicFromLib` 的同构缺口(另立)。
- `origin="library"` 标记(FuncEvent 无 origin 字段,牵动面大)。
- 就绪性⊕有效性防双计元数据(审计 §7.2-5,设计题)。
