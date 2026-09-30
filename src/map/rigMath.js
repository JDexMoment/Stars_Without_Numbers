/**
 * rigMath.js — маленькая математическая библиотека для камеры в ОГРОМНОМ пространстве.
 *
 * Главная идея всего модуля движения: в космосе расстояния меняются на порядки
 * (от 0.5 юнита радиуса планеты до 1 000 000 юнитов галактики). Любая ЛИНЕЙНАЯ
 * скорость/зум там ломается: либо «еле ползёт», либо «улетает за кадр».
 * Поэтому всё, что связано с движением, у нас МУЛЬТИПЛИКАТИВНОЕ (экспоненциальное)
 * и нормировано на текущий масштаб обзора.
 */

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

export const lerp = (a, b, t) => a + (b - a) * t

/**
 * Кадронезависимое экспоненциальное сглаживание.
 * Обычный `lerp(a, b, 0.1)` в requestAnimationFrame — это баг: на 144 Гц всё
 * в 2.4 раза «быстрее», чем на 60 Гц. Здесь же результат зависит только от dt.
 *
 * @param {number} lambda  скорость реакции. 0 = мгновенно, 0.5 = очень вязко.
 *                         Удобно задавать как «доля от текущего значения за 1/60 с».
 */
export function damp(current, target, lambda, dt) {
    if (lambda <= 0) return target
    if (lambda >= 1) lambda = 1 - 1e-6
    const k = 1 - Math.pow(1 - lambda, dt * 60)
    return current + (target - current) * k
}

/** То же самое, но для THREE.Vector3 (без аллокаций). */
export function dampVec3(v, target, lambda, dt) {
    const k = lambda <= 0 ? 1 : 1 - Math.pow(1 - Math.min(lambda, 1 - 1e-6), dt * 60)
    v.x += (target.x - v.x) * k
    v.y += (target.y - v.y) * k
    v.z += (target.z - v.z) * k
    return v
}

/** Экспоненциальное «доведение» угла по кратчайшей дуге (чтобы не крутило лишний оборот). */
export function dampAngle(current, target, lambda, dt) {
    let d = (target - current) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    return damp(current, current + d, lambda, dt)
}

/** Привести угол к [0, 2π). Нужен, чтобы за часы полёта theta не уехала в 1e6 и не потеряла точность float. */
export const wrapAngle = (a) => {
    const t = a % (Math.PI * 2)
    return t < 0 ? t + Math.PI * 2 : t
}

/** Коротчайшая разница углов (−π..π). */
export function angleDelta(from, to) {
    let d = (to - from) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    return d
}

export function smoothstep(edge0, edge1, x) {
    if (edge0 === edge1) return x < edge0 ? 0 : 1
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)
}

/* ------------------------------------------------------------------ */
/*  Форматирование больших чисел                                       */
/* ------------------------------------------------------------------ */

/** Красивая запись числа: 1.24M, 850k, 12.3 */
export function fmtNum(v, digits = 2) {
    const a = Math.abs(v)
    if (!isFinite(a)) return '∞'
    if (a >= 1e9) return (v / 1e9).toFixed(digits) + 'B'
    if (a >= 1e6) return (v / 1e6).toFixed(digits) + 'M'
    if (a >= 1e4) return (v / 1e3).toFixed(1) + 'k'
    if (a >= 100) return v.toFixed(0)
    if (a >= 1) return v.toFixed(1)
    if (a === 0) return '0'
    return v.toPrecision(2)
}

/**
 * Перевод «юнитов сцены» в понятные игроку величины.
 * По умолчанию 1 юнит = 1 млн км, тогда:
 *   1 а.е.   ≈ 150 юнитов
 *   1 св. год ≈ 9 461 000 юнитов
 *   1 пк     ≈ 30 860 000 юнитов
 * `scales` можно переопределить под свою сцену.
 */
export const DEFAULT_UNITS = [
    { max: 1, label: 'млн км', div: 1 },
    { max: 150 * 100, label: 'а.е.', div: 150 },
    { max: 9.461e6 * 500, label: 'св. лет', div: 9.461e6 },
    { max: Infinity, label: 'пк', div: 3.086e7 },
]

export function fmtUnits(v, scales) {
    // scales может прийти как null из HUD-опций — не роняем кадр
    const table = Array.isArray(scales) && scales.length ? scales : DEFAULT_UNITS
    const a = Math.abs(v)
    for (const s of table) {
        if (a < s.max) {
            const x = v / s.div
            const ax = Math.abs(x)
            const d = ax >= 1000 ? 0 : ax >= 100 ? 1 : ax >= 10 ? 2 : ax >= 1 ? 2 : 2
            return `${x.toFixed(d)} ${s.label}`
        }
    }
    return fmtNum(v)
}

/**
 * Скользящее среднее для FPS/телеметрии (без дёрганий).
 */
export function createSma(window = 30) {
    const buf = new Float32Array(window)
    let i = 0
    let n = 0
    let sum = 0
    return {
        push(v) {
            if (n === window) sum -= buf[i]
            else n++
            buf[i] = v
            sum += v
            i = (i + 1) % window
        },
        get value() {
            return n ? sum / n : 0
        },
    }
}
