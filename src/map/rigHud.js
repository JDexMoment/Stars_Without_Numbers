import { fmtUnits, fmtNum, clamp } from './rigMath.js'
import './rigHud.css'

/**
 * rigHud.js — интерфейс поверх cameraRig: спидометр, шкала скорости,
 * подсказка управления, закладки и виртуальный джойстик для телефона.
 *
 * Модуль полностью опционален: риг работает и без него.
 *
 *   const hud = createRigHud(rig, { bookmarks: [...], units })
 *   hud.setMode('СЛЕЖЕНИЕ')     // индикатор режима
 *   hud.dispose()
 */

const SPEED_STEP = Math.pow(10, 1 / 9)

export function createRigHud(rig, opts = {}) {
    const {
        bookmarks = [],
        units = null,
        touch = isTouchDevice(),
        showTelemetry = !touch,      // на телефоне телеметрию сворачиваем: мало места
        labels = {
            speed: 'Масштаб скорости',
            dist: 'Дистанция',
            vel: 'Скорость',
            pos: 'Фокус',
            boost: 'Ускоритель',
            fine: 'Точно',
            home: 'Галактика',
            help: 'Управление',
        },
    } = opts

    const root = document.createElement('div')
    root.className = 'rig-hud' + (touch ? ' touch' : '')
    root.innerHTML = `
        <div class="rig-bookmarks"></div>
        <div class="rig-mode" data-t="mode"></div>

        <div class="rig-speed pe">
            <div class="rig-speed-top">
                <span>${labels.speed}</span>
                <span class="rig-speed-val" data-t="mul">×1.00</span>
            </div>
            <input type="range" min="0" max="9" step="0.01" value="4.5" data-t="slider" aria-label="${labels.speed}">
            <div class="rig-speed-scale">
                <span>×0.1 ювелирно</span><span>×1</span><span>×10 галактика</span>
            </div>
            <div class="rig-speed-btns">
                <button class="rig-btn" data-act="fine">${labels.fine} · Space</button>
                <button class="rig-btn" data-act="boost">${labels.boost} · Shift</button>
                <button class="rig-btn" data-act="dim">План · 2D</button>
                <button class="rig-btn" data-act="home">${labels.home} · Home</button>
            </div>
        </div>

        <button class="rig-help-btn pe" data-act="help" title="${labels.help}">?</button>
        <div class="rig-help pe">
            <p class="rig-build">сборка: ${window.SWN_BUILD || 'dev'}</p>
            <h5>Мышь</h5>
            <p><span class="k">ЛКМ</span>вращение вокруг точки фокуса</p>
            <p><span class="k">ПКМ</span>панорамирование (Shift+ЛКМ — то же)</p>
            <p><span class="k">Колесо</span>зум — всегда в одинаковое число раз</p>
            <h5>Полёт</h5>
            <p><span class="k">W A S D</span>движение в плоскости взгляда</p>
            <p><span class="k">Q</span><span class="k">E</span>вниз / вверх</p>
            <p><span class="k">Shift</span>ускоритель ×8 — защёлка (вкл/выкл)</p>
            <p><span class="k">Space</span>точный режим ×0.12 — защёлка (вкл/выкл)</p>
            <h5>Скорость</h5>
            <p><span class="k">0…9</span><span class="k">[</span><span class="k">]</span>ручной множитель ×0.1…×10</p>
            <p class="note">Базовая скорость растёт вместе с дистанцией до точки
            фокуса, поэтому один и тот же W аккуратно ведёт корабль у планеты
            и пересекает галактику на большом масштабе.</p>
            <h5>План · 2D</h5>
            <p><span class="k">Кнопка</span>«План · 2D» — плоский чертёж галактики сверху:</p>
            <p class="note">Видны секторная сетка, квадраты систем с подписями и
            маршруты; при подлёте к системе проявляются волосяные орбиты и цветные
            точки планет на них. Переходы в план и обратно не крутят карту. Клик по маркеру —
            карточка объекта; кнопка «В 3D» вернёт объёмный вид к выбранному объекту.
            ЛКМ в плане — панорамирование, колесо — масштаб.</p>
            <h5>Прочее</h5>
            <p><span class="k">Home</span>вернуться в домашнюю точку</p>
            <p><span class="k">Клик</span>по звезде/планете — подлёт и карточка объекта</p>
        </div>

        <div class="rig-stick pe" data-t="stick" title="Стрейф влево/вправо"><div class="rig-knob" data-t="knob"></div></div>
        <div class="rig-alt pe">
            <button data-t="up" title="Вверх">▲</button>
            <button data-t="fwd" title="Полный вперёд">⇧</button>
            <button data-t="back" title="Задний ход">⇩</button>
            <button data-t="down" title="Вниз">▼</button>
        </div>
    `
    document.body.appendChild(root)

    const $ = (sel) => root.querySelector(sel)
    const t = (name) => root.querySelector(`[data-t="${name}"]`)

    /* ---------- закладки ---------- */
    const bmBox = $('.rig-bookmarks')
    bookmarks.forEach((b) => {
        const el = document.createElement('button')
        el.className = 'rig-bm'
        el.textContent = b.label
        el.title = b.hint || ''
        el.addEventListener('click', () => {
            if (b.action) b.action(rig)
            else rig.flyTo({ position: b.position, dist: b.dist, duration: b.duration ?? 2.0 })
        })
        bmBox.appendChild(el)
    })

    /* ---------- слайдер скорости ---------- */
    const slider = t('slider')
    slider.value = String(rig.getSpeedStep())
    let sliderBusy = false
    slider.addEventListener('input', () => {
        sliderBusy = true
        rig.setSpeedMultiplier(Math.pow(SPEED_STEP, parseFloat(slider.value)))
    })
    slider.addEventListener('change', () => { sliderBusy = false })
    rig.on('speed', (mul) => {
        if (!sliderBusy) slider.value = String(Math.log(mul) / Math.log(SPEED_STEP))
    })

    /* ---------- кнопки ---------- */
    const boostBtn = root.querySelector('[data-act="boost"]')
    const fineBtn = root.querySelector('[data-act="fine"]')
    root.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]')
        if (!btn) return
        const act = btn.dataset.act
        if (act === 'help') $('.rig-help').classList.toggle('open')
        if (act === 'dim') { opts.on2D && opts.on2D() }
        if (act === 'home') { opts.onHome && opts.onHome(); rig.flyHome() }
    })
    // удерживаемые кнопки (мышь и палец)
    const hold = (el, on, off) => {
        el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.classList.add('on'); on() })
        const stop = () => { el.classList.remove('on'); off?.() }
        el.addEventListener('pointerup', stop)
        el.addEventListener('pointerleave', stop)
        el.addEventListener('pointercancel', stop)
    }
    // фаза 8: кнопки — защёлки (вкл/выкл по нажатию), синхронны с клавишами
    fineBtn.addEventListener('click', () => rig.toggleFine())
    boostBtn.addEventListener('click', () => rig.toggleBoost())
    rig.on('sticky', (st) => {
        fineBtn.classList.toggle('on', !!st.fine)
        boostBtn.classList.toggle('on', !!st.boost)
    })
    let touchFlags = { boost: false, fine: false }
    const touchBoost = (v) => { touchFlags.boost = v; pushStick() }
    const touchFine = (v) => { touchFlags.fine = v; pushStick() }

    /* ---------- виртуальные тач-контролы ----------
       Схема «как в космос-симах»: большой палец слева — стрейф (влево/вправо),
       справа — тяга (вперёд/назад) и высота (вверх/вниз). Так телефон можно
       держать двумя руками и летать аккуратно даже у поверхности планеты. */
    const stick = t('stick')
    const knob = t('knob')
    const axes = { fwd: 0, back: 0, up: 0, down: 0 }
    let stickX = 0
    let stickId = null
    const R = 46

    const pushStick = () => {
        rig.setExternalInput({
            f: axes.fwd - axes.back,
            r: stickX,
            u: axes.up - axes.down,
            boost: touchFlags.boost,
            fine: touchFlags.fine,
        })
    }

    stick.addEventListener('pointerdown', (e) => {
        stickId = e.pointerId
        try { stick.setPointerCapture(e.pointerId) } catch (_) { /* noop */ }
        e.preventDefault(); e.stopPropagation()
        moveStick(e)
    })
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e) })
    const endStick = (e) => {
        if (e.pointerId !== stickId) return
        stickId = null; stickX = 0
        knob.style.transform = 'translate(0,0)'
        pushStick()
    }
    stick.addEventListener('pointerup', endStick)
    stick.addEventListener('pointercancel', endStick)

    function moveStick(e) {
        const r = stick.getBoundingClientRect()
        let dx = e.clientX - (r.left + r.width / 2)
        dx = clamp(dx, -R, R)
        knob.style.transform = `translate(${dx}px,0)`
        const nx = dx / R
        // нелинейная зона в центре → точное маневрирование маленьким ходом пальца
        stickX = Math.sign(nx) * Math.pow(Math.abs(nx), 1.6)
        pushStick()
    }

    const holdAxis = (name, key) => {
        const el = t(name)
        if (!el) return
        el.addEventListener('pointerdown', (e) => {
            e.preventDefault(); e.stopPropagation()
            axes[key] = 1; el.classList.add('on'); pushStick()
        })
        const stop = () => { axes[key] = 0; el.classList.remove('on'); pushStick() }
        el.addEventListener('pointerup', stop)
        el.addEventListener('pointercancel', stop)
        el.addEventListener('pointerleave', stop)
    }
    ;['fwd', 'back', 'up', 'down'].forEach((k) => holdAxis(k, k))

    // тач-контролы не должны попадать в риг как «драг по сцене»
    root.querySelectorAll('.rig-stick, .rig-alt button').forEach((el) => {
        el.addEventListener('pointerdown', (e) => e.stopPropagation())
    })

    /* ---------- телеметрия ---------- */
    let modeText = ''
    const setMode = (txt) => {
        modeText = txt || ''
        const el = t('mode')
        el.textContent = modeText
        el.classList.toggle('on', !!modeText)
    }

    let acc = 0
    rig.on('update', (s) => {
        acc++
        if (acc % 4 !== 0) return     // обновляем текст раз в 4 кадра — меньше мусора в layout
        // фаза 6: телеметрия убрана — остаётся только множитель скорости на плашке
        const mul = t('mul')
        if (mul) mul.textContent = `×${s.speedMul.toFixed(2)}`
    })



    function setTouch(v) { root.classList.toggle('touch', !!v) }
    setTouch(touch)

    function dispose() { root.remove() }

    const dimBtn = root.querySelector('[data-act="dim"]')
    function set2D(on) {
        dimBtn.classList.toggle('on', !!on)
        dimBtn.textContent = on ? 'Объём · 3D' : 'План · 2D'
    }
    return { el: root, setMode, setTouch, dispose, pushStick, set2D }
}

export function isTouchDevice() {
    if (typeof window === 'undefined') return false
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) ||
        window.matchMedia?.('(pointer: coarse)').matches
}
