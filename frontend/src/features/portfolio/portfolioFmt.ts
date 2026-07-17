// 组合总览数值格式化。抽到独立文件的两个原因:
//  1. 合法 0(零风险,已量化)与 undefined/null(未量化)必须区分——0 显示 0.0e+0,只有缺值才 '—';
//  2. PortfolioTab.tsx 是组件文件,导出非组件符号会触发 react-refresh/only-export-components 门。
export const fmtE = (x: number | undefined | null): string => (x == null ? '—' : x.toExponential(2))
