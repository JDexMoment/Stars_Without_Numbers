import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// objectUse.js и cameraRig.js исторически берут gsap из window. ВАЖНО: именованный
// импорт — `import * as gsap` дал бы namespace без gsap.to.
window.gsap = window.gsap || gsap
// отключаем lagSmoothing: иначе на слабом железе/software-GL перелёты камеры
// растягиваются на секунды (gsap «догоняет» пропущенное время).
if (gsap.ticker) gsap.ticker.lagSmoothing(0)

import { createCameraRig } from './cameraRig.js'
import { createRigHud, isTouchDevice } from './rigHud.js'
import { createChartMap } from './chartMap.js'
import { createObjectInteractor } from './objectUse.js'
import { fmtUnits } from './rigMath.js'

/**
 * main.js — сборка: renderer → мир → риг камеры → карта кампании → интерактор → HUD.
 *
 * Карта строится на ТВОИХ ассетах (см. chartMap.js):
 *   need_some_space.glb  — звёздное облако (иллюзия множества, перекрашено);
 *   nebula_mapa.glb      — 1000 узлов + связи = скелет навигации;
 *   systems.data.js      — именованные системы (твоя домашняя сцена и пр.);
 *   panorama.glb         — скайбокс, «небо» вместо чёрной пустоты.
 *
 * Порядок в кадре:
 *   1. map.update(dt, rig)   — орбиты, LOD подписей, маяки
 *   2. interactor.update(dt) — вращение/орбиты «живых» объектов
 *   3. rig.update(dt)        — камера (по актуальным позициям)
 *   4. renderer.render()
 */

/* ══════════════════ renderer ══════════════════ */
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    logarithmicDepthBuffer: true,   // КЛЮЧЕВОЕ для огромного пространства
})
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 0.95
renderer.domElement.id = 'scene'
document.body.appendChild(renderer.domElement)

/* ══════════════════ сцена ══════════════════ */
const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 20000)

// worldRoot — всё, что существует в мире; нужен для «перебазировки» (floating origin).
const worldRoot = new THREE.Group()
worldRoot.name = 'worldRoot'
scene.add(worldRoot)
camera.position.set(0, 90000, 150000)

// общий свет: ночная сторона планет читается (рельеф, будущие огни городов),
// но остаётся заметно темнее дневной — объём планет не теряется
worldRoot.add(new THREE.AmbientLight(0x46587a, 1.15))   // фаза 5: ещё ярче по просьбе пользователя

/* ══════════════════ индикатор загрузки ══════════════════ */
const boot = document.getElementById('boot')
const bootBar = boot?.querySelector('.bar > i')
const bootSub = boot?.querySelector('.s')
function progress(f, label) {
    if (bootBar) bootBar.style.width = Math.round(Math.min(1, Math.max(0, f)) * 100) + '%'
    if (bootSub && label) bootSub.textContent = label
}
function hideBoot() {
    if (!boot) return
    boot.classList.add('gone')
    setTimeout(() => boot.remove(), 900)
}

/* ══════════════════ карта кампании ══════════════════ */
const loader = new GLTFLoader()
const map = createChartMap(renderer, camera, worldRoot)

/* ══════════════════ риг камеры ══════════════════ */
const rig = createCameraRig(camera, renderer.domElement, {
    worldRoot,
    rebaseThreshold: 3e5,
    fov: 75,
    minDist: 0.8,
    maxDist: 3.8e5,               // фаза 4: галактика R=300 000 целиком сверху (300k/0.83 + запас)
    baseSpeed: 1.9,
    speedPower: 1.0,
    zoomLambda: 0.16,
    rotateLambda: 0.5,
    followLambda: 0.4,
    linearAccel: 9,
    linearDamp: 6.5,
    bounds: map.bounds,             // жёсткий цилиндр: камера не вылетит за галактику
})
rig.setHome()

/* ══════════════════ скайбокс-панорама (главный фон) ══════════════════ */
// Панорама — ОСНОВНОЙ фон карты. При глубоком приближении к системам она
// растворяется, и backdrop'ом становится «рабочий материал» карты: паутина
// nebula_mapa и звёздное облако (см. updateSkyFade).
let skyMats = []
let skyObj = null
let starMats = []          // фаза 5: купол 2k_stars.jpg для максимального отдаления
let starDome = null
async function loadSkybox() {
    try {
        const gltf = await loader.loadAsync('/nebulae/models/billions_stars_skybox_hdri_panorama.glb')
        const sky = gltf.scene
        sky.name = 'skybox'
        // панорама — большая сфера; материал двусторонний и без записи глубины,
        // чтобы никогда не перекрывать объекты и не бороться с near/far
        sky.traverse((m) => {
            if (!m.isMesh) return
            m.frustumCulled = false
            const mat = m.material
            const mats = Array.isArray(mat) ? mat : [mat]
            for (const mm of mats) {
                mm.side = THREE.BackSide
                mm.depthWrite = false
                mm.depthTest = false
                mm.toneMapped = false
                mm.transparent = true
                // главный фон — яркий, но чуть холодный, чтобы золотая
                // паутина карты читалась поверх него
                mm.color = new THREE.Color(0.82, 0.82, 0.88)
                skyMats.push(mm)
            }
            m.renderOrder = -1
        })
        worldRoot.add(sky)
        skyObj = sky

        // фаза 5: на максимальном отдалении фоном служит чистое звёздное небо
        // 2k_stars.jpg (панорама там мешает читать галактику), а вблизи систем —
        // панорама GLB: космос никогда не бывает абсолютно чёрным
        const box = new THREE.Box3().setFromObject(sky)
        const R = box.getBoundingSphere(new THREE.Sphere()).radius || 1000
        const tex = new THREE.TextureLoader().load('/nebulae/textures/2k_stars.jpg')
        tex.colorSpace = THREE.SRGBColorSpace
        starDome = new THREE.Mesh(
            new THREE.SphereGeometry(R * 0.985, 48, 32),
            new THREE.MeshBasicMaterial({
                map: tex, side: THREE.BackSide, transparent: true, opacity: 0,
                depthWrite: false, depthTest: false, toneMapped: false,
            })
        )
        starDome.name = 'stardome'
        starDome.frustumCulled = false
        starDome.renderOrder = -2       // рисуется ПОД панорамой
        starDome.visible = false
        starMats = [starDome.material]
        sky.add(starDome)               // живёт внутри скайбокса: риг масштабирует оба

        rig.setSkybox(sky)          // риг держит её у камеры и масштабирует под far
    } catch (e) {
        console.warn('скайбокс не загрузился:', e?.message || e)
    }
}

/** Фаза 5: фон = панорама GLB от максимального приближения до средних дистанций;
    на максимальном отдалении её замещает купол 2k_stars.jpg. Кросс-фейд 120k→300k. */
function updateSkyFade() {
    if (!skyMats.length) return
    const d = rig.sph.dist
    const x = THREE.MathUtils.clamp((d - 120000) / 180000, 0, 1)
    const t = x * x * (3 - 2 * x)                 // smoothstep: 0 вблизи/средне → 1 далеко
    const op = 0.9 * (1 - t)                      // панорама: видна вплоть до средних
    for (const mm of skyMats) mm.opacity = op
    for (const mm of starMats) mm.opacity = t
    // полностью прозрачные слои не рисуем: минус полноэкранные проходы
    if (skyObj) skyObj.visible = op > 0.01
    if (starDome) starDome.visible = t > 0.01
}

/* ══════════════════ интерактор объектов ══════════════════ */
const interactor = createObjectInteractor(scene, rig, {
    domElement: renderer.domElement,
    pick: (x, y) => map.pick(x, y),
    describe: (hit) => map.describe(hit),
    approach: { theta: Math.PI / 2, phi: Math.PI / 2.35, pad: 2.6 },
})
// перебазировка сдвигает мир → сохранённая «точка возврата» должна сдвинуться тоже
rig.onRebase(({ shift }) => {
    const s = interactor.savedState
    if (s) s.focus.sub(shift)
})

/* ══════════════════ HUD ══════════════════ */
const hud = createRigHud(rig, {
    touch: isTouchDevice(),
    // фаза 4: «Галактика» снизу сбрасывает и выделение, чтобы карточка не висела
    onHome: () => interactor.deselect({ flyBack: false }),
})

/* ══════════════════ поиск по карте ══════════════════ */
const _proj = new THREE.Vector3()
/** p — в координатах ВСЕЛЕННОЙ. */
function projectToScreen(p) {
    _proj.copy(p).sub(rig.originShift).project(camera)
    return [(_proj.x * 0.5 + 0.5) * window.innerWidth, (-_proj.y * 0.5 + 0.5) * window.innerHeight]
}

function buildSearch() {
    const box = document.createElement('div')
    box.className = 'app-search app-ui'
    box.innerHTML = `
        <input type="text" placeholder="Поиск: система, роль…" autocomplete="off" spellcheck="false">
        <div class="res"></div>
    `
    document.body.appendChild(box)
    const input = box.querySelector('input')
    const res = box.querySelector('.res')
    const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').trim()

    function search(q) {
        q = norm(q)
        if (q.length < 2) { res.innerHTML = ''; res.classList.remove('open'); return }
        const out = []
        for (const s of map.named()) {
            if (norm(s.name).includes(q) || norm(s.role).includes(q)) { out.push(s); if (out.length >= 8) break }
        }
        if (!out.length) { res.innerHTML = '<div class="empty">ничего не найдено</div>'; res.classList.add('open'); return }
        res.innerHTML = out.map((s, i) =>
            `<button data-i="${i}"><b>${s.name}</b><span>${map.sectorOf(s.pos)}${s.role ? ' · ' + s.role : ''}</span></button>`
        ).join('')
        res.classList.add('open')
        res.querySelectorAll('button').forEach((b) => {
            b.addEventListener('click', () => {
                const s = out[+b.dataset.i]
                res.classList.remove('open')
                input.value = s.name
                input.blur()
                rig.flyTo({ position: rig.toRender(s.pos), dist: 3200, duration: 2.2 })
                setTimeout(() => interactor.selectAt(...projectToScreen(s.pos)), 2300)
            })
        })
    }
    let t = 0
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => search(input.value), 180) })
    input.addEventListener('focus', () => search(input.value))
    input.addEventListener('blur', () => setTimeout(() => res.classList.remove('open'), 220))
    input.addEventListener('keydown', (e) => {
        e.stopPropagation()                       // «S» в поле не должно включать полёт
        if (e.code === 'Enter') { const f = res.querySelector('button'); if (f) f.click() }
        if (e.code === 'Escape') { input.blur(); res.classList.remove('open') }
    })
    return box
}

/* Фаза 4: панель закладок (Галактика / Домашняя / Случайный узел / …) убрана
   по решению пользователя — остались поиск сверху и кнопка «Галактика» снизу. */
/* ══════════════════ индикатор сектора ══════════════════ */
function buildSectorBadge() {
    const el = document.createElement('div')
    el.className = 'app-sector app-ui'
    el.innerHTML = '<span class="k">Сектор</span><b>—</b><i></i>'
    document.body.appendChild(el)
    const b = el.querySelector('b')
    const i = el.querySelector('i')
    let acc = 0
    rig.on('update', () => {
        if (++acc % 12) return
        const s = map.sectorOf(rig.focusUniverse)
        if (b.textContent !== s) b.textContent = s
        const near = map.nearestNamed(rig.focusUniverse)
        if (!near) { i.textContent = ''; return }
        const d = near.pos.distanceTo(rig.focusUniverse)
        i.textContent = d < 1 ? near.entry.name + ' · в фокусе' : `${near.entry.name} · ${fmtUnits(d)}`
    })
    return el
}

/* ══════════════════ старт ══════════════════ */
async function boot0() {
    document.body.classList.add(isTouchDevice() ? 'is-touch' : 'is-desktop')
    progress(0.02, 'загрузка карты…')
    // страховка: если за 30 секунд не загрузились — подсказка вместо тишины
    setTimeout(() => {
        const b = document.getElementById('boot')
        if (b && !b.classList.contains('gone')) {
            progress(0.97, 'задержка… откройте консоль (F12) и обновите страницу (Ctrl+R)')
        }
    }, 30000)

    // скайбокс и карта грузятся параллельно
    await Promise.all([loadSkybox(), map.load(progress)])

    // фаза 4: старт = «вся галактика сверху» — это же положение возвращает
    // кнопка «Галактика» снизу (rig.setHome / flyHome)
    rig.setState({
        dist: 3.8e5,
        theta: 0.5,
        phi: 0.18,
        lookAt: new THREE.Vector3(0, 0, 0),
    })
    rig.setHome()

    buildSearch()
    buildSectorBadge()

    progress(1, 'готово')
    setTimeout(hideBoot, 350)
}

/* ══════════════════ главный цикл ══════════════════ */
let prevT = performance.now()
function animate() {
    requestAnimationFrame(animate)
    const now = performance.now()
    const dt = Math.min((now - prevT) / 1000, 0.05)
    prevT = now
    map.update(dt, rig)
    interactor.update(dt)
    rig.update(dt)
    updateSkyFade()
    renderer.render(scene, camera)
}
animate()
boot0().catch((e) => {
    // фаза 5+: ошибка загрузки не должна выглядеть как «бесконечная загрузка»:
    // показываем текст ошибки прямо в оверлее и дублируем в консоль
    console.error('boot failed:', e)
    progress(1, 'ошибка загрузки: ' + (e?.message || String(e)))
})

/* ══════════════════ resize ══════════════════ */
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
    map.setPixelRatio(renderer.getPixelRatio())
})

/* ══════════════════ отладка из консоли ══════════════════ */
window.SWN = { THREE, scene, camera, renderer, rig, map, chart: map, interactor, hud, worldRoot }
console.log(
    '%cSWN · звёздная карта%c\n' +
    'Консоль: SWN.rig, SWN.chart, SWN.interactor\n' +
    '  SWN.chart.dumpNodes()            — список узлов nebula_mapa.glb\n' +
    '  SWN.chart.named()                — именованные системы\n' +
    '  SWN.chart.addSystem({ node: 512, name: \'Моя\', star: \'sun\' })  — система без перезагрузки\n' +
    '  SWN.rig.flyTo({ position: SWN.chart.named()[0].pos, dist: 2000 })\n' +
    '  Правь системы в src/map/systems.data.js (гайд: src/map/HOWTO.md)',
    'color:#e0b84f;font-weight:700', 'color:#9a8f76')
