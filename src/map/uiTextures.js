import * as THREE from 'three'

/**
 * uiTextures.js — процедурные текстуры интерфейса карты (без внешних файлов):
 * гало звёзд, плотное ядро точки, подписи систем и секторов.
 */

/** Мягкое широкое гало — для ореолов звёзд и свечения ядра. */
export function makeGlowTexture(size = 128) {
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grd.addColorStop(0.00, 'rgba(255,255,255,1)')
    grd.addColorStop(0.13, 'rgba(255,255,255,0.95)')
    grd.addColorStop(0.28, 'rgba(255,255,255,0.30)')
    grd.addColorStop(0.55, 'rgba(255,255,255,0.08)')
    grd.addColorStop(1.00, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
}

/** Плотное ядро + короткое гало — для точек-звёзд (чтобы не было «боке»). */
export function makeStarTexture(size = 64) {
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grd.addColorStop(0.00, 'rgba(255,255,255,1)')
    grd.addColorStop(0.22, 'rgba(255,255,255,0.95)')
    grd.addColorStop(0.42, 'rgba(255,255,255,0.22)')
    grd.addColorStop(0.70, 'rgba(255,255,255,0.05)')
    grd.addColorStop(1.00, 'rgba(255,255,255,0)')
    g.fillStyle = grd
    g.fillRect(0, 0, size, size)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
}

/**
 * Ромбическая метка узла карты (маркер системы в стиле картографических приборов).
 * Рисует ромб с засечками; `filled` — залитый (обследован) или контур (нет).
 */
export function makeNodeTexture(filled = false, color = '#e0b84f') {
    const s = 96
    const c = document.createElement('canvas')
    c.width = c.height = s
    const g = c.getContext('2d')
    g.translate(s / 2, s / 2)
    g.rotate(Math.PI / 4)
    const r = s * 0.30
    g.lineWidth = 5
    g.strokeStyle = color
    g.shadowColor = color
    g.shadowBlur = 10
    if (filled) {
        g.fillStyle = color
        g.fillRect(-r, -r, r * 2, r * 2)
    } else {
        g.strokeRect(-r, -r, r * 2, r * 2)
    }
    // засечки по углам (крест-прицел)
    g.shadowBlur = 0
    g.lineWidth = 3
    const t = r + 10
    g.beginPath()
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        g.moveTo(sx * r, sy * r)
        g.lineTo(sx * t, sy * t)
    }
    g.stroke()
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
}

const labelCache = new Map()
/** Подпись: крупное имя + мелкий сектор/роль под ним. Кэш по содержимому. */
export function makeLabelTexture(text, sub = '') {
    const k = text + '|' + sub
    if (labelCache.has(k)) return labelCache.get(k)
    const pad = 12, fs = 42, fs2 = 26
    const mono = 'ui-monospace, Menlo, Consolas, monospace'
    const font1 = '600 ' + fs + 'px ' + mono
    const font2 = '400 ' + fs2 + 'px ' + mono
    const c = document.createElement('canvas')
    const g = c.getContext('2d')
    g.font = font1
    const w1 = g.measureText(text).width
    let w2 = 0
    if (sub) { g.font = font2; w2 = g.measureText(sub).width }
    c.width = Math.ceil(Math.max(w1, w2) + pad * 2)
    c.height = Math.ceil(fs + (sub ? fs2 + 4 : 0) + pad * 2)
    const g2 = c.getContext('2d')
    g2.textBaseline = 'top'
    g2.shadowColor = 'rgba(0,0,0,0.95)'
    g2.shadowBlur = 10
    g2.font = font1
    g2.fillStyle = '#f0e6cc'
    g2.fillText(text, pad, pad)
    if (sub) {
        g2.font = font2
        g2.fillStyle = 'rgba(224,184,79,0.85)'
        g2.fillText(sub, pad, pad + fs + 4)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.minFilter = THREE.LinearFilter
    tex.generateMipmaps = false
    const out = { tex, w: c.width, h: c.height }
    labelCache.set(k, out)
    return out
}
