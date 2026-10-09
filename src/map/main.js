import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

// gsap НЕ импортируем из npm (просьба пользователя): он подключён CDN-тегом в
// index.html и живёт в window.gsap; cameraRig/objectUse берут его оттуда сами.
// Без gsap карта тоже работает (мгновенные перелёты) — ничего не падает.
// отключаем lagSmoothing: иначе на слабом железе/software-GL перелёты камеры
// растягиваются на секунды (gsap «догоняет» пропущенное время).
if (window.gsap && window.gsap.ticker) window.gsap.ticker.lagSmoothing(0)

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
renderer.toneMappingExposure = 1.0
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
worldRoot.add(new THREE.AmbientLight(0x5a6c8c, 0.9))    // фаза 6: ambient 0.9 (тусклость лечится depthTest неба, неambient)

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
    maxDist: 1.7e5,               // фаза 10: отдаление чуть больше прежнего
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
                mm.depthTest = true      // фаза 6: небо СТРОГО фон, не поверх объектов
                mm.toneMapped = false
                mm.transparent = true
                // фаза 7: панорама рисуется ПОД куполом звёзд
                // главный фон — яркий, но чуть холодный, чтобы золотая
                // паутина карты читалась поверх него
                mm.color = new THREE.Color(0.82, 0.82, 0.88)
                skyMats.push(mm)
            }
            m.renderOrder = -2
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
                depthWrite: false, depthTest: true, toneMapped: false,
                // аддитивно: звёзды читаются ПОВЕРХ панорамы на любом зуме
                blending: THREE.AdditiveBlending,
            })
        )
        starDome.name = 'stardome'
        starDome.frustumCulled = false
        starDome.renderOrder = -1       // рисуется ПОВЕРХ панорамы (аддитивно)
        starDome.visible = false
        starMats = [starDome.material]
        sky.add(starDome)               // живёт внутри скайбокса: риг масштабирует оба

        rig.setSkybox(sky)          // риг держит её у камеры и масштабирует под far
    } catch (e) {
        console.warn('скайбокс не загрузился:', e?.message || e)
    }
}

/** Фаза 6: звёздное небо (2k_stars) — фон ВСЕГДА, от максимального отдаления
    до момента, когда солнечная система становится видна как система (~15k).
    Только ниже панорама GLB начинает примешиваться, а на максимальном
    приближении остаётся малая часть звёзд (не гасим купол в ноль). */
function updateSkyFade() {
    if (!skyMats.length) return
    // фаза 10: в 2D-плане неба нет — плоский тёмный фон чертежа
    if (rig.mode2d) {
        if (skyObj) skyObj.visible = false
        if (starDome) starDome.visible = false
        return
    }
    const d = rig.sph.dist
    // 1 = далеко (система ещё точка) → 0 вблизи (система видна)
    const far = THREE.MathUtils.clamp((d - 1500) / 13500, 0, 1)
    const t = far * far * (3 - 2 * far)              // smoothstep
    // фаза 8: у самого объекта панорама слегка притушает, чтобы точки звёзд
    // читались поверх неё; вдали — как прежде
    const near = THREE.MathUtils.clamp((d - 15) / 105, 0, 1)
    const nT = near * near * (3 - 2 * near)
    const op = 0.9 * (1 - t) * (0.55 + 0.45 * nT)
    for (const mm of skyMats) mm.opacity = op
    // фаза 10: купол звёзд всегда виден, но чуть притушен, не спорит с картой
    for (const mm of starMats) mm.opacity = 0.78
    // родитель НЕ скрывать: внутри живёт купол звёзд (иначе фон чернеет)
    if (skyObj) skyObj.visible = true
    if (starDome) starDome.visible = true
}

/* ══════════════════ интерактор объектов ══════════════════ */
const interactor = createObjectInteractor(scene, rig, {
    domElement: renderer.domElement,
    pick: (x, y) => map.pick(x, y),
    describe: (hit) => map.describe(hit),
    // фаза 7: карточке нужен построенный sys-объект (orbiters) по записи системы
    getSystem: (e) => map.systems.find((s) => s.entry === e) || null,
    // фаза 10: кнопка «В 3D» в карточке выходит из плана и долетает до объекта
    onExit2D: () => toggle2D(false),
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
    // фаза 10: переключатель 3D/2D
    on2D: () => toggle2D(),
})
function toggle2D(force) {
    const on = rig.setMode2D(force ?? !rig.mode2d)
    map.set2D(on)
    hud.set2D(on)
    interactor.refreshCard?.()
    return on
}

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

    // Фаза 9: поиск по ВСЕЙ базе: системы, звёзды, планеты, секторы, регионы,
    // необследованные узлы. Индекс строится ОДИН раз (и перестраивается только
    // при изменении состава карты) — на телефоне поиск не тормозит.
    let INDEX = null, INDEX_KEY = ''
    function buildIndex() {
        const idx = []
        const add = (o) => { o.n = norm(o.name); o.s = norm(o.sub || ''); idx.push(o) }
        for (const n of map.named()) {
            const e = n.sys?.entry ?? n
            const sec = map.sectorOf(n.pos)
            add({ name: e.name, tag: 'система', tc: 't-sys', chip: map.starChip(e),
                sub: sec + (e.role ? ' · ' + e.role : ''), act: () => interactor.focusSystem(e) })
            if (e.star) add({ name: e.star.name || e.name, tag: 'звезда', tc: 't-star', chip: map.starChip(e),
                sub: e.name + (e.star.kind ? ' · ' + e.star.kind : '') + ' · ' + sec, act: () => interactor.focusStar(e) })
            ;(e.planets || []).forEach((pl, i) => add({
                name: pl.name, tag: 'планета', tc: 't-planet', chip: map.planetChip(pl),
                sub: e.name + (pl.kind ? ' · ' + pl.kind : '') + (pl.orbit ? ' · орб. ' + pl.orbit : '') + ' · ' + sec,
                act: () => interactor.focusPlanet(e, i) }))
        }
        for (const sec of map.sectors()) add({ name: sec, tag: 'сектор', tc: 't-sector', chip: '#7fb4ff',
            sub: map.regionOf(sec)?.name || 'квадрат сетки карты', act: () => flySector(sec) })
        for (const r of (map.campaign?.regions || [])) add({ name: r.name, tag: 'регион', tc: 't-region',
            chip: r.color || '#d98aff', sub: (r.sectors || []).length + ' сект.', act: () => flyRegion(r) })
        for (const nd of map.nodes) {
            if (nd.system) continue
            add({ name: 'узел ' + nd.index, tag: 'узел', tc: 't-node', chip: '#6b7280',
                sub: map.sectorOf(nd.pos) + ' · необследован', act: () => flyNode(nd) })
        }
        return idx
    }
    function search(q) {
        q = norm(q)
        if (q.length < 2) { res.innerHTML = ''; res.classList.remove('open'); return }
        const key = map.systems.length + '/' + map.nodes.length
        if (!INDEX || key !== INDEX_KEY) { INDEX = buildIndex(); INDEX_KEY = key }
        const out = []
        for (const o of INDEX) {
            if (o.n.includes(q) || o.s.includes(q) || norm(o.tag).includes(q)) { out.push(o); if (out.length >= 10) break }
        }
        if (!out.length) { res.innerHTML = '<div class="empty">ничего не найдено</div>'; res.classList.add('open'); return }
        res.innerHTML = out.map((o, i) =>
            `<button data-i="${i}"><i class="chip" style="background:${o.chip}"></i><b>${o.name}</b>` +
            `<span><i class="sq-tag ${o.tc}">${o.tag}</i>${o.sub}</span></button>`
        ).join('')
        res.classList.add('open')
        res.querySelectorAll('button').forEach((b) => {
            b.addEventListener('click', () => {
                const o = out[+b.dataset.i]
                res.classList.remove('open')
                input.value = o.name
                input.blur()
                o.act()
            })
        })
    }

    function flyNode(nd) {
        interactor.deselect({ flyBack: false })
        rig.flyTo({ position: rig.toRender(nd.pos.clone()), dist: 2500, duration: 2 })
    }
    function flySector(sec) {
        interactor.deselect({ flyBack: false })
        const c = map.sectorCenter(sec)
        if (c) rig.flyTo({ position: rig.toRender(c), dist: map.sectorSize * 1.6, duration: 2.2 })
    }
    function flyRegion(r) {
        interactor.deselect({ flyBack: false })
        const cs = (r.sectors || []).map(map.sectorCenter).filter(Boolean)
        if (!cs.length) return
        const c = cs.reduce((a, v) => a.add(v), new THREE.Vector3()).multiplyScalar(1 / cs.length)
        rig.flyTo({ position: rig.toRender(c), dist: map.sectorSize * Math.max(2, cs.length), duration: 2.4 })
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
    // фаза 7: живой счётчик дистанции убран (читался как «плашка скорости»),
    // осталось только имя сектора
    el.innerHTML = '<span class="k">Сектор</span><b>—</b><i class="rg"></i>'
    document.body.appendChild(el)
    const b = el.querySelector('b')
    const rg = el.querySelector('.rg')
    let acc = 0
    rig.on('update', () => {
        if (++acc % 12) return
        const s = map.sectorOf(rig.focusUniverse)
        if (b.textContent !== s) b.textContent = s
        // фаза 8: регион сектора (когда заполнишь CAMPAIGN.regions)
        const r = map.regionOf(s)
        const want = r ? r.name : ''
        if (rg.textContent !== want) {
            rg.textContent = want
            rg.style.display = want ? 'inline' : 'none'
            if (r?.color) rg.style.color = r.color
        }
    })
    return el
}

/* Штамп сборки: скажи пользователю «сборка phase-12» — и сразу видно,
   какая копия кода у него реально работает (рассинхрон = источник «старых» багов). */
const SWN_BUILD = 'phase-12'
window.SWN_BUILD = SWN_BUILD

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
        dist: 1.48e5,             // фаза 8: обзор, в котором граница почти впритык
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
window.SWN = { THREE, scene, camera, renderer, rig, map, chart: map, interactor, hud, worldRoot, build: SWN_BUILD, toggle2D }
console.log(
    '%cSWN · звёздная карта%c  сборка ' + SWN_BUILD + '\n' +
    'Консоль: SWN.rig, SWN.chart, SWN.interactor\n' +
    '  SWN.chart.dumpNodes()            — список узлов nebula_mapa.glb\n' +
    '  SWN.chart.named()                — именованные системы\n' +
    '  SWN.chart.addSystem({ node: 512, name: \'Моя\', star: \'sun\' })  — система без перезагрузки\n' +
    '  SWN.rig.flyTo({ position: SWN.chart.named()[0].pos, dist: 2000 })\n' +
    '  Правь системы в src/map/systems.data.js (гайд: src/map/HOWTO.md)',
    'color:#e0b84f;font-weight:700', 'color:#9a8f76')
