import * as THREE from 'three'
import { mulberry32 } from './rng.js'

/**
 * starMap.js — процедурная звёздная карта для демонстрации модуля камеры.
 *
 * Масштабы намеренно «настоящие», чтобы камера прошла весь путь:
 *   планета            r ≈ 0.7–4.6    юнита
 *   орбита планеты     34–400         юнитов
 *   соседние системы   ~4 000         юнитов
 *   сектор (клетка)    50 000         юнитов
 *   галактика          ~1 000 000     юнитов в диаметре
 * → 6 порядков. Именно на таком диапазоне ломаются линейные OrbitControls.
 *
 * Производительность:
 *  • 2500 звёзд — ОДИН THREE.Points с шейдером «постоянного экранного размера».
 *    Не 2500 спрайтов с пересчётом масштаба на CPU каждый кадр.
 *  • Пиканье звезды — аналитическая проекция в экран (O(N), ~0.2 мс), а не
 *    raycast по тысячам мешей. По планетам/солнцу — обычный raycaster.
 *  • Планеты, орбиты, свет и подписи создаются ТОЛЬКО для ближайших систем
 *    (LOD) и уничтожаются, когда вы улетели.
 */

export { mulberry32 }

export const MAP_CONFIG = {
    seed: 1337,
    systems: 2500,
    galaxyRadius: 500000,
    bulgeFrac: 0.22,
    arms: 4,
    armSpread: 0.34,
    diskThickness: 12000,

    sectorSize: 50000,
    sectorLevels: [50000, 250000],
    sectorFade: { fine: [6000, 150000], coarse: [110000, 1700000] },

    detailRadius: 9000,      // ближе — система «раскрывается»: планеты, орбиты, свет
    detailBudget: 14,        // максимум раскрытых систем одновременно
    labelRadius: 260000,
    labelBudget: 30,
    starSizePx: 10,          // базовый размер звезды на экране (в CSS-пикселях)
    pickRadiusPx: 24,        // допуск попадания по звезде, в пикселях
}

const CONSTELLATIONS = [
    'Андромеды', 'Кассиопеи', 'Цефея', 'Лиры', 'Лебедя', 'Орла', 'Персея', 'Дракона',
    'Пегаса', 'Тельца', 'Ориона', 'Гидры', 'Феникса', 'Волопаса', 'Павлина',
    'Жертвенника', 'Киля', 'Голубя', 'Ворона', 'Зайца', 'Волка', 'Скорпиона', 'Эридана',
]
const GREEK = ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ']
const CLASSES = [
    { c: 0x9db4ff, name: 'O', t: '30 000 K', w: 0.02 },
    { c: 0xc2d1ff, name: 'B', t: '15 000 K', w: 0.06 },
    { c: 0xeaf0ff, name: 'A', t: '9 000 K', w: 0.10 },
    { c: 0xfff6e0, name: 'F', t: '6 800 K', w: 0.16 },
    { c: 0xffe08a, name: 'G', t: '5 600 K', w: 0.22 },
    { c: 0xffab5e, name: 'K', t: '4 200 K', w: 0.26 },
    { c: 0xff6b4a, name: 'M', t: '3 100 K', w: 0.18 },
]
const PLANET_KINDS = [
    { name: 'Скалистый', color: 0x9a8f82 }, { name: 'Пустынный', color: 0xc9a06a },
    { name: 'Океанический', color: 0x3f7fbf }, { name: 'Ледяной', color: 0xbfe3f2 },
    { name: 'Газовый гигант', color: 0xd8b48a }, { name: 'Вулканический', color: 0xb4472f },
    { name: 'Заросший', color: 0x5f9a5a }, { name: 'Мёртвый', color: 0x6b6b70 },
]
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII']

/* ══════════════════ процедурные текстуры ══════════════════ */

/** Плотное ядро + короткое гало — для точек-звёзд (чтобы не было «боке»). */
function makeStarTexture(size = 64) {
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

function makeGlowTexture(size = 128) {
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

const labelCache = new Map()
function makeLabelTexture(text, sub = '') {
    const k = text + '|' + sub
    if (labelCache.has(k)) return labelCache.get(k)
    const pad = 12, fs = 42, fs2 = 27
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
    g2.fillStyle = '#eaf6ff'
    g2.fillText(text, pad, pad)
    if (sub) {
        g2.font = font2
        g2.fillStyle = 'rgba(150,200,225,0.9)'
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

/** Небо: полоса Млечного Пути + звёздная пыль. */
function makeSkyTexture(w = 2048, h = 1024, seed = 99) {
    const c = document.createElement('canvas')
    c.width = w; c.height = h
    const g = c.getContext('2d')
    const rnd = mulberry32(seed)

    g.fillStyle = '#01030a'
    g.fillRect(0, 0, w, h)

    g.save()
    g.translate(w / 2, h / 2); g.rotate(-0.30); g.translate(-w / 2, -h / 2)
    const band = g.createLinearGradient(0, h * 0.5 - h * 0.24, 0, h * 0.5 + h * 0.24)
    band.addColorStop(0.00, 'rgba(40,60,110,0)')
    band.addColorStop(0.32, 'rgba(70,95,150,0.15)')
    band.addColorStop(0.50, 'rgba(155,175,215,0.30)')
    band.addColorStop(0.68, 'rgba(70,95,150,0.15)')
    band.addColorStop(1.00, 'rgba(40,60,110,0)')
    g.fillStyle = band
    g.fillRect(-w, h * 0.5 - h * 0.28, w * 3, h * 0.56)
    for (let i = 0; i < 300; i++) {
        const x = rnd() * w
        const y = h / 2 + (rnd() - 0.5) * h * 0.34
        const r = 18 + rnd() * 150
        const a = 0.02 + rnd() * 0.075
        const col = rnd() > 0.72 ? 'rgba(195,160,225,' + a + ')' : 'rgba(120,160,220,' + a + ')'
        const rg = g.createRadialGradient(x, y, 0, x, y, r)
        rg.addColorStop(0, col); rg.addColorStop(1, 'rgba(0,0,0,0)')
        g.fillStyle = rg
        g.fillRect(x - r, y - r, r * 2, r * 2)
    }
    g.restore()

    for (let i = 0; i < 9000; i++) {
        const x = rnd() * w
        let y
        if (rnd() < 0.58) {
            const t = (rnd() + rnd() + rnd() - 1.5) / 1.5
            const yb = h / 2 + t * h * 0.19
            y = h / 2 + (yb - h / 2) * Math.cos(-0.30) + (x - w / 2) * Math.sin(-0.30) * 0.4
        } else y = rnd() * h
        if (y < 0 || y > h) continue
        const r = rnd() * rnd() * 1.8 + 0.25
        const a = 0.22 + rnd() * 0.78
        const tint = rnd()
        g.fillStyle = tint > 0.9 ? 'rgba(255,205,170,' + a + ')' : tint > 0.74 ? 'rgba(190,210,255,' + a + ')' : 'rgba(255,255,255,' + a + ')'
        g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
}

/* ══════════════════ генерация данных ══════════════════ */

function pickClass(rnd) {
    const x = rnd()
    let acc = 0
    for (const cl of CLASSES) { acc += cl.w; if (x <= acc) return cl }
    return CLASSES[4]
}

export function sectorOf(p, cfg = MAP_CONFIG) {
    const nx = Math.floor((p.x + cfg.galaxyRadius) / cfg.sectorSize)
    const nz = Math.floor((p.z + cfg.galaxyRadius) / cfg.sectorSize)
    const L = String.fromCharCode(65 + (((nx % 20) + 20) % 20))
    const N = String(1 + (((nz % 20) + 20) % 20)).padStart(2, '0')
    return L + '-' + N
}

export function generateGalaxy(cfg = MAP_CONFIG) {
    const rnd = mulberry32(cfg.seed)
    const systems = []
    const usedNames = new Set()

    for (let i = 0; i < cfg.systems; i++) {
        let pos
        if (rnd() < cfg.bulgeFrac) {
            const r = Math.pow(rnd(), 2.0) * cfg.galaxyRadius * 0.34
            const a = rnd() * Math.PI * 2
            pos = new THREE.Vector3(Math.cos(a) * r, (rnd() - 0.5) * cfg.diskThickness * 1.7, Math.sin(a) * r)
        } else {
            const arm = Math.floor(rnd() * cfg.arms)
            const t = Math.pow(rnd(), 0.74)
            const r = 20000 + t * cfg.galaxyRadius
            const twist = (r / cfg.galaxyRadius) * 2.7 + (arm * Math.PI * 2) / cfg.arms
            const spread = (rnd() + rnd() + rnd() - 1.5) * cfg.armSpread * (0.32 + t)
            const a = twist + spread
            pos = new THREE.Vector3(
                Math.cos(a) * r,
                (rnd() - 0.5) * cfg.diskThickness * (0.35 + (1 - t)),
                Math.sin(a) * r,
            )
        }

        const cls = pickClass(rnd)
        const big = cls.name === 'O' || cls.name === 'B'
        const starR = (big ? 9 : 4) + rnd() * (big ? 12 : 7)

        let name = ''
        for (let tries = 0; tries < 6; tries++) {
            const cand = GREEK[Math.floor(rnd() * GREEK.length)] + ' ' + CONSTELLATIONS[Math.floor(rnd() * CONSTELLATIONS.length)]
            if (!usedNames.has(cand)) { name = cand; break }
            name = cand
        }
        usedNames.add(name)

        const nPlanets = 1 + Math.floor(rnd() * 6)
        const planets = []
        let orbit = 34 + rnd() * 30
        for (let p = 0; p < nPlanets; p++) {
            const kind = PLANET_KINDS[Math.floor(rnd() * PLANET_KINDS.length)]
            const gas = kind.name === 'Газовый гигант'
            planets.push({
                radius: gas ? 2.2 + rnd() * 2.4 : 0.7 + rnd() * 1.5,
                orbit,
                speed: (0.10 + rnd() * 0.16) / Math.sqrt(orbit / 40),
                angle: rnd() * Math.PI * 2,
                incl: (rnd() - 0.5) * 0.18,
                color: kind.color,
                kind: kind.name,
                moons: gas && rnd() < 0.75 ? 1 + Math.floor(rnd() * 3) : rnd() < 0.2 ? 1 : 0,
                tag: ROMAN[p] || String(p + 1),
                ring: gas && rnd() < 0.28,
            })
            orbit *= 1.3 + rnd() * 0.45
        }

        systems.push({
            id: i, name, cls, pos, starR, planets,
            sector: sectorOf(pos, cfg),
            catalog: ['HD', 'KP', 'SWN', 'GX'][Math.floor(rnd() * 4)] + ' ' + (1000 + Math.floor(rnd() * 89999)),
            pop: rnd() < 0.3 ? Math.floor(rnd() * 900) + 20 : 0,
            tech: ['без технологий', 'уровень 2', 'уровень 4', 'уровень 5'][Math.floor(rnd() * 4)],
            detail: null,
            _proxy: null,
        })
    }
    return systems
}

/* ══════════════════ шейдеры звёзд ══════════════════ */
const STAR_VERT = `
attribute float aSize;
attribute vec3  aColor;
varying vec3 vColor;
uniform float uPixelRatio;
uniform float uBasePx;
void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float dist = max(-mv.z, 1.0);
    float px = uBasePx * aSize * uPixelRatio;
    px *= 1.0 + 1.1 / (1.0 + dist * 0.0008);
    gl_PointSize = clamp(px, 1.0, 72.0);
    gl_Position = projectionMatrix * mv;
}
`
const STAR_FRAG = `
varying vec3 vColor;
uniform sampler2D uMap;
void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    if (t.a < 0.01) discard;
    gl_FragColor = vec4(vColor, 1.0) * t;
}
`

/* ══════════════════ сборка сцены ══════════════════ */
/**
 * @param root     worldRoot — группа, внутри которой живёт мир (её position = −originShift)
 * @param attachRig(rig)  передать риг ПОСЛЕ создания (нужны camUniverse/originShift/toRender)
 */
export function createStarMap(root, camera, renderer, cfg = MAP_CONFIG) {
    const systems = generateGalaxy(cfg)
    let rig = null
    const attachRig = (r) => { rig = r }
    const glowTex = makeGlowTexture(128)
    const starTex = makeStarTexture(64)
    const skyTex = makeSkyTexture(2048, 1024, cfg.seed)

    /* ---- небо (риг будет держать его у камеры) ---- */
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(1, 48, 32),
        new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false }),
    )
    sky.scale.setScalar(2e7)
    sky.renderOrder = -1000
    sky.userData.clickable = false
    sky.userData.noPick = true
    sky.frustumCulled = false
    root.add(sky)

    /* ---- свечение ядра галактики ---- */
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xffd9a0, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false,
    }))
    core.scale.setScalar(cfg.galaxyRadius * 0.9)
    core.userData.clickable = false
    core.userData.noPick = true
    core.renderOrder = -900
    root.add(core)

    /* ---- звёзды: один Points ---- */
    const N = systems.length
    const pos = new Float32Array(N * 3)
    const col = new Float32Array(N * 3)
    const siz = new Float32Array(N)
    const tmpColor = new THREE.Color()
    systems.forEach((s, i) => {
        pos[i * 3] = s.pos.x; pos[i * 3 + 1] = s.pos.y; pos[i * 3 + 2] = s.pos.z
        tmpColor.setHex(s.cls.c)
        col[i * 3] = tmpColor.r; col[i * 3 + 1] = tmpColor.g; col[i * 3 + 2] = tmpColor.b
        siz[i] = 0.55 + (s.starR / 16) * 1.1
    })
    const starGeo = new THREE.BufferGeometry()
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    starGeo.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1))
    starGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), cfg.galaxyRadius * 1.4)

    const starMat = new THREE.ShaderMaterial({
        uniforms: {
            uMap: { value: starTex },
            uBasePx: { value: cfg.starSizePx },
            uPixelRatio: { value: Math.min(renderer.getPixelRatio(), 2) },
        },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
    })
    const stars = new THREE.Points(starGeo, starMat)
    stars.renderOrder = -800
    stars.frustumCulled = false
    stars.userData.noPick = true          // пикинг звёзд делаем аналитически
    stars.userData.clickable = false
    root.add(stars)

    /* ---- многослойная секторная сетка ---- */
    const grids = cfg.sectorLevels.map((size, li) => {
        const n = Math.floor((cfg.galaxyRadius * 1.18) / size)
        const pts = []
        for (let i = -n; i <= n; i++) {
            const v = i * size
            pts.push(-n * size, 0, v, n * size, 0, v)
            pts.push(v, 0, -n * size, v, 0, n * size)
        }
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
        const mat = new THREE.LineBasicMaterial({
            color: li === 0 ? 0x3f86b0 : 0x7fdcff, transparent: true, opacity: 0,
            depthWrite: false, fog: false,
        })
        const lines = new THREE.LineSegments(geo, mat)
        lines.userData.clickable = false
        lines.userData.noPick = true
        lines.renderOrder = -600
        lines.frustumCulled = false
        root.add(lines)
        return { size, lines, mat }
    })

    /* ---- пул подписей ---- */
    const makePool = (n, color) => {
        const arr = []
        for (let i = 0; i < n; i++) {
            const spr = new THREE.Sprite(new THREE.SpriteMaterial({
                transparent: true, depthWrite: false, depthTest: false, fog: false,
                opacity: 0, color: color || 0xffffff,
            }))
            spr.userData.clickable = false
            spr.userData.noPick = true
            spr.visible = false
            root.add(spr)
            arr.push(spr)
        }
        return arr
    }
    const labelPool = makePool(cfg.labelBudget)
    labelPool.forEach((s) => { s.renderOrder = 600 })
    const sectorPool = makePool(9, 0x8fd0ff)
    sectorPool.forEach((s) => { s.renderOrder = 590 })

    /* ---- «раскрытые» системы (LOD) ---- */
    const planetGeo = new THREE.SphereGeometry(1, 26, 18)
    const moonGeo = new THREE.SphereGeometry(1, 12, 10)
    const ringGeo = new THREE.RingGeometry(1.5, 2.35, 64)
    const orbitMat = new THREE.LineBasicMaterial({
        color: 0x8fd0ff, transparent: true, opacity: 0.2, depthWrite: false, fog: false,
    })
    const activeDetails = new Set()

    function buildDetail(sys) {
        const g = new THREE.Group()
        g.userData.system = sys
        g.userData.worldAnchor = sys.pos
        g.position.copy(sys.pos)

        const sun = new THREE.Mesh(planetGeo, new THREE.MeshBasicMaterial({ color: sys.cls.c, fog: false }))
        sun.scale.setScalar(sys.starR)
        sun.userData.system = sys
        sun.userData.pickRole = 'star'
        sun.userData.rotationSpeed = { x: 0, y: 0.0012 }
        g.add(sun)

        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: glowTex, color: sys.cls.c, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
        }))
        halo.userData.noPick = true
        halo.userData.clickable = false
        g.add(halo)

        // свет звезды: планеты освещены изнутри системы, а не «плоским» ambient
        const light = new THREE.PointLight(sys.cls.c, 40 + 150 * (sys.starR / 8), 0, 1.0)
        g.add(light)

        const items = []
        for (const p of sys.planets) {
            const pivot = new THREE.Group()
            pivot.rotation.x = p.incl
            g.add(pivot)

            const seg = 100
            const op = new Float32Array((seg + 1) * 3)
            for (let i = 0; i <= seg; i++) {
                const a = (i / seg) * Math.PI * 2
                op[i * 3] = Math.cos(a) * p.orbit
                op[i * 3 + 2] = Math.sin(a) * p.orbit
            }
            const og = new THREE.BufferGeometry()
            og.setAttribute('position', new THREE.BufferAttribute(op, 3))
            const orbit = new THREE.LineLoop(og, orbitMat)
            orbit.userData.noPick = true
            orbit.userData.clickable = false
            pivot.add(orbit)

            const mesh = new THREE.Mesh(planetGeo, new THREE.MeshStandardMaterial({
                color: p.color, roughness: 0.88, metalness: 0.04, fog: false,
            }))
            mesh.scale.setScalar(p.radius)
            mesh.userData.system = sys
            mesh.userData.planet = p
            mesh.userData.pickRole = 'planet'
            mesh.userData.rotationSpeed = { x: 0, y: 0.006 }
            pivot.add(mesh)

            let ringMesh = null
            if (p.ring) {
                ringMesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
                    color: 0xd8c9a8, side: THREE.DoubleSide, transparent: true, opacity: 0.5, fog: false,
                }))
                ringMesh.scale.setScalar(p.radius)
                ringMesh.rotation.x = Math.PI / 2 - 0.35
                ringMesh.userData.noPick = true
                ringMesh.userData.clickable = false
                pivot.add(ringMesh)
            }

            const moons = []
            for (let m = 0; m < p.moons; m++) {
                const moon = new THREE.Mesh(moonGeo, new THREE.MeshStandardMaterial({ color: 0xbfc6cc, roughness: 1, fog: false }))
                moon.scale.setScalar(p.radius * (0.18 + Math.random() * 0.14))
                moon.userData.noPick = true
                moon.userData.clickable = false
                pivot.add(moon)
                moons.push({ mesh: moon, dist: p.radius * (2.6 + m * 1.4), speed: 0.6 + m * 0.35, a: Math.random() * 6.28 })
            }
            items.push({ p, pivot, mesh, moons, ringMesh })
        }
        return { sysId: sys.id, group: g, items, sun, halo, light }
    }

    function disposeDetail(d) {
        d.group.traverse((c) => {
            if (c.geometry && c.geometry !== planetGeo && c.geometry !== moonGeo && c.geometry !== ringGeo) c.geometry.dispose()
            const m = c.material
            if (m && !Array.isArray(m) && m !== orbitMat) m.dispose()
        })
    }

    function acquireDetail(sys) {
        const d = buildDetail(sys)
        root.add(d.group)
        sys.detail = d
        activeDetails.add(sys)
        return d
    }
    function releaseDetail(sys) {
        if (!sys.detail) return
        root.remove(sys.detail.group)
        disposeDetail(sys.detail)
        sys.detail = null
        activeDetails.delete(sys)
    }

    /* ---- общий свет сцены ---- */
    root.add(new THREE.AmbientLight(0x9fc4dd, 0.5))

    /* ══════════════════ обновление ══════════════════ */
    const _v = new THREE.Vector3()
    let labelTimer = 0
    const nearBuf = []
    const labelBuf = []

    const screenConstScale = (d) =>
        (2 * Math.tan((camera.fov * Math.PI) / 360) * d) / Math.max(window.innerHeight, 1)

    const _wp = new THREE.Vector3()

    function update(dt, rigArg) {
        const R = rigArg || rig
        // sys.pos — это координаты ВСЕЛЕННОЙ (float64, авторитетные данные карты).
        // Камера живёт в координатах РЕНДЕРА (около нуля, float32-безопасно),
        // поэтому для сравнений берём rig.camUniverse.
        const camU = R ? R.camUniverse : _wp.copy(camera.position)
        // «масштаб обзора» — для сетки и ядра галактики
        const dist = R ? R.dist : camera.position.length()

        /* — орбиты раскрытых систем — */
        for (const sys of activeDetails) {
            const d = sys.detail
            if (!d) continue
            for (const it of d.items) {
                it.p.angle += it.p.speed * dt
                const x = Math.cos(it.p.angle) * it.p.orbit
                const z = Math.sin(it.p.angle) * it.p.orbit
                it.mesh.position.set(x, 0, z)
                if (it.ringMesh) it.ringMesh.position.set(x, 0, z)
                for (const m of it.moons) {
                    m.a += m.speed * dt
                    m.mesh.position.set(
                        x + Math.cos(m.a) * m.dist,
                        Math.sin(m.a * 0.7) * m.dist * 0.22,
                        z + Math.sin(m.a) * m.dist,
                    )
                }
            }
            // гало звезды — тоже постоянного экранного размера
            // (d.group.position — локальные координаты вселенной, берём мировые)
            const dCam = camera.position.distanceTo(d.group.getWorldPosition(_v))
            const haloWorld = Math.max(sys.starR * 6, screenConstScale(dCam) * window.innerHeight * 0.09)
            d.halo.scale.setScalar(haloWorld)
        }

        /* — LOD — */
        nearBuf.length = 0
        for (const s of systems) {
            const d = s.pos.distanceTo(camU)
            if (d < cfg.detailRadius) nearBuf.push({ s, d })
        }
        nearBuf.sort((a, b) => a.d - b.d)
        const want = new Set()
        for (let i = 0; i < Math.min(nearBuf.length, cfg.detailBudget); i++) want.add(nearBuf[i].s)
        for (const s of [...activeDetails]) if (!want.has(s)) releaseDetail(s)
        for (const s of want) if (!activeDetails.has(s)) acquireDetail(s)

        /* — секторная сетка: слои плавно сменяют друг друга по дистанции — */
        const f = cfg.sectorFade
        grids[0].mat.opacity = 0.17 * bell(dist, f.fine[0], f.fine[1])
        grids[1].mat.opacity = 0.14 * bell(dist, f.coarse[0], f.coarse[1])
        grids[0].lines.visible = grids[0].mat.opacity > 0.004
        grids[1].lines.visible = grids[1].mat.opacity > 0.004

        /* — ядро галактики — */
        const coreVis = smooth(dist, 90000, 400000)
        core.visible = coreVis > 0.01
        core.material.opacity = 0.55 * coreVis
        core.scale.setScalar(cfg.galaxyRadius * (0.5 + 0.55 * coreVis))

        /* — подписи (пересчёт ~6 раз/с) — */
        labelTimer += dt
        if (labelTimer > 0.16) {
            labelTimer = 0
            const H = Math.max(window.innerHeight, 1)

            // когда камера спустилась к планетам — подписи систем только мешают
            const labelDim = smooth(dist, 60, 700)
            labelBuf.length = 0
            if (labelDim > 0.02) {
                for (const s of systems) {
                    const d = s.pos.distanceTo(camU)
                    if (d < cfg.labelRadius) labelBuf.push({ s, d })
                }
            }
            labelBuf.sort((a, b) => a.d - b.d)
            for (let i = 0; i < labelPool.length; i++) {
                const spr = labelPool[i]
                const item = labelBuf[i]
                if (!item) { spr.visible = false; continue }
                const { tex, w, h } = makeLabelTexture(item.s.name, item.s.sector)
                if (spr.material.map !== tex) { spr.material.map = tex; spr.material.needsUpdate = true }
                const k = screenConstScale(item.d)
                _v.copy(item.s.pos)
                _v.y += Math.max(item.s.starR * 2.2, k * H * 0.03)
                spr.position.copy(_v)
                spr.scale.set(w * k * 0.46, h * k * 0.46, 1)
                spr.material.opacity = labelDim * 0.92 * (1 - smooth(item.d, cfg.labelRadius * 0.5, cfg.labelRadius))
                spr.visible = spr.material.opacity > 0.02
                spr.renderOrder = 600
            }

            /* — подписи секторов — */
            const secVis = bell(dist, f.fine[1] * 0.8, f.coarse[1])
            const step = grids[1].size
            const cx = Math.round(camU.x / step) * step
            const cz = Math.round(camU.z / step) * step
            for (let i = 0; i < sectorPool.length; i++) {
                const spr = sectorPool[i]
                if (secVis < 0.05) { spr.visible = false; continue }
                const ix = (i % 3) - 1, iz = Math.floor(i / 3) - 1
                const wx = cx + ix * step, wz = cz + iz * step
                _v.set(wx, 0, wz)
                const d = _v.distanceTo(camU)
                const k = screenConstScale(d)
                const { tex, w, h } = makeLabelTexture(sectorOf(_v, cfg), '')
                if (spr.material.map !== tex) { spr.material.map = tex; spr.material.needsUpdate = true }
                spr.position.set(wx, 0, wz)
                spr.scale.set(w * k * 0.62, h * k * 0.62, 1)
                spr.material.opacity = 0.4 * secVis
                spr.visible = true
                spr.renderOrder = 590
            }
        }

        return { activeSystems: activeDetails.size }
    }

    function bell(x, a, b) {
        if (x < a) return smooth(x, a * 0.3, a)
        if (x > b) return 1 - smooth(x, b, b * 2.4)
        return 1
    }

    /* ══════════════════ пиканье ══════════════════ */
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const pickables = []
    const _zero = new THREE.Vector3()
    const _v2 = new THREE.Vector3()

    /** Прокси для далёкой звезды: даёт objectUse/ригу реальный Object3D,
     *  за которым можно лететь и следить, пока система не «раскрыта». */
    const proxyGeo = new THREE.SphereGeometry(1, 10, 8)
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false })
    const proxyList = []
    function starProxy(sys) {
        if (sys.detail) return sys.detail.sun
        let m = sys._proxy
        if (!m) {
            if (proxyList.length > 24) {
                const old = proxyList.shift()
                if (old.userData._owner) old.userData._owner._proxy = null
                root.remove(old)
            }
            m = new THREE.Mesh(proxyGeo, proxyMat)
            m.userData.noPick = true
            root.add(m)
            proxyList.push(m)
            sys._proxy = m
            m.userData._owner = sys
        }
        m.position.copy(sys.pos)
        m.scale.setScalar(Math.max(sys.starR, 30))
        m.userData.system = sys
        m.userData.pickRole = 'star'
        m.userData.worldAnchor = sys.pos
        return m
    }

    /**
     * Пикер: сначала реальные меши (планеты, солнце раскрытой системы) — обычный
     * raycaster, их мало. Если мимо — аналитически ищем ближайшую к курсору
     * звезду по проекции в экран: работает на любом масштабе и не требует
     * тысяч коллайдеров.
     */
    function pick(clientX, clientY) {
        const w = window.innerWidth, h = window.innerHeight
        ndc.set((clientX / w) * 2 - 1, -(clientY / h) * 2 + 1)
        raycaster.setFromCamera(ndc, camera)

        pickables.length = 0
        for (const s of activeDetails) {
            if (!s.detail) continue
            pickables.push(s.detail.sun)
            for (const it of s.detail.items) pickables.push(it.mesh)
        }
        const hits = pickables.length ? raycaster.intersectObjects(pickables, false) : []
        for (const hit of hits) {
            const o = hit.object
            const sys = o.userData.system
            if (!sys) continue
            return {
                object: o, root: sys.detail.group, system: sys,
                planet: o.userData.planet || null, kind: o.userData.pickRole, point: hit.point.clone(),
            }
        }

        // звёзды: проекция в экран. sys.pos — координаты вселенной,
        // а project() работает с мировыми (рендер) координатами → вычитаем сдвиг.
        const shift = rig ? rig.originShift : _zero
        let best = null, bestScore = Infinity
        for (const s of systems) {
            _v.copy(s.pos).sub(shift).project(camera)
            if (_v.z < -1 || _v.z > 1) continue              // за камерой / за far
            const sx = (_v.x * 0.5 + 0.5) * w
            const sy = (-_v.y * 0.5 + 0.5) * h
            if (sx < -60 || sx > w + 60 || sy < -60 || sy > h + 60) continue
            const px = Math.hypot(sx - clientX, sy - clientY)
            if (px > cfg.pickRadiusPx) continue
            // глубину берём ДО проекции (в NDC расстояние уже бессмысленно)
            const depth = _v2.copy(s.pos).sub(shift).distanceTo(camera.position)
            const score = px * 1000 + depth * 0.0005         // ближе к курсору важнее, при равенстве — nearer
            if (score < bestScore) { bestScore = score; best = s }
        }
        if (best) {
            return {
                object: starProxy(best), root: best.detail ? best.detail.group : null,
                system: best, planet: null, kind: 'star', point: best.pos.clone(),
            }
        }
        return null
    }

    /* ══════════════════ описание для карточки ══════════════════ */
    function describe(hit) {
        const s = hit.system
        if (hit.planet) {
            const p = hit.planet
            return {
                title: s.name + ' ' + p.tag,
                subtitle: p.kind + ' · сектор ' + s.sector,
                rows: [
                    ['Радиус', p.radius.toFixed(2) + ' юн.'],
                    ['Орбита', p.orbit.toFixed(0) + ' юн.'],
                    ['Спутники', String(p.moons)],
                    ['Кольца', p.ring ? 'да' : 'нет'],
                    ['Звезда', s.name + ' (' + s.cls.name + '-класс, ' + s.cls.t + ')'],
                    ['Население', s.pop ? s.pop + ' млн' : 'нет'],
                    ['Техуровень', s.tech],
                ],
            }
        }
        return {
            title: s.name,
            subtitle: 'Сектор ' + s.sector + ' · ' + s.catalog,
            rows: [
                ['Класс звезды', s.cls.name + ' · ' + s.cls.t],
                ['Радиус звезды', s.starR.toFixed(1) + ' юн.'],
                ['Планет', String(s.planets.length)],
                ['Население', s.pop ? s.pop + ' млн' : 'нет'],
                ['Техуровень', s.tech],
                ['Координаты', Math.round(s.pos.x) + ' / ' + Math.round(s.pos.y) + ' / ' + Math.round(s.pos.z)],
                ['Планеты', s.planets.map((p) => p.tag + ' — ' + p.kind).join('; ')],
            ],
        }
    }

    function setPixelRatio(pr) { starMat.uniforms.uPixelRatio.value = Math.min(pr, 2) }

    function dispose() {
        for (const s of systems) if (s.detail) releaseDetail(s)
        root.remove(sky); root.remove(core); root.remove(stars)
        sky.geometry.dispose(); sky.material.dispose(); skyTex.dispose(); glowTex.dispose()
        starGeo.dispose(); starMat.dispose(); starTex.dispose()
        grids.forEach((g) => { g.lines.geometry.dispose(); g.mat.dispose() })
        labelPool.concat(sectorPool).forEach((s) => s.material.dispose())
        planetGeo.dispose(); moonGeo.dispose(); ringGeo.dispose(); orbitMat.dispose()
        proxyGeo.dispose(); proxyMat.dispose()
    }

    return {
        systems, sky, core, grids, stars, starMat, activeDetails,
        update, pick, describe, dispose, setPixelRatio, cfg, attachRig,
        sectorOf: (p) => sectorOf(p, cfg),
        getSystem: (i) => systems[i],
        randomSystem: () => systems[Math.floor(Math.random() * systems.length)],
        /** p — в координатах ВСЕЛЕННОЙ. По умолчанию берём позицию камеры. */
        nearestSystem: (p) => {
            const q = p || (rig ? rig.camUniverse : camera.position)
            let best = null, bd = Infinity
            for (const s of systems) { const d = s.pos.distanceToSquared(q); if (d < bd) { bd = d; best = s } }
            return best
        },
        starProxy,
    }
}

function smooth(x, a, b) {
    const t = Math.max(0, Math.min(1, (x - a) / ((b - a) || 1)))
    return t * t * (3 - 2 * t)
}
