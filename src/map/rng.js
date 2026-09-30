/**
 * rng.js — детерминированный генератор случайных чисел.
 * Карта должна быть одинаковой между сессиями (и у всех игроков кампании!),
 * поэтому Math.random() для генерации сектора не годится.
 */
export function mulberry32(seed) {
    let a = seed >>> 0
    return function () {
        a = (a + 0x6D2B79F5) >>> 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

/**
 * Детерминированный 32-битный хэш строки (FNV-1a).
 * Нужен, чтобы одна и та же система/планета всегда получала одинаковый
 * «случайный» оттенок, сид и т.п. — без привязки к Math.random().
 */
export function hashString(str) {
    let h = 0x811c9dc5
    const s = String(str)
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 0x01000193)
    }
    return h >>> 0
}
