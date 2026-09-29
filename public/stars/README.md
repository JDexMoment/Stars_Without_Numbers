# Звёзды, пульсары и квазары (`/assets/stars/`)

Эти объекты **не ищутся как обычные 3D-модели планет**. Звезда, нейтронная звезда и квазар — это свет, корона, диск и джеты. Для Three.js лучше всего работают:

1. **Текстура на сфере** (обычная звезда / солнце системы)
2. **Процедурный меш** (нейтронная звезда = маленькая сфера + 2 конуса джетов)
3. **GLB только для уникальных «героев»** (один квазар сектора, один пульсар)

## Куда класть файлы

```
public/assets/stars/
  textures/          # .jpg .png .webp  — солнце, корона, аккреционный диск
  models/            # .glb .gltf       — только уникальные объекты
  sprites/           # .png с альфой    — блики, лучи, billboard-звёзды
```

В коде путь всегда начинается с `/assets/...`:

- `public/assets/stars/textures/g-type-sun.jpg` → `/assets/stars/textures/g-type-sun.jpg`

## Рекомендуемые форматы

| Тип | Что брать | Размер |
|---|---|---|
| Обычная звезда | equirectangular текстура 2:1 на сферу | 2048×1024 или 4096×2048 |
| Корона / glow | PNG с альфой, спрайт смотрит на камеру | 512–1024 |
| Нейтронная звезда | маленький emissive-шар + 2 конуса, GLB не обязателен | < 50k треугольников |
| Квазар | чёрная сфера + тор диска + 2 джета | < 80k треугольников |

Не качайте STL для 3D-печати напрямую в сцену: это «пластилин», без свечения. Если очень нужна научная форма — конвертируйте STL → GLB в Blender и назначьте emissive-материал.

## Где брать (проверенные бесплатные источники)

### Обычные звёзды / Солнце

- [Solar System Scope — Sun 2K](https://www.solarsystemscope.com/textures/download/2k_sun.jpg)  
  и [Sun 8K](https://www.solarsystemscope.com/textures/download/8k_sun.jpg)  
  Лицензия: **CC BY 4.0**. Кладём как `textures/sol-sun.jpg`. В титрах указать Solar System Scope.
- [Solar System Scope — Stars](https://www.solarsystemscope.com/textures/download/2k_stars.jpg)  
  и [Stars + Milky Way 2K](https://www.solarsystemscope.com/textures/download/2k_stars_milky_way.jpg) / [8K](https://www.solarsystemscope.com/textures/download/8k_stars_milky_way.jpg)  
  Это небо/скайбокс, не модель звезды. Кладём в `public/assets/nebulae/textures/`.
- [NASA SDO — разные длины волн Солнца](https://svs.gsfc.nasa.gov/4269/)  
  Оранжевое, ультрафиолетовое, магнитное Солнце. Хорошо для красных гигантов / голубых гигантов после перекраски в Photoshop.
- [NASA SDO Wavelength Graphics](https://svs.gsfc.nasa.gov/11071)

### Нейтронные звёзды / пульсары

Готовых красивых **бесплатных GLB почти нет**. Научные модели:

- [Chandra — Vela Pulsar, blast](https://chandra.harvard.edu/deadstar/images/3d_files/vela_blast.stl)  
  и [ejecta](https://chandra.harvard.edu/deadstar/images/3d_files/vela_ejecta.stl)  
  Публичный домен NASA/CXC. Это форма остатка, не «светящийся пульсар».
- [Chandra — все 3D-файлы](https://chandra.harvard.edu/resources/illustrations/3d_files.html)  
  Vela, Crab (внутри пульсар), IC 443 с PWN.
- [INAF / Salvatore Orlando на Sketchfab](https://sketchfab.com/sorlando)  
  Лучшие научные визуализации пульсаров. Многие только для просмотра, часть платная. Смотрите бейдж **Download**.
- [Pulsar, magnetized rotating neutron star](https://sketchfab.com/3d-models/pulsar-a-magnetized-rotating-neutron-star-c876c7449be643f196beed027b1b14b4)  
  [A highly magnetized rotating neutron star](https://sketchfab.com/3d-models/a-highly-magnetized-rotating-neutron-star-f3d06d6bb3794377afa7735460f23414)  
  Если Download недоступен — не пиратим, собираем свой меш по референсу.

**Практичный путь для карты:** не ищем GLB пульсара. Делаем:

- сфера радиуса `0.08–0.12`, цвет `#c4e4ff`, `emissiveIntensity: 3`
- два `coneGeometry` вдоль оси, полупрозрачные `#7dd3fc`
- тонкие линии магнитного диполя (как у Orlando)

### Квазары

Отдельных бесплатных GLB квазаров почти не существует (типичный «Quasar» на Sketchfab — корабль или пушка). Берём **чёрную дыру с диском** и добавляем джеты:

- [Black Hole + accretion disc — SebastianSosnowski, CC BY, скачивается](https://sketchfab.com/3d-models/black-hole-cfd16738ad2c402b9dc8e38a9c05c8d4)
- [black hole with accretion disk — CC BY](https://sketchfab.com/3d-models/black-hole-with-accretion-disk-1d0a5cb6bb2a43f4b2e7719c88cec6b2)
- [NASA SVS — Black Hole with Accretion Disk](https://svs.gsfc.nasa.gov/14619/) — референс/кадры, не меш
- [Chandra — иллюстрации квазаров](https://chandra.harvard.edu/resources/illustrations/quasar.html) — 2D-референс джетов

Фильтр Sketchfab, который реально работает:  
`https://sketchfab.com/search?q=black+hole+accretion&features=downloadable&licenses=322a749bcfa841b29dff1e8a1bb74b0b`

## Как генерировать, если модели нет

Промпт для текстуры звезды (Midjourney / Flux / SD):

```
equirectangular 2:1 seamless texture of a blue-white main sequence star photosphere,
granulation, solar flares, no limbs, no black background, tileable, highly detailed --ar 2:1
```

Для красного гиганта замените на `red giant star photosphere, dark starspots, convective cells`.

Для диска квазара нужна не сфера, а **полоска 4:1**:

```
seamless cylindrical texture of a glowing accretion disk, orange-white hot inner rim,
cooler red outer rings, Doppler beaming, no black hole in the image --ar 4:1
```

В Blender квазар собирается за 10 минут: UV-сфера (горизонт событий) + тор (диск) + 2 конуса (джеты) → Export GLB → `models/quasar-core.glb`.
