// 单一 RFC 4180 CSV 编码器 + 电子表格公式注入防护(FE-12)。
// 转义:内部 `"` 翻倍;字段含 `" , \r \n` 才整体包引号;文档行尾 CRLF。
// 公式注入:字段以 `= + - @` 或前导 TAB/CR 开头时,Excel/LibreOffice 可能把它当公式执行
//   (=HYPERLINK/DDE/命令等)。策略:前置单引号 `'` 使其被当作纯文本;可见内容不变,
//   仅打开时不再求值。前置在包引号之前进行,故仍会按需被引号包裹。

const NEEDS_QUOTE = /[",\r\n]/
const FORMULA_LEAD = /^[=+\-@\t\r]/

/** 编码单个字段(含公式中和 + RFC 4180 转义)。 */
export function csvField(value: unknown): string {
  let s = value == null ? '' : String(value)
  if (FORMULA_LEAD.test(s)) s = "'" + s
  if (NEEDS_QUOTE.test(s)) s = '"' + s.replace(/"/g, '""') + '"'
  return s
}

/** 编码一行(逗号连接,逐字段转义)。 */
export function csvRow(fields: readonly unknown[]): string {
  return fields.map(csvField).join(',')
}

/** 编码整表(行以 CRLF 连接)。不含 BOM——由调用方按需前置 UTF-8 BOM。 */
export function csvDocument(rows: readonly (readonly unknown[])[]): string {
  return rows.map(csvRow).join('\r\n')
}
