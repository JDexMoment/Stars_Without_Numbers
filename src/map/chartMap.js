import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mulberry32, hashString } from './rng.js'
import { makeGlowTexture, makeStarTexture, makeNodeTexture, makeLabelTexture } from './uiTextures.js'
import { SYSTEMS, CAMPAIGN } from './systems.data.js'

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  chartMap.js — карта кампании на ТВОИХ ассетах:
 *
 *   need_some_space.glb  → облако из 50 000 точек = «иллюзия множества»
 *                          звёзд (перекрашено: ядро тёплое, рукава цветные,
 *                          туманностные пятна). Размер не зависит от
 *                          расстояния до камеры.
 *   nebula_mapa.glb      → 1000 узлов-маркеров + связи = скелет навигации.
 *                          Узлы из systems.data.js — именованные системы
 *                          (звезда, планеты, подписи). Остальные — тусклые
 *                          ромбы «необследовано», кликабельные: карточка
 *                          подсказывает номер узла, чтобы вписать его в data.
 *   Panorama-GLB         → скайбокс (подключается main.js через rig.setSkybox).
 *
 *  Сетка секторов сохранена (сектор = 12 000 юнитов) — на ней можно строить
 *  карты государств. Границы галактики — жёсткий цилиндр для камеры.
 * ══════════════════════════════════════════════════════════════════════════
 */

const WORLD_R = 300000                // радиус звёздного облака (need_some_space).
                                      // Облако НАМНОГО больше паутины узлов: паутина —
                                      // это освоенный сектор ВНУТРИ галактики, а не вся она
const CHART_SPAN = 114000             // диаметр карты-«паутины» (nebula_mapa)
const SECTOR = 12000                  // шаг сетки секторов
const BOUNDS = { radius: 60000, height: 22000 }  // цилиндр границы полёта камеры
const ORBIT_SLOW = 0.3                // общий замедлитель орбит планет вокруг звёзд

const PALETTE = {
    brass: 0xe0b84f,
    brassDim: 0x8a6f35,
    link: 0x6e5a2e,
    node: 0xc9a24a,
    unexplored: 0x7d6c46,
    grid: 0x2a3a5c,
}

// ─── шейдер звёздного облака: экранный размер + цвет вершины ───────────────
const CLOUD_VERT = /* glsl */`
attribute float aSize;
attribute vec3 aColor;
varying vec3 vColor;
uniform float uBasePx;
uniform float uPixRatio;
void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uBasePx * aSize * uPixRatio, 1.0, 5.0 * uPixRatio);
}
`
const CLOUD_FRAG = /* glsl */`
varying vec3 vColor;
void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    float a = smoothstep(0.5, 0.06, d);
    if (a < 0.02) discard;
    gl_FragColor = vec4(vColor, a);
}
`

// ─── необследованные узлы: значок карты, а не объект ───────────────────────
// Вблизи значок растворяется (vA→0): подлетел — «там ничего нет», и это
// честно. Издали — ровная мелкая роспись, отличимая от именованных систем
// (те дают гало, залитый ромб и ПОДПИСЬ на любом масштабе).
const UNEXP_VERT = /* glsl */`
uniform float uSizePx;
uniform float uPixRatio;
uniform float uNear;
uniform float uFar;
varying float vA;
void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = max(-mv.z, 1.0);
    vA = smoothstep(uNear, uFar, d);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(uSizePx * uPixRatio * (0.55 + 0.45 * vA), 1.0, 8.0 * uPixRatio);
}
`
const UNEXP_FRAG = /* glsl */`
uniform sampler2D uTex;
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
void main() {
    float a = texture2D(uTex, gl_PointCoord).a * vA * uOpacity;
    if (a < 0.02) discard;
    gl_FragColor = vec4(uColor, a);
}
`

function fmt(n) {
    const a = Math.abs(n)
    if (a >= 1e6) return (n / 1e6).toFixed(1) + ' млн ед.'
    if (a >= 1e3) return (n / 1e3).toFixed(1) + ' тыс. ед.'
    return n.toFixed(0) + ' ед.'
}

export function createChartMap(renderer, camera, worldRoot, opts = {}) {
    const o = Object.assign({
        seed: 42,
        loader: new GLTFLoader(),
    }, opts)

    const rnd = mulberry32(o.seed)
    const group = new THREE.Group()
    group.name = 'chart'
    worldRoot.add(group)

    const glowTex = makeGlowTexture()
    const starTex = makeStarTexture()
    const nodeTex = makeNodeTexture(false)
    const nodeTexFilled = makeNodeTexture(true)

    /** @type {{pos:THREE.Vector3, index:number, system:object|null, proxy:THREE.Object3D}[]} */
    let nodes = []
    let systems = []                 // построенные системы (для орбит и подписей)
    const systemMeshes = []          // меши для клика (планеты/звёзды)
    const labels = []                // все надписи (системы + сектора)
    let chartGroup = null
    let cloudPoints = null
    let cloudMat = null
    let linkMat = null
    let unexpMat = null
    let sectorGrid = null
    let ready = false

    // ─── 1. ЗВЁЗДНОЕ ОБЛАКО (need_some_space.glb): перекрасить, растянуть ──
    function buildStarfield(spaceGltf) {
        const src = spaceGltf.scene
        src.updateMatrixWorld(true)

        // ВАЖНО: сырой атрибут POSITION живёт в ЛОКАЛЬНЫХ координатах меша,
        // а трансформации узла GLB сидят в его matrixWorld (как у nebula_mapa).
        // Берём вершины через мировую матрицу, иначе масштаб применится дважды.
        let srcMesh = null
        src.traverse((m) => { if ((m.isPoints || m.isMesh) && !srcMesh) srcMesh = m })
        if (!srcMesh) return
        const srcPos = srcMesh.geometry.getAttribute('position')
        if (!srcPos) return

        // Точная нормировка: центр = центроид точек, радиус = максимальное
        // расстояние точки от центра (не диагональ bbox — она даёт ~0.78×,
        // и галактика выходит меньше задуманной).
        const c = new THREE.Vector3()
        const p0 = new THREE.Vector3()
        for (let i = 0; i < srcPos.count; i++) {
            p0.fromBufferAttribute(srcPos, i).applyMatrix4(srcMesh.matrixWorld)
            c.add(p0)
        }
        c.divideScalar(Math.max(srcPos.count, 1))
        let r = 1e-6
        for (let i = 0; i < srcPos.count; i++) {
            p0.fromBufferAttribute(srcPos, i).applyMatrix4(srcMesh.matrixWorld)
            const d = p0.distanceTo(c)
            if (d > r) r = d
        }
        const s = WORLD_R / r

        const n0 = srcPos.count
        // облако растянуто в 5 раз → плотность точек на экран падает.
        // Добавляем 3 копии с джиттером и вариацией цвета/размера:
        // те же 50 000 звёзд ассета дают 200 000 видимых — «иллюзия множества»
        const COPIES = 4
        const n = n0 * COPIES
        const pos = new Float32Array(n * 3)
        const col = new Float32Array(n * 3)
        const size = new Float32Array(n)

        // звёздные классы (теплее и пестрее прежнего белого)
        const classes = [
            [0.44, 0.70, 0.82, 0.92],   // бело-голубые
            [0.24, 0.94, 0.96, 1.00],   // белые
            [0.17, 1.00, 0.94, 0.78],   // жёлтые
            [0.10, 1.00, 0.76, 0.48],   // оранжевые
            [0.05, 0.95, 0.52, 0.40],   // красные карлики
        ]
        const warm = new THREE.Color(0xffca7a)
        const cold = new THREE.Color(0x8ab4ff)
        const nebA = new THREE.Color(0xd8745f)
        const nebB = new THREE.Color(0x56d0c0)
        const tmp = new THREE.Color()

        const p = new THREE.Vector3()
        for (let i = 0; i < n0; i++) {
            p.fromBufferAttribute(srcPos, i).applyMatrix4(srcMesh.matrixWorld)
            p.sub(c).multiplyScalar(s)

            const rn = p.length() / WORLD_R                    // 0..1 от центра
            // класс звезды
            let acc = rnd()
            let cl = classes[classes.length - 1]
            for (const k of classes) { acc -= k[0]; if (acc <= 0) { cl = k; break } }
            tmp.setRGB(cl[1], cl[2], cl[3])
            // ядро галактики теплее, окраина холоднее
            if (rn < 0.32) tmp.lerp(warm, (0.32 - rn) * 1.6)
            else if (rn > 0.74) tmp.lerp(cold, Math.min((rn - 0.74) * 1.2, 0.5))
            // туманностные пятна: редкие окрашенные области
            // (частоты подобраны под радиус облака, чтобы пятна были
            //  размером с туманность, а не с песчинку)
            const nz = Math.sin(p.x * 0.000026 + 11.7) * Math.sin(p.z * 0.000022 + 31.3) * Math.sin(p.y * 0.000034 + 71.1)
            let sizeBase
            if (nz > 0.42) {
                tmp.lerp(rnd() < 0.5 ? nebA : nebB, (nz - 0.42) * 1.4)
                sizeBase = 1.1 + rnd() * 0.8                    // в туманностях точки крупнее
            } else {
                sizeBase = 0.55 + rnd() * rnd() * 1.5
            }
            // яркость: в центре точки лежат внахлёст (аддитив!) — гасим ядро,
            // окраину оставляем искрить. Иначе всё сливается в белый комок.
            const lum = (0.2 + rnd() * 0.55) * (0.45 + rn * 0.75)

            for (let k = 0; k < COPIES; k++) {
                const j = i * COPIES + k
                const jit = k ? WORLD_R * 0.004 : 0             // копии чуть в стороне
                pos[j * 3] = p.x + (rnd() - 0.5) * jit
                pos[j * 3 + 1] = p.y + (rnd() - 0.5) * jit
                pos[j * 3 + 2] = p.z + (rnd() - 0.5) * jit
                const lk = k ? 0.65 + rnd() * 0.55 : 1          // копии чуть тусклее/ярче
                col[j * 3] = tmp.r * lum * lk
                col[j * 3 + 1] = tmp.g * lum * lk
                col[j * 3 + 2] = tmp.b * lum * lk
                size[j] = sizeBase * (k ? 0.7 + rnd() * 0.6 : 1)
            }
        }

        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
        geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
        const mat = new THREE.ShaderMaterial({
            vertexShader: CLOUD_VERT, fragmentShader: CLOUD_FRAG,
            uniforms: {
                uBasePx: { value: 2.0 },
                uPixRatio: { value: renderer.getPixelRatio() },
            },
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        })
        cloudMat = mat
        cloudPoints = new THREE.Points(geo, mat)
        cloudPoints.name = 'starfield'
        cloudPoints.frustumCulled = false
        group.add(cloudPoints)
    }

    // ─── 2. КАРТА-ПАУТИНА (nebula_mapa.glb): узлы, связи ───────────────────
    function buildChart(mapaGltf) {
        const scene = mapaGltf.scene
        scene.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(scene)
        const c = box.getCenter(new THREE.Vector3())
        const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 1e-6)
        const s = CHART_SPAN / span

        chartGroup = new THREE.Group()
        chartGroup.name = 'mapa'
        group.add(chartGroup)

        // связи: золотистые «волоски» вместо голубого.
        // Геометрия связей тоже в локальных координатах своего узла —
        // переносим в мировые и приводим к масштабу карты (иначе линии
        // разъезжаются с узлами, которые мы берём через getWorldPosition).
        scene.traverse((m) => {
            if (!m.isMesh) return
            const verts = m.geometry.getAttribute('position')?.count || 0
            if (verts > 1000) {
                const geo = m.geometry.clone()
                geo.applyMatrix4(m.matrixWorld)
                geo.translate(-c.x, -c.y, -c.z)
                geo.scale(s, s, s)
                linkMat = new THREE.MeshBasicMaterial({
                    color: 0xd9b364, transparent: true, opacity: 0.9,
                    blending: THREE.AdditiveBlending, depthWrite: false,
                })
                const links = new THREE.Mesh(geo, linkMat)
                links.name = 'links'
                links.frustumCulled = false
                chartGroup.add(links)
            }
        })
        // позиции маркеров — из мировых матриц (в самих узлах GLB трансформаций нет)
        const wp = new THREE.Vector3()
        const MARKER_VERTS = 60 // икосфера detail 0: 20 граней × 3 вершины
        scene.traverse((m) => {
            if (!m.isMesh) return
            const verts = m.geometry.getAttribute('position')?.count || 0
            if (verts === MARKER_VERTS) {
                m.getWorldPosition(wp)
                nodes.push({
                    index: nodes.length,
                    pos: wp.clone().sub(c).multiplyScalar(s),
                    system: null, proxy: null,
                })
            }
        })

        // точки-узлы: один Points на все необследованные (экранный размер)
        const pos = new Float32Array(nodes.length * 3)
        nodes.forEach((nd, i) => { pos[i * 3] = nd.pos.x; pos[i * 3 + 1] = nd.pos.y; pos[i * 3 + 2] = nd.pos.z })
        const ptsGeo = new THREE.BufferGeometry()
        ptsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
        unexpMat = new THREE.ShaderMaterial({
            vertexShader: UNEXP_VERT, fragmentShader: UNEXP_FRAG,
            uniforms: {
                uSizePx: { value: 4.5 },
                uPixRatio: { value: renderer.getPixelRatio() },
                uNear: { value: 2500 }, uFar: { value: 9000 },
                uTex: { value: nodeTex },
                uColor: { value: new THREE.Color(0x9a8452) },
                uOpacity: { value: 0.55 },
            },
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        })
        const pts = new THREE.Points(ptsGeo, unexpMat)
        pts.name = 'unexplored-nodes'
        pts.frustumCulled = false
        chartGroup.add(pts)

        // невидимые прокси для полёта камеры к необследованным узлам
        for (const nd of nodes) {
            const proxy = new THREE.Object3D()
            proxy.position.copy(nd.pos)
            proxy.userData.radius = 700
            proxy.name = 'node-' + nd.index
            chartGroup.add(proxy)
            nd.proxy = proxy
        }

        buildNamedSystems()
        buildSectorGrid()
    }

    // ─── 3. ИМЕНОВАННЫЕ СИСТЕМЫ из systems.data.js ─────────────────────────
    function pickNodeFor(entry) {
        if (Array.isArray(entry.at)) return null // свободные координаты
        if (typeof entry.node === 'number' && nodes[entry.node]) return nodes[entry.node]
        if (entry.node === 'auto:center' || entry.node === undefined) {
            // ближайший к центру карты узел
            let best = nodes[0], bd = Infinity
            for (const nd of nodes) {
                const d = nd.pos.lengthSq()
                if (d < bd) { bd = d; best = nd }
            }
            return best
        }
        if (entry.node === 'auto:edge') {
            // узел у края карты
            let best = nodes[0], bd = -Infinity
            for (const nd of nodes) {
                const d = nd.pos.lengthSq()
                if (d > bd) { bd = d; best = nd }
            }
            return best
        }
        console.warn('[chartMap] система «' + entry.name + '»: узел #' + entry.node + ' не найден')
        return null
    }

    // ─── ДРУЖЕСТВЕННЫЙ ФОРМАТ ЗАПИСЕЙ (нормализация) ───────────────────────
    // Пиши в systems.data.js коротко и по-человечески — движок приведёт запись
    // к рабочему виду сам. Подробности: src/map/HOWTO.md
    const STAR_MODELS = {
        sun: '/stars/models/sun.glb',
        blackhole: '/stars/models/blackhole.glb',
        dyson: '/stars/models/dyson_sphere.glb',
        startut: '/stars/models/startut.glb',
        'ssimpossible-sun': '/stars/models/ssimpossible-sun.glb',
    }
    const COLOR_WORDS = {
        белый: 0xf2f4ff, white: 0xf2f4ff,
        голубой: 0x9ec9ff, синий: 0x6f9fe8, blue: 0x9ec9ff,
        жёлтый: 0xffe08a, yellow: 0xffe08a,
        золотой: 0xffcf6a, gold: 0xffcf6a,
        оранжевый: 0xffab5e, orange: 0xffab5e,
        красный: 0xff6a4d, red: 0xff6a4d,
        зелёный: 0x8fe08a, green: 0x8fe08a,
        фиолетовый: 0xc49aff, purple: 0xc49aff,
    }

    /** Цвет из чего угодно: число 0xffcc66, '#ffcc66', 'красный', 'steelblue'. */
    function normColor(c) {
        if (c == null) return undefined
        if (typeof c === 'number') return c
        const s = String(c).trim()
        const key = s.toLowerCase().replace(/ё/g, 'е')
        if (COLOR_WORDS[key] !== undefined) return COLOR_WORDS[key]
        if (COLOR_WORDS[s.toLowerCase()] !== undefined) return COLOR_WORDS[s.toLowerCase()]
        return new THREE.Color(s).getHex()          // CSS-имена и '#hex' понимает THREE
    }

    /** Звезда из строки: 'sun', 'blackhole', 'dyson', 'красный', '#ffcc66', 'имя.glb'. */
    function normStar(st) {
        if (!st) return {}
        if (typeof st === 'string') {
            const k = st.trim().toLowerCase()
            if (STAR_MODELS[k]) return { model: STAR_MODELS[k] }
            if (/\.glb$/i.test(k)) return { model: k.startsWith('/') ? k : '/stars/models/' + k }
            return { color: normColor(st) }
        }
        const out = { ...st }
        if (out.color != null) out.color = normColor(out.color)
        return out
    }

    /** Текстура из короткого имени: 'Mars' → '/planets/textures/Mars.jpg'. */
    function normTexture(t) {
        if (!t) return undefined
        if (t.startsWith('/') || t.startsWith('http')) return t
        const base = String(t).replace(/\.(jpg|jpeg|png|webp)$/i, '')
        return '/planets/textures/' + base + '.jpg'
    }

    /** Полный прогон записи системы: короткие поля → рабочие. */
    function normEntry(entry) {
        const e = { ...entry }
        e.star = normStar(e.star)
        e.planets = (e.planets || []).map((p, i) => {
            const q = { ...p }
            if (q.size != null && q.radius == null) q.radius = q.size   // size ≡ radius
            if (q.texture) q.texture = normTexture(q.texture)
            if (q.color != null) q.color = normColor(q.color)
            if (q.orbit == null && !q.offset) q.orbit = 30 + i * 25     // сами расставим орбиты
            if (q.speed == null && q.orbit) q.speed = 0.002             // и скорость по умолчанию
            return q
        })
        return e
    }

    function buildNamedSystems() {
        let gi = 0
        for (const raw of SYSTEMS) {
            const entry = normEntry(raw)
            const nd = pickNodeFor(entry)
            const at = nd ? nd.pos.clone() : new THREE.Vector3().fromArray(entry.at)
            const seed = hashString(entry.name || ('system' + gi))
            const sys = buildSystem(entry, at, mulberry32(seed))
            sys.nodeIndex = nd ? nd.index : -1
            if (nd) nd.system = sys.entry
            systems.push(sys)
            gi++
        }
    }

    function buildSystem(entry, at, rand) {
        const g = new THREE.Group()
        g.position.copy(at)
        g.name = 'system:' + entry.name
        chartGroup.add(g)

        const starColor = entry.star?.color ?? 0xffe08a
        const starRadius = entry.star?.radius ?? 3.2

        // гало-маяк: видно с галактических высот
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
            map: starTex, color: starColor, blending: THREE.AdditiveBlending,
            transparent: true, depthWrite: false, opacity: 0.95,
        }))
        halo.scale.setScalar(5600)
        g.add(halo)

        // ромб-маркер обследованного узла
        const nodeSprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: nodeTexFilled, color: PALETTE.brass, transparent: true,
            depthWrite: false, opacity: 0.9,
        }))
        nodeSprite.scale.setScalar(2600)
        g.add(nodeSprite)

        // звезда
        const starName = entry.name + ' — звезда'
        if (entry.star?.model) {
            o.loader.load(entry.star.model, (gltf) => {
                const model = gltf.scene
                fitModel(model, starRadius)
                g.add(model)
                model.traverse((m) => { if (m.isMesh) { m.userData.radius = starRadius; m.userData.planetName = starName; systemMeshes.push(m) } })
            }, undefined, (e) => console.error('модель звезды', entry.star.model, e))
        } else {
            const m = new THREE.Mesh(
                new THREE.SphereGeometry(starRadius, 32, 32),
                new THREE.MeshBasicMaterial({ color: starColor })
            )
            m.userData.radius = starRadius
            m.userData.planetName = starName
            g.add(m)
            systemMeshes.push(m)
        }
        // свет звезды для её планет: мягкий и «близкий» — текстуры планет и
        // будущие огни городов не выгорают, но дневная сторона остаётся яркой
        const light = new THREE.PointLight(starColor, starRadius * 25, starRadius * 500, 1)
        g.add(light)

        // планеты
        const orbiters = []
        for (const p of (entry.planets || [])) {
            const pg = new THREE.Group()
            g.add(pg)
            const radius = p.radius ?? 1
            const planetGroup = new THREE.Group()
            pg.add(planetGroup)

            const tag = (m) => {
                m.userData.radius = radius
                m.userData.planetName = p.name
                m.userData.planetSpec = p
                m.userData.sysEntry = entry
                systemMeshes.push(m)
            }
            if (p.model) {
                o.loader.load(p.model, (gltf) => {
                    fitModel(gltf.scene, radius)
                    planetGroup.add(gltf.scene)
                    gltf.scene.traverse((m) => {
                        if (!m.isMesh) return
                        tag(m)
                        if (p.lockRotation) m.userData.lockRotation = true
                        if (p.focusCore && /core/i.test(m.name)) m.userData.cameraFocus = true
                    })
                }, undefined, (e) => console.error('модель планеты', p.model, e))
            } else if (p.texture) {
                const m = new THREE.Mesh(
                    new THREE.SphereGeometry(radius, 48, 48),
                    new THREE.MeshStandardMaterial({ map: new THREE.TextureLoader().load(p.texture), roughness: 0.95 })
                )
                planetGroup.add(m)
                tag(m)
            } else {
                const hue = (hashString(p.name || 'p') % 1000) / 1000
                const m = new THREE.Mesh(
                    new THREE.SphereGeometry(radius, 48, 48),
                    new THREE.MeshStandardMaterial({ color: p.color ?? new THREE.Color().setHSL(hue, 0.5, 0.5).getHex(), roughness: 0.9 })
                )
                planetGroup.add(m)
                tag(m)
            }

            if (p.ring) {
                const ring = new THREE.Mesh(
                    new THREE.RingGeometry(radius * 1.6, radius * 2.6, 96),
                    new THREE.MeshBasicMaterial({ color: 0xbfa36a, side: THREE.DoubleSide, transparent: true, opacity: 0.4, depthWrite: false })
                )
                ring.rotation.x = Math.PI / 2.3
                planetGroup.add(ring)
            }

            const orbit = { radius: p.orbit ?? 0, speed: (p.speed ?? 0) * ORBIT_SLOW, angle: rand() * Math.PI * 2 }
            const offset = p.offset ? new THREE.Vector3().fromArray(p.offset) : null
            if (orbit.radius > 0) {
                const ringPts = []
                for (let i = 0; i <= 128; i++) {
                    const t = (i / 128) * Math.PI * 2
                    ringPts.push(new THREE.Vector3(Math.cos(t) * orbit.radius, 0, Math.sin(t) * orbit.radius))
                }
                g.add(new THREE.Line(
                    new THREE.BufferGeometry().setFromPoints(ringPts),
                    new THREE.LineBasicMaterial({ color: 0xb49a5e, transparent: true, opacity: 0.5, depthWrite: false })
                ))
            }
            const setPos = (k = 1) => {
                if (offset) { pg.position.copy(offset); return }
                if (orbit.radius <= 0) return
                orbit.angle += orbit.speed * k
                pg.position.set(Math.cos(orbit.angle) * orbit.radius, 0, Math.sin(orbit.angle) * orbit.radius)
            }
            setPos(0)
            orbiters.push({ pg, planetGroup, setPos, spin: (p.speed ? Math.max(p.speed, 0.0015) : 0.0015) * ORBIT_SLOW })
        }

        // подпись системы
        const lbl = makeLabelTexture(entry.name || 'система', entry.role || '')
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: lbl.tex, color: 0xffffff, transparent: true, depthWrite: false, depthTest: false,
        }))
        sprite.renderOrder = 999
        sprite.userData.label = {
            aspect: lbl.w / lbl.h, heightAtCamDist: 0.05,
            // minVisible огромный: название системы читается даже с
            // галактического масштаба — именованные системы видно издалека
            minVisible: 500000, maxOpacity: 0.98,
            camWorldPos: new THREE.Vector3(), objWorldPos: new THREE.Vector3(),
        }
        g.add(sprite)
        labels.push(sprite)

        return {
            entry, group: g, halo, nodeSprite, orbiters,
            pos: at.clone(), rand,
        }
    }

    /** Нормализует модель под заданный радиус (модели в ассетах гигантские). */
    function fitModel(model, radius) {
        const box = new THREE.Box3().setFromObject(model)
        const br = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1e-9)
        const k = radius / br
        model.scale.setScalar(k)
        const c = box.getCenter(new THREE.Vector3())
        model.position.sub(c.multiplyScalar(k))
    }

    // ─── 4. СЕТКА СЕКТОРОВ ──────────────────────────────────────────────────
    function buildSectorGrid() {
        sectorGrid = new THREE.Group()
        sectorGrid.name = 'sectors'
        group.add(sectorGrid)

        const extent = BOUNDS.radius
        const lines = []
        for (let a = -extent; a <= extent; a += SECTOR) {
            const t = Math.sqrt(Math.max(extent * extent - a * a, 0))
            lines.push(new THREE.Vector3(a, 0, -t), new THREE.Vector3(a, 0, t))
            lines.push(new THREE.Vector3(-t, 0, a), new THREE.Vector3(t, 0, a))
        }
        const lineMat = new THREE.LineBasicMaterial({
            color: 0x46619b, transparent: true, opacity: 0.7, depthWrite: false,
        })
        sectorGrid.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), lineMat))

        const ring = new THREE.Mesh(
            new THREE.RingGeometry(extent * 0.999, extent, 220),
            new THREE.MeshBasicMaterial({ color: 0xb49a5e, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
        )
        ring.rotation.x = -Math.PI / 2
        sectorGrid.add(ring)

        for (let a = -extent + SECTOR / 2; a < extent; a += SECTOR) {
            for (let b = -extent + SECTOR / 2; b < extent; b += SECTOR) {
                if (Math.hypot(a, b) > extent - SECTOR * 0.4) continue
                const secX = Math.floor(a / SECTOR), secY = Math.floor(b / SECTOR)
                const lbl = makeLabelTexture(secX + '·' + secY, 'сектор')
                const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
                    map: lbl.tex, color: 0x9db4e0, transparent: true, depthWrite: false, depthTest: false,
                }))
                sprite.position.set(a, 0, b)
                sprite.renderOrder = 998
                sprite.userData.label = {
                    aspect: lbl.w / lbl.h, heightAtCamDist: 0.03,
                    minVisible: SECTOR * 0.9, maxOpacity: 0.95,
                    camWorldPos: new THREE.Vector3(), objWorldPos: new THREE.Vector3(),
                }
                sectorGrid.add(sprite)
                labels.push(sprite)
            }
        }
    }

    // ─── ЗАГРУЗКА ───────────────────────────────────────────────────────────
    async function load(onProgress) {
        const step = (f, t) => onProgress && onProgress(f, t)
        step(0.05, 'звёздное облако…')
        const space = await o.loader.loadAsync('/nebulae/models/need_some_space.glb')
        buildStarfield(space)
        step(0.45, 'карта сектора…')
        const mapa = await o.loader.loadAsync('/nebulae/models/nebula_mapa.glb')
        buildChart(mapa)
        step(0.9, 'системы кампании…')
        ready = true
        step(1, 'готово')
    }

    // ─── ОБНОВЛЕНИЕ ─────────────────────────────────────────────────────────
    const camWorld = new THREE.Vector3()
    function update(dt, rig) {
        if (!ready) return
        rigRef = rig || rigRef
        const dt60 = dt * 60
        camWorld.setFromMatrixPosition(camera.matrixWorld)
        camUniverse.copy(camWorld).add(rigRef ? rigRef.originShift : _zero)

        for (const s of systems) {
            for (const orb of s.orbiters) {
                orb.setPos(dt60)
                orb.planetGroup.rotation.y += orb.spin * dt60
            }
            // гало-маяк и ромб узла видны только с высоты: вблизи системы они
            // закрыли бы пол-экрана сиянием/плашкой
            const d = s.pos.distanceTo(camUniverse)
            s.halo.visible = d > 9000
            s.nodeSprite.visible = d > 12000
        }

        // связи-трубки у самой камеры превращаются в толстые лучи — гасим
        // скелет, когда камера «внутри» паутины (рядом с узлом)
        if (linkMat) {
            let dNear = Infinity
            for (let i = 0; i < nodes.length; i += 2) {
                const dd = nodes[i].pos.distanceToSquared(camUniverse)
                if (dd < dNear) dNear = dd
            }
            dNear = Math.sqrt(dNear)
            // Паутина = фон на подлёте (1200→7000 растёт до чётких 0.96),
            // но ВНУТРИ системы (<1200) трубки у камеры стали бы лентами —
            // гасим их в ноль, как просила фаза 2, не теряя «фон на подлёте»
            linkMat.opacity = 0.96 * THREE.MathUtils.clamp((dNear - 1200) / 5800, 0, 1)
            linkMat.visible = linkMat.opacity > 0.02
        }

        // подписи: экранный размер + LOD
        for (const l of labels) {
            const L = l.userData.label
            l.getWorldPosition(L.objWorldPos)
            const d = L.objWorldPos.distanceTo(camWorld)
            if (d > L.minVisible) { l.visible = false; continue }
            l.visible = true
            const scale = d * L.heightAtCamDist
            l.scale.set(scale * L.aspect, scale, 1)
            l.material.opacity = L.maxOpacity * THREE.MathUtils.clamp((L.minVisible - d) / (L.minVisible * 0.35), 0, 1)
        }

        // сетка секторов гаснет вблизи
        if (sectorGrid) {
            const h = Math.abs(camWorld.y)
            const fade = THREE.MathUtils.clamp((h - 1500) / 6000, 0, 1)
            sectorGrid.visible = fade > 0.02
            for (const c of sectorGrid.children) {
                if (!c.material || c.userData.label) continue
                if (c.userData.op0 === undefined) c.userData.op0 = c.material.opacity
                c.material.opacity = c.userData.op0 * fade
            }
        }
    }

    // ─── ВЫБОР УЗЛА (аналитический, в экранных координатах) ──────────────────
    let rigRef = null
    const _zero = new THREE.Vector3()
    const camUniverse = new THREE.Vector3()
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const proj = new THREE.Vector3()

    function pick(x, y) {
        if (!ready) return null
        ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1)
        // 1) планеты и звёзды — точный raycast (они мелкие, с высоты не попасть)
        raycaster.setFromCamera(ndc, camera)
        const hits = raycaster.intersectObjects(systemMeshes, false)
        if (hits.length) {
            const m = hits[0].object
            return {
                kind: 'planet', object: m,
                name: m.userData.planetName || 'Объект',
                radius: m.userData.radius || 1,
                planet: m.userData.planetSpec || null,
                entry: m.userData.sysEntry || null,
            }
        }
        // 2) узлы карты — ближайший к курсору на экране (точки raycast не берутся).
        //    Позиции узлов — в координатах «вселенной», камера — в «рендере»:
        //    проецируем со сдвигом плавающего начала координат.
        const shift = rigRef ? rigRef.originShift : _zero
        const camDist = camUniverse.length()
        let best = null, bestD = Infinity
        const grab = Math.max(26, 60 * Math.min(1, camDist / WORLD_R)) // пикселей
        for (const nd of nodes) {
            proj.copy(nd.pos).sub(shift).project(camera)
            if (proj.z > 1 || proj.z < -1) continue
            const sx = (proj.x * 0.5 + 0.5) * window.innerWidth
            const sy = (-proj.y * 0.5 + 0.5) * window.innerHeight
            // в nebula_mapa.glb встречаются дубли маркеров в одной точке:
            // именованная система всегда важнее лежащего поверх неё
            // «необследованного» дубля
            let d = Math.hypot(sx - x, sy - y)
            if (nd.system) d *= 0.25
            if (d < grab && d < bestD) { bestD = d; best = nd }
        }
        if (!best) return null
        if (best.system) {
            return { kind: 'system', object: best.proxy, radius: best.proxy.userData.radius, name: best.system.name, entry: best.system, nodeIndex: best.index }
        }
        return { kind: 'unexplored', object: best.proxy, radius: best.proxy.userData.radius, name: 'Необследованная система', node: best }
    }

    function sectorOf(v) {
        return 'сектор ' + Math.floor(v.x / SECTOR) + '·' + Math.floor(v.z / SECTOR)
    }

    // ─── КАРТОЧКИ ───────────────────────────────────────────────────────────
    function statRow(k, v) {
        return '<span class="stat"><b>' + k + '</b><i></i><span>' + v + '</span></span>'
    }

    function planetChipColor(p) {
        if (p.color) return '#' + new THREE.Color(p.color).getHexString()
        const h = hashString(p.name || 'p') % 360
        return 'hsl(' + h + ', 55%, 62%)'
    }

    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    const _wp = new THREE.Vector3()
    function describe(hit) {
        if (!hit) return null
        const distU = (v) => fmt(v.distanceTo(camUniverse))                 // вселенная
        const distO = (o3) => fmt(o3.getWorldPosition(_wp).distanceTo(camWorld)) // рендер
        if (hit.kind === 'planet') {
            const p = hit.planet
            const e = hit.entry
            const stats = []
            if (p) {
                if (p.kind) stats.push(['Класс', p.kind])
                if (p.orbit) stats.push(['Орбита', p.orbit + ' юн.'])
                if (p.radius) stats.push(['Радиус', p.radius + ' юн.'])
            }
            if (e) {
                stats.push(['Система', e.name])
                if (!p) stats.push(['Роль', e.role || 'центр системы'])
            }
            return {
                name: p?.name || hit.name,
                sub: e ? e.name + ' · ' + (e.role || 'система') : 'объект системы',
                stats,
                tags: p?.ring ? '<span class="tagchip">кольца</span>' : '',
                planets: '',
                distanceText: distO(hit.object),
            }
        }
        if (hit.kind === 'system') {
            const e = hit.entry
            const planets = (e.planets || []).map((p) =>
                '<li><span class="chip" style="background:' + planetChipColor(p) + '"></span>' +
                '<b>' + esc(p.tag ? p.tag + '. ' : '') + esc(p.name || 'планета') + '</b>' +
                '<em>' + esc(p.kind || '') + '</em></li>'
            ).join('')
            const tags = (e.tags || []).map((t) => '<span class="tagchip">' + esc(t) + '</span>').join('')
            return {
                name: e.name,
                sub: (e.role || '') + (hit.nodeIndex >= 0 ? ' · узел #' + hit.nodeIndex : ''),
                stats: [
                    ['Сектор', sectorOf(hit.object.position)],
                    ['Население', e.pop || '—'],
                    ['Техуровень', e.tech || '—'],
                    ['Объектов', String((e.planets || []).length)],
                ],
                tags, planets,
                distanceText: distU(hit.object.position),
            }
        }
        if (hit.kind === 'unexplored') {
            const nd = hit.node
            return {
                name: 'Необследованная система',
                sub: sectorOf(nd.pos) + ' · узел #' + nd.index,
                stats: [
                    ['Узел карты', '#' + nd.index],
                    ['X', fmt(nd.pos.x)], ['Y', fmt(nd.pos.y)], ['Z', fmt(nd.pos.z)],
                ],
                tags: '<span class="tagchip dim">тёмная зона</span>',
                planets: '',
                hint: 'Чтобы основать здесь систему, скопируй в <code>src/map/systems.data.js</code> (в массив SYSTEMS):' +
                    '<pre>{\n' +
                    '  node: ' + nd.index + ',\n' +
                    "  name: 'Моя система',\n" +
                    "  role: 'фронтир',\n" +
                    "  star: 'sun',\n" +
                    '  planets: [\n' +
                    "    { name: 'Земля Новая', texture: 'Europa', size: 1.4 },\n" +
                    "    { name: 'Фобос', color: 'красный', size: 0.6 },\n" +
                    '  ],\n' +
                    '}</pre>' +
                    'Или сразу в консоли, без перезагрузки: ' +
                    '<code>SWN.chart.addSystem({ node: ' + nd.index + ", name: 'Моя система' })</code>",
                distanceText: fmt(nd.pos.distanceTo(camUniverse)),
            }
        }
        return null
    }

    // ─── публичное API ──────────────────────────────────────────────────────
    return {
        group, load, update, pick, describe,
        attachRig(r) { rigRef = r },
        setPixelRatio(r) {
            if (cloudMat) cloudMat.uniforms.uPixRatio.value = r
            if (unexpMat) unexpMat.uniforms.uPixRatio.value = r
        },
        get nodes() { return nodes },
        get systems() { return systems },
        bounds: BOUNDS,
        sector: SECTOR,
        sectorOf,
        campaign: CAMPAIGN,
        /** именованные системы в виде списка для поиска/закладок */
        named() {
            return systems.map((s) => ({ name: s.entry.name, role: s.entry.role || '', pos: s.pos, sys: s }))
        },
        /** ближайшая именованная система к точке (координаты вселенной) */
        nearestNamed(v) {
            let best = null, bd = Infinity
            for (const s of systems) {
                const d = s.pos.distanceToSquared(v)
                if (d < bd) { bd = d; best = s }
            }
            return best
        },
        /** случайный необследованный узел */
        randomUnexplored() {
            const free = nodes.filter((n) => !n.system)
            return free.length ? free[Math.floor(Math.random() * free.length)] : null
        },
        /** список узлов в консоль — выбирать номера для systems.data.js */
        dumpNodes(max = 30) {
            console.table(nodes.slice(0, max).map((n) => ({
                '#': n.index,
                x: n.pos.x.toFixed(0), y: n.pos.y.toFixed(0), z: n.pos.z.toFixed(0),
                система: n.system ? n.system.name : '',
            })))
            return nodes.length + ' узлов всего'
        },
        /** Построить систему из записи прямо в рантайме, без перезагрузки.
         *  Формат — как в systems.data.js (работают все короткие поля:
         *  star: 'sun', texture: 'Mars', size, color: 'красный'…). */
        addSystem(raw) {
            const entry = normEntry(raw)
            const nd = pickNodeFor(entry)
            const at = nd ? nd.pos.clone() : new THREE.Vector3().fromArray(entry.at || [0, 0, 0])
            const seed = hashString(entry.name || ('system' + systems.length))
            const sys = buildSystem(entry, at, mulberry32(seed))
            sys.nodeIndex = nd ? nd.index : -1
            if (nd) nd.system = sys.entry
            systems.push(sys)
            return sys.entry
        },
    }
}
