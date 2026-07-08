/** 把 SVG 元素栅格化为 PNG dataURL(白底)。 */
export function svgToPng(svg: SVGSVGElement): Promise<string> {
  const xml = new XMLSerializer().serializeToString(svg)
  const w = svg.viewBox?.baseVal?.width || svg.clientWidth || +(svg.getAttribute('width') || 800)
  const h = svg.viewBox?.baseVal?.height || svg.clientHeight || +(svg.getAttribute('height') || 600)
  const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('no 2d ctx')); return }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h)
      ctx.drawImage(img, 0, 0, w, h)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = reject
    img.src = src
  })
}
