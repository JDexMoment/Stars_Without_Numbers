import * as THREE from 'three'
import { clamp } from './rigMath.js'

/**
 * objectUse.js — модуль «взял объект в руки».
 *
 * ВАЖНО: после появления cameraRig.js этот модуль БОЛЬШЕ НЕ ДВИГАЕТ КАМЕРУ
 * НАПРЯМУЮ (никаких gsap.to(camera.position) и controls.target). Он командует
 * ригом: rig.flyTo / rig.followObject / rig.releaseSubject / rig.orbitBy.
 * Благодаря этому «подлёт к объекту» и «свободный полёт» — одна и та же
 * физика, без рывков и без конфликта двух контроллеров.
 *
 * Что осталось за модулем:
 *   • выбор объекта (пикинг) и карточка с данными;
 *   • вращение объекта левой кнопкой (как было);
 *   • вращение камеры вокруг объекта правой кнопкой → теперь через rig.orbitBy;
 *   • слежение за движущимся объектом → rig.followObject (компенсация орбиты);
 *   • возврат камеры на место → rig.flyTo;
 *   • реестр анимируемых объектов (вращение/орбиты) вместо scene.traverse
 *     на каждый кадр — traverse по 2500+ объектов это лишние миллисекунды.
 */

/* ══════════════════ утилиты (сохранены для совместимости) ══════════════════ */

export function createOrbitRing(radius, x = 0, y = 0, z = 0, color = 0xffffff) {
    const geometry = new THREE.RingGeometry(radius - 0.02, radius + 0.02, 64)
    const material = new THREE.MeshBasicMaterial({
        color, side: THREE.DoubleSide, transparent: true, opacity: 0.3,
    })
    const ring = new THREE.Mesh(geometry, material)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(x, y, z)
    ring.userData.clickable = false
    ring.userData.noPick = true
    return ring
}

export function setOrbitPosition(object, x, y, z) {
    const orbit = object.userData.orbit
    if (!orbit) { console.warn('У объекта нет данных об орбите!'); return }
    const centerX = orbit.center ? orbit.center.x : 0
    const centerZ = orbit.center ? orbit.center.z : 0
    orbit.angle = Math.atan2(z - centerZ, x - centerX)
    object.position.set(x, y, z)
}

/* ══════════════════ стили карточки и кнопки ══════════════════
   Стиль «имперской картографии»: глубокий тёмно-синий пергамент, латунные
   волоски, срезанные углы (clip-path), капительные заголовки с разрядкой,
   пунктирные выноски у статистики. Никаких скруглённых неоновых «pill». */
const UI_CSS = `
:root {
    --ou-brass: #d9b364;
    --ou-brass-dim: rgba(217,179,100,.38);
    --ou-brass-faint: rgba(217,179,100,.16);
    --ou-ink: #e9dfc8;
    --ou-ink-dim: #9a8f76;
    --ou-panel: rgba(7,11,22,.92);
    --ou-bevel: polygon(14px 0, 100% 0, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%, 0 14px);
    --ou-mono: ui-monospace, Menlo, Consolas, monospace;
    --ou-serif: Georgia, 'Times New Roman', serif;
}
.ou-close {
    position: fixed; top: 18px; right: 18px; z-index: 1000;
    width: 40px; height: 40px;
    clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
    background: var(--ou-panel); color: var(--ou-brass);
    border: 1px solid var(--ou-brass-dim); font-size: 17px; line-height: 1;
    cursor: pointer; display: none; align-items: center; justify-content: center;
    font-family: var(--ou-mono);
}
.ou-close:hover { background: var(--ou-brass); color: #0a0e1a; }
.ou-card {
    position: fixed; top: 70px; right: 18px; z-index: 999; width: min(340px, calc(100vw - 36px));
    background: var(--ou-panel); border: 1px solid var(--ou-brass-dim);
    clip-path: var(--ou-bevel);
    padding: 16px 18px 14px; display: none;
    color: var(--ou-ink); font-family: var(--ou-mono); font-size: 11.5px;
    max-height: min(64vh, 560px); overflow: auto;
}
/* двойная рамка-паспарту */
.ou-card::before {
    content: ''; position: absolute; inset: 4px; pointer-events: none;
    border: 1px solid var(--ou-brass-faint);
    clip-path: polygon(11px 0, 100% 0, 100% calc(100% - 11px), calc(100% - 11px) 100%, 0 100%, 0 11px);
}
.ou-head { display: flex; align-items: flex-start; gap: 10px; padding-bottom: 10px;
    border-bottom: 3px double var(--ou-brass-dim); margin-bottom: 10px; }
.ou-title { flex: 1; min-width: 0; }
.ou-card h3 { margin: 0; font-family: var(--ou-serif); font-size: 19px; font-weight: 600;
    color: var(--ou-brass); letter-spacing: .06em; overflow-wrap: break-word; }
.ou-card .sub { margin-top: 4px; font-size: 9px; letter-spacing: .22em; text-transform: uppercase;
    color: var(--ou-ink-dim); }
.ou-stats { display: flex; flex-direction: column; gap: 5px; }
.ou-stats .stat { display: flex; align-items: baseline; gap: 8px; font-size: 11px; }
.ou-stats .stat b { font-weight: 400; color: var(--ou-ink-dim); letter-spacing: .12em;
    text-transform: uppercase; font-size: 9.5px; white-space: nowrap; }
.ou-stats .stat i { flex: 1; border-bottom: 1px dotted var(--ou-brass-dim); transform: translateY(-3px); }
.ou-stats .stat span { color: var(--ou-ink); text-align: right; }
.ou-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
.ou-tags .tagchip { font-size: 9px; letter-spacing: .14em; text-transform: uppercase;
    color: var(--ou-brass); border: 1px solid var(--ou-brass-dim); padding: 3px 8px;
    clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px); }
.ou-tags .tagchip.dim { color: var(--ou-ink-dim); border-color: rgba(154,143,118,.3); }
.ou-planets { list-style: none; margin: 12px 0 0; padding: 10px 0 0; border-top: 1px solid var(--ou-brass-faint); }
.ou-planets li { display: flex; align-items: baseline; gap: 8px; padding: 3px 0; font-size: 11px; }
.ou-planets .chip { width: 8px; height: 8px; flex: none; transform: rotate(45deg) translateY(-1px); }
.ou-planets b { color: var(--ou-ink); font-weight: 600; }
.ou-planets em { margin-left: auto; color: var(--ou-ink-dim); font-style: normal; font-size: 10px; text-align: right; }
.ou-note { margin-top: 11px; padding: 9px 11px; font-size: 10.5px; line-height: 1.55;
    color: var(--ou-ink-dim); background: rgba(217,179,100,.05); border-left: 2px solid var(--ou-brass-dim); }
.ou-note code { color: var(--ou-brass); font-size: 10px; }
.ou-note pre { margin: 8px 0 0; padding: 9px 10px; overflow-x: auto; white-space: pre;
    font-family: var(--ou-mono); font-size: 10px; line-height: 1.55; color: var(--ou-ink);
    background: rgba(4,7,15,.75); border: 1px solid var(--ou-brass-faint); }
.ou-dist { margin-top: 10px; font-size: 9px; letter-spacing: .18em; text-transform: uppercase;
    color: var(--ou-ink-dim); text-align: right; }
.ou-card .acts { display: flex; gap: 6px; margin-top: 12px; }
.ou-card .acts button {
    flex: 1; padding: 8px 4px; font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase;
    font-family: var(--ou-mono); color: var(--ou-brass); background: transparent;
    border: 1px solid var(--ou-brass-dim); cursor: pointer;
    clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px);
}
.ou-card .acts button:hover { background: var(--ou-brass); color: #0a0e1a; }
.ou-hint {
    position: fixed; left: 50%; bottom: 152px; transform: translateX(-50%); z-index: 998;
    font-family: var(--ou-mono); font-size: 10px; letter-spacing: .14em;
    color: rgba(233,223,200,.5); text-transform: uppercase; pointer-events: none;
    opacity: 0; transition: opacity .4s; white-space: nowrap; max-width: 96vw;
    overflow: hidden; text-overflow: ellipsis;
}
.ou-hint.on { opacity: 1; }
/* переключатель режима ЖИВЁТ ВНУТРИ КАРТОЧКИ — закрылась карточка, исчез и он */
.ou-mode {
    flex: none; display: none; align-items: center; gap: 6px; padding: 6px 9px;
    background: transparent; color: var(--ou-ink-dim); border: 1px solid var(--ou-brass-dim);
    font-family: var(--ou-mono); font-size: 9px; letter-spacing: .1em; text-transform: uppercase;
    cursor: pointer; clip-path: polygon(6px 0, 100% 0, 100% calc(100% - 6px), calc(100% - 6px) 100%, 0 100%, 0 6px);
}
.ou-mode span { font-size: 13px; color: var(--ou-brass); }
.ou-mode.cam { background: var(--ou-brass); color: #0a0e1a; border-color: transparent; }
.ou-mode.cam span { color: #0a0e1a; }
@media (max-width: 900px) {
    .ou-close { top: 10px; right: 10px; width: 36px; height: 36px; font-size: 15px; }
    .ou-card { top: 54px; right: 10px; left: 10px; width: auto; max-height: 42vh; }
    .ou-hint { bottom: 152px; font-size: 9px; letter-spacing: .05em; }
}
`

/* ══════════════════ основной модуль ══════════════════ */

/**
 * @param {THREE.Scene}    scene
 * @param {object}         rig      камера-риг (createCameraRig)
 * @param {object}        [opts]
 *   opts.pick(e)          → { object, system?, planet?, ... } | null   (свой пикер)
 *   opts.describe(hit)    → { title, subtitle, rows:[[k,v],...] }      (карточка)
 *   opts.domElement       элемент для событий (по умолчанию renderer.domElement)
 *   opts.freezeRotations  останавливать вращение объектов при осмотре (default true)
 *   opts.approach         { theta, phi, pad } — с какой стороны подлетать
 */
export function createObjectInteractor(scene, rig, opts = {}) {
    const dom = opts.domElement || rig.camera && document.querySelector('canvas') || window
    const approach = Object.assign({ theta: Math.PI / 2, phi: Math.PI / 2.35, pad: 2.4 }, opts.approach || {})
    const freezeRotations = opts.freezeRotations !== false

    /* ---------- реестр анимируемых объектов (вместо scene.traverse) ---------- */
    const animated = []
    const seen = new Set()
    function registerAnimated(obj) {
        if (!obj || seen.has(obj)) return obj
        seen.add(obj); animated.push(obj)
        return obj
    }
    function unregisterAnimated(obj) {
        const i = animated.indexOf(obj)
        if (i >= 0) { animated.splice(i, 1); seen.delete(obj) }
    }
    /** Пройтись по дереву и зарегистрировать всё анимируемое. Звать после загрузки моделей. */
    function scanAnimated(root = scene) {
        root.traverse((o) => {
            if (o.userData && (o.userData.rotationSpeed || o.userData.orbit)) registerAnimated(o)
        })
    }

    /* ---------- состояние ---------- */
    let selected = null            // выбранный Object3D
    let selectedHit = null         // результат пикера (system/planet/...)
    let focusObj = null            // во что реально целимся (может быть «ядром» группы)
    let state = 'IDLE'             // IDLE | FLYING_TO | FOLLOWING | FLYING_BACK
    let rotBefore = null
    let saved = null               // { focus, dist, theta, phi } — куда возвращаться
    let draggingObject = false
    let orbitingCamera = false
    let downAt = { x: 0, y: 0, t: 0, button: -1, id: null }
    let last = { x: 0, y: 0 }
    let hintTimer = 0
    let mode = 'object'            // 'object' = ЛКМ/1 палец крутит объект, 'camera' = облёт камерой

    /* ---------- UI ---------- */
    const style = document.createElement('style')
    style.textContent = UI_CSS
    document.head.appendChild(style)

    const closeBtn = document.createElement('button')
    closeBtn.className = 'ou-close'
    closeBtn.innerHTML = '✕'
    closeBtn.title = 'Закрыть (Esc)'
    document.body.appendChild(closeBtn)

    const card = document.createElement('div')
    card.className = 'ou-card'
    document.body.appendChild(card)

    const hint = document.createElement('div')
    hint.className = 'ou-hint'
    document.body.appendChild(hint)

    // фаза 4: кнопка-переключатель «объект/камера» УБРАНА по решению пользователя —
    // режимы и так переключаются кнопками мыши: ЛКМ крутит объект, ПКМ облетает
    // камерой. Подсказка-чип осталась: показывается на время операции.
    function syncMode() {
        hint.textContent = mode === 'object'
            ? 'ЛКМ/палец — крутить объект · ПКМ — облёт камерой · WASD — полёт вокруг'
            : 'ЛКМ/палец — облёт камерой · колесо/пинч — зум · WASD — полёт вокруг'
    }

    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

    function showCard(hit) {
        const info = opts.describe ? opts.describe(hit) : null
        if (!info) { card.style.display = 'none'; return }
        // формат: { name/title, sub/subtitle, stats:[[k,v]…]|rows, tags?, planets?, hint?, distanceText? }
        const title = info.title ?? info.name ?? ''
        const sub = info.subtitle ?? info.sub ?? ''
        const stats = info.stats || info.rows || []
        card.innerHTML =
            '<div class="ou-head"><div class="ou-title"><h3></h3><div class="sub"></div></div></div>' +
            '<div class="ou-stats">' +
            stats.map(() => '<span class="stat"><b></b><i></i><span></span></span>').join('') +
            '</div>' +
            (info.tags ? '<div class="ou-tags">' + info.tags + '</div>' : '') +
            (info.planets ? '<ul class="ou-planets">' + info.planets + '</ul>' : '') +
            (info.hint ? '<div class="ou-note">' + info.hint + '</div>' : '') +
            '<div class="acts">' +
            '<button data-a="frame">Вписать</button>' +
            '<button data-a="closer">Ближе</button>' +
            '<button data-a="top">Сверху</button>' +
            '</div>' +
            (info.distanceText ? '<div class="ou-dist">дистанция · ' + esc(info.distanceText) + '</div>' : '')
        card.querySelector('h3').textContent = title
        card.querySelector('.sub').textContent = sub
        const rowEls = card.querySelectorAll('.stat')
        stats.forEach((r, i) => {
            rowEls[i].querySelector('b').textContent = r[0]
            rowEls[i].querySelector('span').textContent = r[1]
        })
        card.style.display = 'block'
    }

    card.addEventListener('click', (e) => {
        const b = e.target.closest('button')
        if (!b || !selected) return
        if (b.dataset.a === 'frame') rig.frameObject(selected, { pad: approach.pad })
        if (b.dataset.a === 'closer') rig.flyTo({ dist: Math.max(rig.dist * 0.45, rig.options.minDist), duration: 0.9, subject: selected })
        if (b.dataset.a === 'top') rig.flyTo({ phi: 0.35, duration: 1.1, subject: selected })
        e.stopPropagation()
    })

    /* ---------- вспомогательное ---------- */
    function focusTargetOf(obj) {
        // если внутри есть специально помеченный меш (как «ядро» чёрной дыры) — целимся в него
        let target = obj
        if (obj.traverse) {
            obj.traverse((c) => { if (c.isMesh && c.userData.cameraFocus === true) target = c })
        }
        return target
    }

    function radiusOf(obj) {
        const sphere = new THREE.Sphere()
        new THREE.Box3().setFromObject(obj).getBoundingSphere(sphere)
        return Math.max(sphere.radius, 0.35)
    }

    function isUI(el) {
        return !!el && !!(el.closest?.('.ou-card') || el.closest?.('.ou-close') || el.closest?.('.rig-hud') || el.closest?.('.app-ui'))
    }

    function saveCameraState() {
        saved = {
            focus: rig.focus.clone(),
            dist: rig.dist,
            theta: rig.sph.theta,
            phi: rig.sph.phi,
        }
    }

    /* ---------- выбор объекта ---------- */
    function selectAt(clientX, clientY) {
        if (!opts.pick) return false
        const hit = opts.pick(clientX, clientY)
        if (!hit || !hit.object) return false

        const obj = hit.object
        if (selected === obj && (state === 'FLYING_TO' || state === 'FOLLOWING')) return true

        if (selected && selected !== obj) resetObjectRotation(selected)

        selected = obj
        selectedHit = hit
        saveCameraState()
        rotBefore = captureRotations(obj)

        focusObj = focusTargetOf(obj)
        // пикер может сообщить радиус сам (у узлов карты нет геометрии для Box3)
        const r = hit.radius ?? radiusOf(focusObj)
        // фаза 5: клик по системе/звезде (не по планете) — камера вписывает всю
        // систему до внешней орбиты; span считает buildSystem в chartMap
        const isSystem = !!(hit.entry && !hit.planet)
        const dist = isSystem
            ? clamp((hit.entry.span || r * 6) * 2.4, rig.options.minDist, rig.options.maxDist)
            : clamp(r * approach.pad, rig.options.minDist, rig.options.maxDist)
        // фаза 5: чем больше перепад масштаба, тем дольше перелёт — издалека
        // камера едет плавно, а не «прыгает» половину пути за пол-анимации
        const dur = Math.min(4.0, Math.max(1.2, 1.1 + Math.log10(Math.max(1, rig.dist / dist)) * 0.75))

        // ВАЖНО: state ставим ПОСЛЕ flyTo. flyTo внутри вызывает cancelFlight(),
        // который шлёт 'flightCancel' — обработчик не должен увидеть свежий FLYING_TO.
        rig.flyTo({
            dist,
            theta: approach.theta,
            phi: approach.phi,
            subject: focusObj,        // летим ЗА объектом: планета на орбите не «уедет»
            duration: opts.flyDuration ?? dur,
            onComplete: () => {
                state = 'FOLLOWING'
                rig.followObject(focusObj)   // компенсация движения орбиты
                rig.setLocked(false)         // вокруг объекта можно летать и дальше
                showHint()
            },
        })
        state = 'FLYING_TO'
        // фаза 4: объект встаёт левее центра экрана — карточка справа не перекрывает
        rig.setFocusOffset && rig.setFocusOffset(0.3)

        closeBtn.style.display = 'flex'
        showCard(hit)
        syncMode()
        document.body.classList.add('has-card')
        rig.setLocked(true)          // ввод пользователя off, но перелёт живёт
        rig.suppressPointer(400)
        return true
    }

    function showHint() {
        hint.classList.add('on')
        clearTimeout(hintTimer)
        hintTimer = setTimeout(() => hint.classList.remove('on'), 4200)
    }

    /* ---------- снятие выбора / возврат ---------- */
    function deselect({ flyBack = true } = {}) {
        if (!selected) return
        hint.classList.remove('on')
        rig.setFocusOffset && rig.setFocusOffset(0)   // фаза 4: возврат прицела в центр
        closeBtn.style.display = 'none'
        card.style.display = 'none'
        syncMode()
        document.body.classList.remove('has-card')
        resetObjectRotation(selected)

        const prev = selected
        selected = null
        selectedHit = null
        focusObj = null

        if (flyBack && saved) {
            state = 'FLYING_BACK'
            rig.setLocked(true)
            rig.releaseSubject()
            rig.flyTo({
                position: saved.focus,
                dist: saved.dist,
                theta: saved.theta,
                phi: saved.phi,
                subject: null,
                duration: opts.backDuration ?? 1.4,
                onComplete: () => { state = 'IDLE'; rig.setLocked(false) },
            })
        } else {
            rig.releaseSubject()
            state = 'IDLE'
            rig.setLocked(false)
        }
        void prev
    }

    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); deselect() })

    // Перелёт прерван пользователем (драг/колесо). Объект уже выбран и субъект
    // назначен — значит логично сразу начать слежение, а не висеть в FLYING_TO.
    rig.on('flightCancel', () => {
        if (state === 'FLYING_TO' && selected && focusObj) {
            state = 'FOLLOWING'
            rig.followObject(focusObj)
            rig.setLocked(false)
        }
    })

    // Игрок сам повёл корабль (WASD/QE, колесо, джойстик) — карточка закрывается,
    // перелёт отменяется, управление возвращается немедленно (без возврата назад).
    rig.on('userMove', () => {
        if (!selected) return
        rig.cancelFlight()
        deselect({ flyBack: false })
    })

    /* ---------- вращение объекта ---------- */
    function captureRotations(obj) {
        const list = []
        if (obj.userData?.lockRotation !== true && obj.isObject3D) list.push({ o: obj, r: obj.rotation.clone() })
        obj.traverse?.((c) => {
            if (c.isMesh && c.userData?.lockRotation !== true) list.push({ o: c, r: c.rotation.clone() })
        })
        return list
    }

    function resetObjectRotation(obj) {
        const gsap = typeof window !== 'undefined' ? window.gsap : null
        if (!obj || !rotBefore || !gsap) { rotBefore = null; return }
        for (const item of rotBefore) {
            gsap.to(item.o.rotation, {
                duration: 1.1, x: item.r.x, y: item.r.y, z: item.r.z, ease: 'power2.inOut', overwrite: true,
            })
        }
        rotBefore = null
    }

    function rotateObject(obj, dx, dy) {
        if (!obj || obj.userData?.lockRotation === true) {
            // заблокированный объект (например, аккреционный диск) крутим только по Y и только у разрешённых детей
        }
        const apply = (o) => {
            if (o.userData?.lockRotation === true) return
            o.rotation.y += dx * 0.005
            o.rotation.x += dy * 0.005
        }
        if (obj.children && obj.children.length > 0) obj.traverse((c) => { if (c.isMesh) apply(c) })
        else apply(obj)
    }

    /* ---------- указатель ---------- */
    function onPointerDown(e) {
        if (isUI(e.target)) return
        if (e.target !== dom && dom !== window) return
        downAt = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button, id: e.pointerId, type: e.pointerType }
        last.x = e.clientX; last.y = e.clientY

        if (!selected) return
        if (state !== 'FOLLOWING') return

        // ЛКМ (или палец) — действие зависит от режима; ПКМ — всегда облёт камерой
        const wantOrbit = e.button === 2 || (e.button === 0 && mode === 'camera')
        const wantRotate = e.button === 0 && mode === 'object'

        if (wantRotate) {
            draggingObject = true
            rig.cancelFlight()           // пользователь взял управление — перелёт не нужен
            rig.setLocked(true)          // пока крутим объект — камера стоит
            rig.suppressPointer(1e9)     // и риг не перехватывает этот указатель
            try { dom.setPointerCapture?.(e.pointerId) } catch (_) {}
        } else if (wantOrbit) {
            orbitingCamera = true
            rig.cancelFlight()
            rig.setLocked(true)          // сами ведём углы, чтобы не было двойного управления
            rig.suppressPointer(1e9)
            try { dom.setPointerCapture?.(e.pointerId) } catch (_) {}
            e.preventDefault()
        }
    }

    function onPointerMove(e) {
        if (!selected || e.pointerId !== downAt.id) return
        const dx = e.clientX - last.x
        const dy = e.clientY - last.y
        last.x = e.clientX; last.y = e.clientY

        if (draggingObject) rotateObject(selected, dx, dy)
        if (orbitingCamera) {
            // вращение камеры вокруг объекта — через риг, с его же сглаживанием и инерцией
            rig.orbitBy(-dx * 0.0052, -dy * 0.0052)
        }
    }

    function onPointerUp(e) {
        if (e.pointerId !== downAt.id) return
        try { dom.releasePointerCapture?.(e.pointerId) } catch (_) {}
        if (draggingObject) { draggingObject = false; rig.setLocked(false); rig.suppressPointer(0) }
        if (orbitingCamera) { orbitingCamera = false; rig.setLocked(false); rig.suppressPointer(0) }

        // короткий тап/клик по пустоте — снимаем выбор (на тачах это делает кнопка ✕)
        const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
        const dt = performance.now() - downAt.t
        if (selected && moved < 6 && dt < 500 && downAt.button === 0 && downAt.type !== 'touch' && !isUI(e.target)) {
            const hit = opts.pick ? opts.pick(e.clientX, e.clientY) : null
            if (!hit || hit.object !== selected) deselect({ flyBack: !hit })
        }
    }

    function onClick(e) {
        if (isUI(e.target)) return
        if (e.target !== dom && dom !== window) return
        if (state === 'FLYING_BACK') { rig.cancelFlight(); state = 'IDLE'; rig.setLocked(false) }
        if (draggingObject || orbitingCamera) return
        const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
        if (moved > 6) return                                  // это был драг — не клик
        if (performance.now() - downAt.t > 600) return
        if (e.button !== 0) return
        if (selected) return                                   // выход — по pointerup
        selectAt(e.clientX, e.clientY)
    }

    function onContextMenu(e) { if (selected) e.preventDefault() }

    function onKey(e) {
        if (e.code === 'Escape' && selected) { deselect(); e.preventDefault() }
    }

    dom.addEventListener('pointerdown', onPointerDown, true)
    dom.addEventListener('pointermove', onPointerMove, true)
    dom.addEventListener('pointerup', onPointerUp, true)
    dom.addEventListener('click', onClick, true)
    dom.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('keydown', onKey)

    /* ---------- анимация ---------- */
    const _orb = new THREE.Vector3()
    function update(dtRaw) {
        const dt = clamp(dtRaw, 0, 0.05)
        const k = dt * 60                                  // приводим «скорости на кадр» к 60 fps
        const frozen = freezeRotations && (state === 'FLYING_TO' || state === 'FLYING_BACK')

        for (let i = animated.length - 1; i >= 0; i--) {
            const o = animated[i]
            if (!o.parent && o !== scene) { unregisterAnimated(o); continue }   // объект удалён из сцены
            const ud = o.userData
            if (!frozen && ud.rotationSpeed) {
                o.rotation.y += (ud.rotationSpeed.y || 0) * k
                o.rotation.x += (ud.rotationSpeed.x || 0) * k
            }
            if (ud.orbit) {
                const orbit = ud.orbit
                orbit.angle += orbit.speed * k
                const c = orbit.center || _orb.set(0, 0, 0)
                o.position.set(
                    c.x + Math.cos(orbit.angle) * orbit.radius,
                    c.y,
                    c.z + Math.sin(orbit.angle) * orbit.radius,
                )
            }
        }
    }

    function dispose() {
        dom.removeEventListener('pointerdown', onPointerDown, true)
        dom.removeEventListener('pointermove', onPointerMove, true)
        dom.removeEventListener('pointerup', onPointerUp, true)
        dom.removeEventListener('click', onClick, true)
        dom.removeEventListener('contextmenu', onContextMenu)
        window.removeEventListener('keydown', onKey)
        style.remove(); closeBtn.remove(); card.remove(); hint.remove()
    }

    return {
        update, dispose, scanAnimated, registerAnimated, unregisterAnimated,
        selectAt, deselect, showCard,
        get mode() { return mode },
        get dragging() { return draggingObject || orbitingCamera },
        get savedState() { return saved },
        setMode(m) { mode = m === 'camera' ? 'camera' : 'object'; syncMode() },
        get selected() { return selected },
        get state() { return state },
        get hit() { return selectedHit },
    }
}
