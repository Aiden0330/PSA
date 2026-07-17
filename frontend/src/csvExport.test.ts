import { describe, it, expect } from 'vitest'
import { csvField, csvRow, csvDocument } from './csvExport'

describe('csvField — RFC 4180 转义', () => {
  it('普通字段不加引号', () => {
    expect(csvField('abc')).toBe('abc')
    expect(csvField(42)).toBe('42')
    expect(csvField('')).toBe('')
    expect(csvField(null)).toBe('')
    expect(csvField(undefined)).toBe('')
  })
  it('内部双引号翻倍并整体包引号', () => {
    expect(csvField('a"b')).toBe('"a""b"')
    expect(csvField('"')).toBe('""""')
  })
  it('含逗号 → 包引号', () => {
    expect(csvField('a,b')).toBe('"a,b"')
  })
  it('含 CR/LF → 包引号(值内保留原换行)', () => {
    expect(csvField('a\r\nb')).toBe('"a\r\nb"')
    expect(csvField('a\nb')).toBe('"a\nb"')
  })
  it('Unicode 原样(无特殊字符不包引号)', () => {
    expect(csvField('电芯热失控')).toBe('电芯热失控')
  })
})

describe('csvField — 公式注入防护(前置单引号)', () => {
  it('=HYPERLINK(...) 前置单引号且因含引号/逗号再包引号', () => {
    expect(csvField('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"')
  })
  it('+cmd / -1+2 / @SUM(...) 前置单引号', () => {
    expect(csvField('+cmd')).toBe("'+cmd")
    expect(csvField('-1+2')).toBe("'-1+2")
    expect(csvField('@SUM(A1:A9)')).toBe("'@SUM(A1:A9)")
  })
  it('前导 TAB / CR 前置单引号', () => {
    expect(csvField('\tx')).toBe("'\tx")
    expect(csvField('\rx')).toBe('"\'\rx"') // \r 触发前置 + 包引号
  })
  it('正常正数/文本不受影响', () => {
    expect(csvField('240')).toBe('240')
    expect(csvField('高')).toBe('高')
    expect(csvField(8)).toBe('8')
  })
})

describe('csvRow / csvDocument', () => {
  it('行以逗号连接、字段各自转义', () => {
    expect(csvRow(['对象,含逗号', '失效"引号', 5])).toBe('"对象,含逗号","失效""引号",5')
  })
  it('文档以 CRLF 连接', () => {
    expect(csvDocument([['a', 'b'], ['c', 'd']])).toBe('a,b\r\nc,d')
  })
  it('公式注入字段在整表中被中和', () => {
    const doc = csvDocument([['对象', '来源'], ['=1+1', '@evil']])
    expect(doc).toContain("'=1+1")
    expect(doc).toContain("'@evil")
    expect(doc.split('\r\n')).toHaveLength(2)
  })
})
