import * as THREE from 'three'
import { clamp, damp, dampVec3, wrapAngle, angleDelta, createSma } from './rigMath.js'

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  cameraRig.js — модуль движения и полёта камеры для ОГРОМНОЙ 3D-карты
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Заменяет OrbitControls одним контроллером, который одинаково хорош
 * и «впритык к планете», и на расстоянии миллиона юнитов.
 *
 * ── 6 решений, из-за которых полёт ощущается «не криво» ────────────────────
 *
 * 1) МУЛЬТИПЛИКАТИВНЫЙ ЗУМ.  dist *= exp(delta·k), а не dist += c.
 *    Один щелчок колеса ВСЕГДА меняет масштаб в одинаковое число раз —
 *    и у поверхности планеты, и на краю галактики. Именно этого не умеет
 *    OrbitControls (у него zoomSpeed линейный → вблизи «прыгает», вдали «не едет»).
 *
 * 2) СКОРОСТЬ ∝ МАСШТАБУ ОБЗРА.  speed = base · dist^power · mul · boost.
 *    Держа W, вы за секунду пролетаете примерно одинаковую ДОЛЮ видимого
 *    пространства. dist = 2 (у планеты) → ювелирно; dist = 400 000 (галактика)
 *    → перелёт за секунды. Поверх — ручной множитель (слайдер, Shift, Ctrl, 0–9),
 *    когда авто-масштаба мало или много.
 *
 * 3) ДИНАМИЧЕСКИЙ NEAR/FAR.  near = dist·0.02, far = dist·3000, пересчёт каждый кадр.
 *    Классическая причина «кривого» большого пространства — фиксированные
 *    near=0.1/far=10000: либо z-fighting вблизи, либо обрезанная галактика вдали.
 *    В паре с `logarithmicDepthBuffer: true` рабочий диапазон ≈ 9 порядков.
 *
 * 4) FLOATING ORIGIN (перебазировка).  GPU хранит позиции в float32: на координатах
 *    ~1e6 точность падает до ~0.06 юнита → объекты «дрожат», когда подлетаешь близко.
 *    Как только фокус улетает дальше rebaseThreshold, мир сдвигается обратно к нулю,
 *    камера остаётся на месте — игрок не видит ничего.
 *
 * 5) КАДРОНЕЗАВИСИМОЕ ДЕМПФИРОВАНИЕ + ИНЕРЦИЯ.  Всё сглаживание через
 *    1 − (1−λ)^(dt·60). Ощущение идентично на 60 и 144 Гц (обычный lerp(…, 0.1)
 *    в rAF — это баг). Скорость набирается и гаснет экспоненциально → корабль
 *    чувствуется тяжёлым, а не как курсор мыши.
 *
 * 6) СКАЙБОКС ПРИВЯЗАН К КАМЕРЕ.  Панорама/туманность масштабом в тысячи юнитов
 *    на фиксированной позиции либо обрезается far-ом, либо «уезжает» при полёте.
 *    Здесь она каждый кадр центрируется на камере → всегда вокруг игрока.
 *
 * ── Управление ─────────────────────────────────────────────────────────────
 *   ЛКМ-драг / 1 палец ......... орбита вокруг точки фокуса
 *   ПКМ-драг / Shift+ЛКМ ....... панорамирование (сдвиг фокуса)
 *   Колесо / пинч .............. экспоненциальный зум
 *   2 пальца, драг центроида ... панорамирование
 *   W A S D .................... полёт (в плоскости взгляда)
 *   Q / E ...................... вниз / вверх
 *   Shift ...................... ускоритель ×8 (+ эффект рывка FOV)
 *   Ctrl ....................... точный режим ×0.12
 *   0…9  и  [ / ] .............. ручной множитель скорости
 *   Space ...................... стоп (гасит инерцию)
 *   F .......................... вписать текущий объект в кадр
 *   Home ....................... вернуться домой
 *
 * Риг ничего не знает про сцену: нужны только camera + domElement
 * (и опционально worldRoot для перебазировки).
 * ══════════════════════════════════════════════════════════════════════════
 */

export const RIG_DEFAULTS = {
    /* — скорость — */
    baseSpeed: 1.8,       // скорость при dist = 1 юнит, в «долях дистанции»
    speedPower: 1.0,      // 1.0 = строго масштабно-инвариантно; 0.85 = чуть медленнее вдали
    boostMul: 8,          // Shift
    fineMul: 0.12,        // Ctrl
    linearAccel: 9,       // как быстро набирается скорость (меньше = «тяжелее» корабль)
    linearDamp: 7,        // как быстро гаснет после отпускания клавиш

    /* — зум — */
    zoomRate: 0.0016,     // на единицу wheel deltaY  (≈ ×1.17 за щелчок)
    zoomTouchRate: 1.15,  // чувствительность пинча
    zoomLambda: 0.14,     // сглаживание зума (0.14 мягко, 0.35 резко)
    minDist: 0.6,
    maxDist: 1.7e5,       // фаза 10: отдаление чуть больше прежнего
    focusOffset: 0,       // фаза 4: доля полуширины экрана, на которую цель уводится ВПРАВО
                          // (сам объект при этом виден левее центра — карточка справа не перекрывает)
                          // но улететь «в ничто» за её пределы уже нельзя

    /* — вращение — */
    rotateSpeed: 1.0,     // 1.0 ≈ «взялся за небо и тянешь»
    rotateLambda: 0.45,
    invertY: false,
    phiMin: 0.02,
    phiMax: Math.PI - 0.02,

    /* — панорамирование — */
    panLambda: 0.35,
    panScaleWithDist: true,

    /* — следование — */
    followLambda: 0.35,

    /* — near/far — */
    nearScale: 0.02, nearMin: 0.002, nearMax: 50,
    farScale: 3000, farMin: 200, farMax: 8e8,

    /* — большое пространство — */
    worldRoot: null,        // THREE.Object3D с миром (для перебазировки); null = worldRoot = scene
    rebaseThreshold: 3e5,   // 0 = выключить
    skybox: null,           // объект-панорама, центрируется на камере
    skyboxLocalOffset: null,// смещение панорамы относительно камеры (Vector3)

    /* — FOV-эффекты — */
    fovBase: 75,
    fovBoost: 12,
    fovLambda: 0.12,

    /* — граница мира — */
    // { radius, height } — цилиндр вокруг центра, за который фокус не выпускаем.
    // null = без границы. Мягкое ограничение: цель зажимается, камера догоняет.
    bounds: null,

    /* — прочее — */
    dragClickThreshold: 6,
    fov: 75,
}

export function createCameraRig(camera, domElement, options = {}) {
    const o = Object.assign({}, RIG_DEFAULTS, options)
    if (o.fov) o.fovBase = o.fov
    // gsap берём лениво: модуль может быть подключён как через npm (window.gsap
    // выставляется в main.js), так и через CDN в index.html — порядок инициализации
    // не должен иметь значения.
    const getGsap = () => (typeof window !== 'undefined' ? window.gsap || null : null)
    const worldRoot = o.worldRoot || null

    /* ═══════════ состояние ═══════════ */
    const focus = new THREE.Vector3()          // точка, вокруг которой живёт камера
    const focusTarget = new THREE.Vector3()    // цель (к ней стремимся сглаженно)
    const _aimRight = new THREE.Vector3()      // фаза 4: экранный «вправо» для смещения цели
    const _aim = new THREE.Vector3()
    let offCur = 0                             // сглаженное значение o.focusOffset
    const sph = { dist: 100, theta: 0, phi: Math.PI / 2.4 }
    const sphTarget = { dist: 100, theta: 0, phi: Math.PI / 2.4 }
    const home = { focus: new THREE.Vector3(), dist: 100, theta: 0, phi: Math.PI / 2.4 }

    const vel = new THREE.Vector3()            // инерция фокуса
    const desiredVel = new THREE.Vector3()
    const keySmooth = { f: 0, r: 0, u: 0 }     // сглаженный ввод с клавиатуры/джойстика
    let externalInput = { f: 0, r: 0, u: 0 }   // ввод от виртуального джойстика
    let speedMul = 1                           // ручной множитель
    const speedMulSmooth = { v: 1 }
    let boost = false, fine = false
    // фаза 8: «Точно» и «Ускоритель» — защёлки: нажал = держится, нажал ещё раз = выкл
    let sticky = { boost: false, fine: false }
    // фаза 10: 2D-план: вид строго сверху, ЛКМ = панорама, углы заморожены
    let mode2d = false, prev3d = null

    let subject = null                         // объект, за которым летим
    const subjectPos = new THREE.Vector3()
    const subjectPrev = new THREE.Vector3()

    let locked = false, paused = false
    let suppressUntil = 0
    let flightTween = null
    let flightFrom = null
    let rebaseCount = 0
    let fovCur = o.fovBase
    const fpsSma = createSma(40)

    /* ═══════════ клавиатура ═══════════ */
    const keys = new Set()
    const MOVE_KEYS = new Set([
        'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
        'ShiftLeft', 'ShiftRight', 'Space',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ])
    const PREVENT = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
    const isField = (t) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)

    function onKeyDown(e) {
        if (isField(e.target) || e.metaKey) return
        const c = e.code
        // фаза 8: Space («точно») и Shift («ускоритель») — ЗАЩЁЛКИ:
        // нажатие включает режим до следующего нажатия, а не пока держишь
        if (c === 'Space' || c === 'ShiftLeft' || c === 'ShiftRight') {
            e.preventDefault()
            if (!e.repeat) {
                if (c === 'Space') sticky.fine = !sticky.fine
                else sticky.boost = !sticky.boost
                emit('sticky', { fine: sticky.fine, boost: sticky.boost })
            }
            return
        }
        if (MOVE_KEYS.has(c)) { keys.add(c); if (PREVENT.has(c)) e.preventDefault(); return }
        switch (c) {
            case 'BracketLeft': stepSpeed(-1); e.preventDefault(); break
            case 'BracketRight': stepSpeed(+1); e.preventDefault(); break
            case 'Home': flyHome(); e.preventDefault(); break
            default:
                if (/^Digit[0-9]$/.test(c)) { setSpeedStep(+c[5]); e.preventDefault() }
        }
    }
    const onKeyUp = (e) => keys.delete(e.code)
    const onBlur = () => { keys.clear(); rotInput.x = rotInput.y = 0; panInput.x = panInput.y = 0 }

    /* ═══════════ указатели (мышь + тач в одном месте) ═══════════ */
    const pointers = new Map()
    let pinch = null
    let rotInput = { x: 0, y: 0 }
    let panInput = { x: 0, y: 0 }
    let lastPointer = null
    let activeCount = 0

    const rect = () => domElement.getBoundingClientRect()

    function onPointerDown(e) {
        if (e.target !== domElement || locked || paused) return
        if (performance.now() < suppressUntil) return
        if (e.pointerType === 'mouse' && e.button === 1) return
        cancelFlight()

        pointers.set(e.pointerId, {
            x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY,
            moved: 0, type: e.pointerType, button: e.button,
        })
        activeCount = pointers.size
        try { domElement.setPointerCapture(e.pointerId) } catch (_) { /* noop */ }
        if (e.pointerType === 'mouse') domElement.style.cursor = (e.button === 2 || e.shiftKey) ? 'grabbing' : 'grab'
        if (pointers.size === 2) beginPinch()
        if (e.pointerType === 'touch' && e.cancelable) e.preventDefault()
    }

    function onPointerMove(e) {
        const p = pointers.get(e.pointerId)
        if (!p) return
        const dx = e.clientX - p.x, dy = e.clientY - p.y
        p.moved += Math.abs(dx) + Math.abs(dy)
        p.x = e.clientX; p.y = e.clientY

        if (pointers.size >= 2) { updatePinch(); return }
        // в 2D любое перетаскивание = панорама (орбита не нужна)
        const pan = p.type === 'mouse' ? (p.button === 2 || e.shiftKey || mode2d) : false
        if (pan) { panInput.x += dx; panInput.y += dy } else { rotInput.x += dx; rotInput.y += dy }
    }

    function onPointerUp(e) {
        lastPointer = pointers.get(e.pointerId) || lastPointer
        pointers.delete(e.pointerId)
        activeCount = pointers.size
        if (pointers.size < 2) pinch = null
        try { domElement.releasePointerCapture(e.pointerId) } catch (_) { /* noop */ }
        if (lastPointer && lastPointer.type === 'mouse') domElement.style.cursor = ''
    }

    function beginPinch() {
        const [a, b] = [...pointers.values()]
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
    }

    function updatePinch() {
        const [a, b] = [...pointers.values()]
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
        if (!pinch) { beginPinch(); return }
        // ЗУМ ЧЕРЕЗ ОТНОШЕНИЕ расстояний — снова мультипликативно, без «ступенек»
        const ratio = pinch.dist / d
        sphTarget.dist = clamp(sphTarget.dist * Math.pow(ratio, o.zoomTouchRate), o.minDist, o.maxDist)
        pinch.dist = d
        panInput.x += cx - pinch.cx
        panInput.y += cy - pinch.cy
        pinch.cx = cx; pinch.cy = cy
    }

    function onWheel(e) {
        if (locked || paused) return
        if (e.cancelable) e.preventDefault()
        cancelFlight()
        let d = e.deltaY
        if (e.deltaMode === 1) d *= 16          // Firefox, строки
        else if (e.deltaMode === 2) d *= 100    // страницы
        d = clamp(d, -260, 260)
        sphTarget.dist = clamp(sphTarget.dist * Math.exp(d * o.zoomRate), o.minDist, o.maxDist)
        noteUserMove()
        setTimeout(() => { moveNotified = false }, 0)
    }

    const onContextMenu = (e) => e.preventDefault()

    /* ═══════════ ручная скорость ═══════════ */
    const SPEED_STEP = Math.pow(10, 1 / 9)   // 9 шагов = диапазон ровно ×10
    function setSpeedStep(i) { speedMul = Math.pow(SPEED_STEP, clamp(i, 0, 9)); emit('speed', speedMul) }
    function stepSpeed(dir) {
        const cur = Math.log(speedMul) / Math.log(SPEED_STEP)
        setSpeedStep(Math.round(clamp(cur + dir, 0, 9)))
    }
    function setSpeedMultiplier(v) { speedMul = clamp(v, 0.01, 100); emit('speed', speedMul) }

    /* ═══════════ события ═══════════ */
    const listeners = new Map()
    function on(evt, fn) {
        if (!listeners.has(evt)) listeners.set(evt, new Set())
        listeners.get(evt).add(fn)
        return () => listeners.get(evt)?.delete(fn)
    }
    function emit(evt, p) {
        const set = listeners.get(evt)
        if (!set) return
        // слушатель (HUD) не имеет права уронить цикл обновления камеры
        for (const f of set) {
            try { f(p) } catch (err) { console.error('[rig] слушатель "' + evt + '" упал:', err) }
        }
    }

    /* ═══════════ публичные команды ═══════════ */

    function setState({ position = null, lookAt = null, dist = null, theta = null, phi = null } = {}) {
        if (lookAt) { focus.copy(lookAt); focusTarget.copy(lookAt) }
        if (position) {
            const s = new THREE.Spherical().setFromVector3(new THREE.Vector3().subVectors(position, focus))
            if (dist == null) dist = s.radius
            if (theta == null) theta = s.theta
            if (phi == null) phi = s.phi
        }
        sph.dist = sphTarget.dist = clamp(dist ?? sph.dist, o.minDist, o.maxDist)
        sph.theta = sphTarget.theta = wrapAngle(theta ?? sph.theta)
        sph.phi = sphTarget.phi = clamp(phi ?? sph.phi, o.phiMin, o.phiMax)
        vel.set(0, 0, 0)
        applyTransform(0.016)
        return api
    }

    /**
     * Плавный кинематографичный перелёт — единая точка входа и для «выдвижения
     * камеры к объекту» (objectUse.js), и для закладок/поиска по карте.
     */
    function flyTo({
        position = null, dist = null, theta = null, phi = null,
        duration = 1.6, ease = 'power2.inOut', subject: subj = null,
        onComplete = null, onUpdate = null, freezeAngles = false,
    } = {}) {
        cancelFlight()
        vel.set(0, 0, 0)
        rotInput.x = rotInput.y = 0
        panInput.x = panInput.y = 0
        // фаза 12: железное правило — перелёт, которому НЕ задали углы явно,
        // не меняет их вовсе (никакого «доворота» и карусели на переходах).
        // Крутят только: рука пользователя, «Галактика» и выход из 2D-плана.
        if (theta == null && phi == null) freezeAngles = true

        if (subj !== undefined) {
            subject = subj
            if (subject) subject.getWorldPosition(subjectPrev)
        }

        const to = {
            dist: clamp(dist ?? sphTarget.dist, o.minDist, o.maxDist),
            theta: theta != null ? sphTarget.theta + angleDelta(sphTarget.theta, theta) : sphTarget.theta,
            phi: clamp(phi ?? sphTarget.phi, o.phiMin, o.phiMax),
        }
        const dest = position
            ? position.clone()
            : (subject ? subject.getWorldPosition(new THREE.Vector3()) : focusTarget.clone())

        flightFrom = { focus: focus.clone(), dist: sph.dist, theta: sph.theta, phi: sph.phi }
        focusTarget.copy(dest)
        const from = flightFrom

        const gsap = getGsap()
        if (!gsap) {
            // без gsap — просто мгновенно переставляем (поведение не ломаем)
            sphTarget.dist = to.dist; sphTarget.theta = to.theta; sphTarget.phi = to.phi
            focus.copy(dest)
            applyTransform(0.016)
            onComplete?.()
            return null
        }

        const proxy = { t: 0 }
        flightTween = gsap.to(proxy, {
            t: 1, duration, ease,
            onUpdate: () => {
                const t = proxy.t
                // focusTarget уже «едет» вместе с субъектом (см. update) — просто lerpiруем к нему
                focus.lerpVectors(from.focus, focusTarget, t)
                // «выдвижение»: лёгкий откат назад в начале, затем выход на целевую дистанцию
                const bulge = 1 + 0.16 * Math.sin(Math.PI * Math.min(t * 1.4, 1))
                const logD = Math.log(from.dist) + (Math.log(to.dist) - Math.log(from.dist)) * t
                sphTarget.dist = clamp(Math.exp(logD) * bulge, o.minDist, o.maxDist)
                sphTarget.theta = from.theta + (to.theta - from.theta) * t
                sphTarget.phi = from.phi + (to.phi - from.phi) * t
                // фаза 8: дальний перелёт НЕ доворачивает камеру: углы заморожены
                if (freezeAngles) { sphTarget.theta = from.theta; sphTarget.phi = from.phi }
                onUpdate?.(t)
            },
            onComplete: () => {
                flightTween = null; flightFrom = null
                sphTarget.dist = to.dist
                if (freezeAngles) { sphTarget.theta = from.theta; sphTarget.phi = from.phi }
                vel.set(0, 0, 0)
                onComplete?.()
            },
        })
        return flightTween
    }

    /** Убивает активный перелёт и СООБЩАЕТ об этом (интегратору нужно починить состояние). */
    function cancelFlight() {
        const had = !!flightTween
        if (flightTween) flightTween.kill?.()
        flightTween = null; flightFrom = null
        if (had) emit('flightCancel')
    }

    /** Вписать объект в кадр по его bounding sphere (учитывает FOV и aspect). */
    function frameObject(obj, { pad = 1.55, fly = true, duration = 1.5 } = {}) {
        const sphere = new THREE.Sphere()
        new THREE.Box3().setFromObject(obj).getBoundingSphere(sphere)
        const r = Math.max(sphere.radius, 1e-4)
        const vFov = (camera.fov * Math.PI) / 180
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect)
        const dist = clamp((r / Math.sin(Math.min(vFov, hFov) / 2)) * pad, o.minDist, o.maxDist)
        if (fly) return flyTo({ position: sphere.center, dist, duration, subject: obj })
        focus.copy(sphere.center); focusTarget.copy(sphere.center)
        sph.dist = sphTarget.dist = dist
        return api
    }

    function followObject(obj, { dist = null } = {}) {
        subject = obj || null
        if (subject) subject.getWorldPosition(subjectPrev)
        if (dist != null) sphTarget.dist = clamp(dist, o.minDist, o.maxDist)
        vel.set(0, 0, 0)
    }

    function releaseSubject() { subject = null }

    function flyHome(opts = {}) {
        return flyTo({
            position: home.focus.clone(), dist: home.dist, theta: home.theta, phi: home.phi,
            duration: opts.duration ?? 1.8, subject: null,
        })
    }
    function setHome() {
        home.focus.copy(focus); home.dist = sph.dist; home.theta = sph.theta; home.phi = sph.phi
    }

    // Блокировка гасит ВВОД пользователя, но НЕ программный перелёт:
    // иначе «подлёт к объекту» убивался бы собственным setLocked(true).
    const setSkybox = (obj) => { o.skybox = obj || null; if (obj) applyTransform(0.016) }
    const setBounds = (b) => { o.bounds = b || null }
    const setLocked = (v) => { locked = !!v; if (locked) vel.set(0, 0, 0) }
    const setPaused = (v) => { paused = !!v }
    const suppressPointer = (ms = 240) => { suppressUntil = performance.now() + ms }
    const isDragging = () => activeCount > 0
    const lastGestureWasDrag = () => !!lastPointer && lastPointer.moved > o.dragClickThreshold
    const orbitBy = (dTheta, dPhi) => {
        sphTarget.theta = wrapAngle(sphTarget.theta + dTheta)
        sphTarget.phi = clamp(sphTarget.phi + dPhi, o.phiMin, o.phiMax)
    }
    function onRebase(fn) { on('rebase', fn) }
    /* фаза 10: вход/выход из 2D-плана */
    function setMode2D(on) {
        on = !!on
        if (on === mode2d) return mode2d
        if (on) prev3d = { theta: sph.theta, phi: sph.phi, dist: sph.dist }
        mode2d = on
        emit('mode2d', on)
        if (!on && prev3d) flyTo({ theta: prev3d.theta, phi: prev3d.phi, dist: prev3d.dist, duration: 1.1 })
        return mode2d
    }

    /* фаза 8: защёлки «точно» / «ускоритель» */
    function toggleFine() { sticky.fine = !sticky.fine; emit('sticky', { fine: sticky.fine, boost: sticky.boost }); return sticky.fine }
    function toggleBoost() { sticky.boost = !sticky.boost; emit('sticky', { fine: sticky.fine, boost: sticky.boost }); return sticky.boost }

    /* ═══════════ update ═══════════ */
    const _fwd = new THREE.Vector3()
    const _right = new THREE.Vector3()
    const _up = new THREE.Vector3(0, 1, 0)
    const _off = new THREE.Vector3()
    const _sph = new THREE.Spherical()
    const _m4 = new THREE.Matrix4()
    const _v3 = new THREE.Vector3()

    let moveNotified = false
    function noteUserMove() {
        if (moveNotified) return
        moveNotified = true
        emit('userMove')
    }

    function readInput(dt) {
        const raw = {
            f: (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0),
            r: (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0),
            u: (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0),
        }
        // джойстик с телефона просто добавляет свой вектор
        raw.f += externalInput.f; raw.r += externalInput.r; raw.u += externalInput.u
        const len = Math.hypot(raw.f, raw.r, raw.u)
        if (len > 1) { raw.f /= len; raw.r /= len; raw.u /= len }

        // асимметричное сглаживание: набор медленный (масса), сброс чуть быстрее
        const up = 1 - Math.exp(-14 * dt)
        const down = 1 - Math.exp(-20 * dt)
        for (const a of ['f', 'r', 'u']) {
            const t = raw[a]
            keySmooth[a] += (t - keySmooth[a]) * (Math.abs(t) > Math.abs(keySmooth[a]) ? up : down)
            if (Math.abs(keySmooth[a]) < 1e-4) keySmooth[a] = 0
        }
        boost = sticky.boost || externalInput.boost === true
        // Space = точный режим. Ctrl НЕ используем: Ctrl+W и т.п. — это шорткаты браузера,
        // игрок просто потеряет вкладку, когда захочет подлететь медленнее.
        fine = sticky.fine || externalInput.fine === true

        // «игрок повёл корабль сам» — сообщить один раз за жест
        if (raw.f || raw.r || raw.u) noteUserMove()
        else moveNotified = false
    }

    function update(dtRaw) {
        // фаза 7: кламп dt поднят: экспоненциальный damp устойчив при любом dt,
        // а на медленных машинах (и software-GL) сглаживание теперь поспевает
        // за реальным временем вместо многократного отставания
        const dt = clamp(dtRaw, 0.0005, 0.25)
        if (paused) return api

        if (locked) {
            keySmooth.f = keySmooth.r = keySmooth.u = 0; boost = fine = false
            // но нажатие клавиш движения во время перелёта — сигнал «игрок хочет
            // управлять сам»: шлём userMove (подписчик отменит перелёт/закроет карточку)
            if (keys.has('KeyW') || keys.has('KeyA') || keys.has('KeyS') || keys.has('KeyD') ||
                keys.has('KeyQ') || keys.has('KeyE') || keys.has('ArrowUp') || keys.has('ArrowDown') ||
                keys.has('ArrowLeft') || keys.has('ArrowRight')) noteUserMove()
            else moveNotified = false
        }
        else readInput(dt)

        /* 1. субъект: компенсируем его собственное движение, иначе объект «уедет» из-под камеры */
        if (subject) {
            subject.getWorldPosition(subjectPos)
            _v3.subVectors(subjectPos, subjectPrev)
            subjectPrev.copy(subjectPos)
            focusTarget.add(_v3)     // работает и во время flyTo → летим за движущейся планетой
        }

        if (!locked) {
            const r = rect()
            const H = Math.max(r.height, 1)
            const vFov = (camera.fov * Math.PI) / 180
            const ct = Math.cos(sphTarget.theta), st = Math.sin(sphTarget.theta)

            /* 2. орбита: «взялся за небо и тянешь» — масштаб привязан к FOV, а не к пикселям */
            if (rotInput.x || rotInput.y) {
                const k = (vFov / H) * o.rotateSpeed
                sphTarget.theta = wrapAngle(sphTarget.theta - rotInput.x * k)
                sphTarget.phi = clamp(sphTarget.phi - (o.invertY ? -1 : 1) * rotInput.y * k, o.phiMin, o.phiMax)
                rotInput.x = rotInput.y = 0
            }

            /* 3. панорамирование: берём НАСТОЯЩИЕ экранные оси камеры, поэтому
               правый драг корректен при любом наклоне (включая вид «сверху вниз») */
            if (panInput.x || panInput.y) {
                _sph.set(1, sphTarget.phi, sphTarget.theta)
                _off.setFromSpherical(_sph)                 // focus → camera
                _m4.lookAt(_off, _v3.set(0, 0, 0), _up)     // матрица ориентации камеры
                const right = _right.setFromMatrixColumn(_m4, 0)
                const camUp = _v3.setFromMatrixColumn(_m4, 1)
                // сколько мировых юнитов в одном пикселе на текущей глубине
                const worldPerPx = o.panScaleWithDist
                    ? (2 * Math.tan(vFov / 2) * sphTarget.dist) / H
                    : 1 / H
                focusTarget
                    .addScaledVector(right, -panInput.x * worldPerPx)
                    .addScaledVector(camUp, panInput.y * worldPerPx)
                panInput.x = panInput.y = 0
            }

            /* 4. полёт WASD: скорость растёт вместе с дистанцией (см. пункт 2 в шапке) */
            const auto = o.baseSpeed * Math.pow(Math.max(sphTarget.dist, o.minDist), o.speedPower)
            speedMulSmooth.v = damp(speedMulSmooth.v, speedMul, 0.25, dt)
            const mul = speedMulSmooth.v * (boost ? o.boostMul : 1) * (fine ? o.fineMul : 1)
            const speed = auto * mul

            _fwd.set(-st, 0, -ct)      // горизонтальная проекция направления взгляда
            _right.set(ct, 0, -st)     // = fwd × up
            desiredVel.set(0, 0, 0)
                .addScaledVector(_fwd, keySmooth.f)
                .addScaledVector(_right, keySmooth.r)
                .addScaledVector(_up, keySmooth.u)
                .multiplyScalar(speed)

            const lam = desiredVel.lengthSq() > 1e-12 ? o.linearAccel : o.linearDamp
            vel.lerp(desiredVel, 1 - Math.exp(-lam * dt))
            if (vel.lengthSq() < 1e-12) vel.set(0, 0, 0)
        } else {
            vel.multiplyScalar(Math.exp(-9 * dt))
        }

        /* 4.5 фаза 10: в 2D-плане наклон принудительно сверху.
           theta НЕ трогаем: иначе вход в план закручивал карту каруселью.
           фаза 11: up камеры в плане = -Z (иначе up ∥ оси взгляда и кадр
           «рвёт» от численного шума lookAt — те самые «4 части и крутится»). */
        if (mode2d) sphTarget.phi = 0.035
        _up.set(0, mode2d ? 0 : 1, mode2d ? -1 : 0)
        camera.up.copy(_up)

        /* 5. интеграция + сглаживание всех каналов (кадронезависимо) */
        focusTarget.addScaledVector(vel, dt)
        applyBounds(focusTarget)
        if (!flightTween) dampVec3(focus, focusTarget, o.followLambda, dt)
        sph.dist = clamp(damp(sph.dist, sphTarget.dist, o.zoomLambda, dt), o.minDist, o.maxDist)
        sph.theta = wrapAngle(dampAngleLocal(sph.theta, sphTarget.theta, o.rotateLambda, dt))
        sph.phi = damp(sph.phi, sphTarget.phi, o.rotateLambda, dt)

        /* 6. камера, near/far, FOV, скайбокс */
        applyTransform(dt)

        /* 7. перебазировка */
        maybeRebase()

        fpsSma.push(1 / dt)
        emit('update', telemetry())
        return api
    }

    /** Зажимаем точку фокуса внутрь цилиндра границы мира. */
    function applyBounds(v) {
        const b = o.bounds
        if (!b) return
        if (b.height != null) v.y = clamp(v.y, -b.height, b.height)
        if (b.radius != null) {
            const r = Math.hypot(v.x, v.z)
            if (r > b.radius) {
                const k = b.radius / r
                v.x *= k; v.z *= k
            }
        }
    }

    const dampAngleLocal = (cur, tgt, lam, dt) => cur + angleDelta(cur, tgt) * (1 - Math.pow(1 - Math.min(lam, 1 - 1e-6), dt * 60))

    function applyTransform(dt) {
        _sph.set(sph.dist, sph.phi, sph.theta)
        _off.setFromSpherical(_sph)
        camera.position.copy(focus).add(_off)
        // фаза 5: камера тоже не выходит за границу секторов (баг: облёт ПКМ
        // уносил её за кольцо, и WASD упирался в кламп фокуса — «нельзя двигаться»)
        if (o.bounds) {
            const ux = camera.position.x + originShift.x
            const uz = camera.position.z + originShift.z
            const rr = Math.hypot(ux, uz)
            if (rr > o.bounds.radius) {
                const k = o.bounds.radius / rr
                camera.position.x = ux * k - originShift.x
                camera.position.z = uz * k - originShift.z
            }
        }
        camera.up.set(0, 1, 0)
        // фаза 4: плавное смещение точки прицела вправо по экрану — выбранный
        // объект виден левее центра и не прячется под карточкой информации
        offCur += (o.focusOffset - offCur) * Math.min(1, dt * 5)
        if (offCur > 1e-4) {
            const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * camera.aspect
            _aimRight.set(1, 0, 0).applyQuaternion(camera.quaternion)
            // quaternion ещё от прошлого кадра — для смещения в пару % этого достаточно
            _aim.copy(focus).addScaledVector(_aimRight, offCur * tanH * sph.dist)
            camera.lookAt(_aim)
        } else {
            camera.lookAt(focus)
        }

        // динамические near/far
        const d = Math.max(sph.dist, o.minDist)
        const near = clamp(d * o.nearScale, o.nearMin, o.nearMax)
        const far = clamp(d * o.farScale, o.farMin, o.farMax)
        if (Math.abs(camera.near - near) > near * 0.02 || Math.abs(camera.far - far) > far * 0.02) {
            camera.near = near; camera.far = far
            camera.updateProjectionMatrix()
        }

        // рывок FOV на ускорителе
        const wantFov = o.fovBase + (boost && vel.lengthSq() > 1e-8 ? o.fovBoost : 0)
        const nf = damp(fovCur, wantFov, o.fovLambda, dt)
        if (Math.abs(nf - fovCur) > 1e-3) {
            fovCur = nf; camera.fov = nf; camera.updateProjectionMatrix()
        }

        // координаты «вселенной» — по ним карта считает LOD, подписи и пикинг
        camUniverse.copy(camera.position).add(originShift)
        focusUniverse.copy(focus).add(originShift)

        // скайбокс держится у камеры и масштабируется под текущий far,
        // чтобы панорама не обрезалась ближней/дальней плоскостью
        if (o.skybox) {
            if (worldRoot && o.skybox.parent === worldRoot) {
                o.skybox.position.copy(camera.position).sub(worldRoot.position)
            } else {
                o.skybox.position.copy(camera.position)
            }
            if (o.skyboxLocalOffset) o.skybox.position.add(o.skyboxLocalOffset)
            const want = camera.far * 0.4
            if (o.skybox.userData.baseScale == null) o.skybox.userData.baseScale = o.skybox.scale.x
            const k = want / Math.max(o.skybox.userData.baseScale, 1e-6)
            o.skybox.scale.setScalar(o.skybox.userData.baseScale * clamp(k, 0.0001, 1e6))
        }
    }

    /* ═══════════ floating origin ═══════════
       ДВА пространства координат:
         • «вселенная» (universe) — авторитетные данные карты. JS Number = float64,
           точность не теряется никогда. В них хранятся sys.pos, закладки, ORIGIN.
         • «рендер» (render) — то, что видит GPU (float32). Камера и rig.focus живут
           здесь и держатся около нуля.
       Связь:  render = universe − originShift.
       worldRoot.position = −originShift, поэтому ЛОКАЛЬНЫЕ координаты детей
       worldRoot — это координаты вселенной, и их при перебазировке трогать НЕ НАДО
       (прежняя версия траверсила мир и портила данные карты).                       */
    const originShift = new THREE.Vector3()
    const camUniverse = new THREE.Vector3()
    const focusUniverse = new THREE.Vector3()

    /** universe → render (для flyTo/постановки камеры). Возвращает НОВЫЙ вектор. */
    const toRender = (v) => new THREE.Vector3().copy(v).sub(originShift)
    /** render → universe. Возвращает НОВЫЙ вектор. */
    const toUniverse = (v) => new THREE.Vector3().copy(v).add(originShift)

    function maybeRebase() {
        if (!o.rebaseThreshold || !worldRoot) return
        if (focus.length() < o.rebaseThreshold) return

        const d = focus.clone()
        // мир уезжает на −d, камера/фокус на −d → относительная картинка не меняется
        worldRoot.position.sub(d)
        worldRoot.updateMatrixWorld(true)
        originShift.add(d)
        focus.sub(d); focusTarget.sub(d); home.focus.sub(d)
        if (subject) subjectPrev.sub(d)
        if (flightFrom) flightFrom.focus.sub(d)

        rebaseCount++
        emit('rebase', { shift: d, originShift: originShift.clone(), count: rebaseCount })
    }

    /* ═══════════ телеметрия ═══════════ */
    function telemetry() {
        return {
            fps: fpsSma.value,
            dist: sph.dist,
            speed: vel.length(),
            focus, cameraPos: camera.position,
            near: camera.near, far: camera.far, fov: camera.fov,
            speedMul, boost, fine, locked,
            following: !!subject,
            rebases: rebaseCount,
            theta: sph.theta, phi: sph.phi,
            flying: !!flightTween,
        }
    }

    /* ═══════════ подключение ═══════════ */
    function attach() {
        domElement.addEventListener('pointerdown', onPointerDown)
        domElement.addEventListener('pointermove', onPointerMove)
        domElement.addEventListener('pointerup', onPointerUp)
        domElement.addEventListener('pointercancel', onPointerUp)
        domElement.addEventListener('lostpointercapture', onPointerUp)
        domElement.addEventListener('wheel', onWheel, { passive: false })
        domElement.addEventListener('contextmenu', onContextMenu)
        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('keyup', onKeyUp)
        window.addEventListener('blur', onBlur)
        domElement.style.touchAction = 'none'
    }

    function dispose() {
        domElement.removeEventListener('pointerdown', onPointerDown)
        domElement.removeEventListener('pointermove', onPointerMove)
        domElement.removeEventListener('pointerup', onPointerUp)
        domElement.removeEventListener('pointercancel', onPointerUp)
        domElement.removeEventListener('lostpointercapture', onPointerUp)
        domElement.removeEventListener('wheel', onWheel)
        domElement.removeEventListener('contextmenu', onContextMenu)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
        window.removeEventListener('blur', onBlur)
        cancelFlight()
        listeners.clear()
    }

    const api = {
        camera, options: o, worldRoot,
        focus, focusTarget, sph, sphTarget, home, vel,
        update, attach, dispose, setState,
        flyTo, cancelFlight, frameObject, followObject, releaseSubject,
        flyHome, setHome, orbitBy, setSkybox, setBounds,
        setFocusOffset: (v) => { o.focusOffset = +v || 0 },
        setLocked, setPaused, suppressPointer, isDragging, lastGestureWasDrag,
        setSpeedMultiplier, setSpeedStep, stepSpeed,
        originShift, camUniverse, focusUniverse, toRender, toUniverse,
        getSpeedMultiplier: () => speedMul,
        getSpeedStep: () => Math.round(Math.log(speedMul) / Math.log(SPEED_STEP)),
        setExternalInput: (v) => {
            externalInput = v || { f: 0, r: 0, u: 0 }
            if (externalInput.f || externalInput.r || externalInput.u) noteUserMove()
            else moveNotified = false
        },
        on, onRebase, telemetry, toggleFine, toggleBoost, setMode2D,
        get flying() { return !!flightTween },
        get mode2d() { return mode2d },
        get fineOn() { return sticky.fine },
        get boostOn() { return sticky.boost },
        get dist() { return sph.dist },
        get isFlying() { return !!flightTween },
        get isLocked() { return locked },
        get isBoost() { return boost },
        get isFine() { return fine },
        get subject() { return subject },
        get rebases() { return rebaseCount },
    }

    attach()
    applyTransform(0.016)
    setHome()
    return api
}
