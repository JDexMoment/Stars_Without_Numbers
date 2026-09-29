# Туманности и глубокий космос (`/assets/nebulae/`)

Туманность на карте галактики почти никогда не должна быть «статуэткой» из STL. Есть три рабочих формата:

1. **Skybox / panorama 2:1** — фон всей 3D-карты (галактика, пыль, далёкие рукава)
2. **Billboard / sprite PNG с альфой** — конкретная туманность в секторе, всегда смотрит на камеру
3. **Объёмный меш GLB/OBJ** — только если игрок подлетает вплотную к «достопримечательности» (Краб, Столпы Творения)

## Куда класть файлы

```
public/assets/nebulae/
  textures/          # панорамы 2:1, skybox, Hubble-кадры
  sprites/           # PNG с прозрачностью для billboard
  models/            # .glb .gltf .obj — уникальные объёмные туманности
```

Пример пути в приложении: `/assets/nebulae/textures/orion-panorama.jpg`

Рекомендуемые размеры:

- фон карты: **4096×2048** (не 8K — карта начнёт лагать)
- sprite сектора: **1024×1024 PNG**
- модель: < 100k треугольников, лучше GLB

## 1. Фон / скайбоксы (это то, что нужно в первую очередь)

Скачиваются как сфера/панорама, вешаются на огромный `SphereGeometry` с `BackSide`:

- [FREE SkyBox Space Nebula — Paul, CC BY, 6K панорама внутри](https://sketchfab.com/3d-models/free-skybox-space-nebula-fa5c19c4f7cc4525a24b99425bd520c8)
- [Nebula space HDRi background photosphere — CC BY](https://sketchfab.com/3d-models/nebula-space-hdri-background-photosphere-38e96b59f24345d9a757030eadc92bac)
- [Nebula skybox 16K — Jungle Jim, CC BY](https://sketchfab.com/3d-models/nebula-skybox-16k-0d1e380993a842e6a0111f09c5cb6bdc)  
  16K тяжёлый, режьте до 4K.
- [Solar System Scope — Stars + Milky Way 2K](https://www.solarsystemscope.com/textures/download/2k_stars_milky_way.jpg) / [8K](https://www.solarsystemscope.com/textures/download/8k_stars_milky_way.jpg)  
  CC BY 4.0, отличный нейтральный космос.
- [OpenGameArt — 32 seamless space backgrounds, CC0](https://opengameart.org/content/seamless-space-backgrounds)
- [itch.io — Nebula Skybox Collection (Space Engine)](https://jesterofdestiny.itch.io/nebula-skybox-collection)

Фильтр Sketchfab:  
`https://sketchfab.com/search?q=nebula+skybox&features=downloadable&type=models`

## 2. Настоящие 3D-модели туманностей (NASA / Chandra, бесплатно)

Это научные реконструкции. Форматы часто STL/OBJ для печати — в Blender конвертируйте в GLB и поставьте полупрозрачный `MeshPhysicalMaterial` / `transmission`.

Каталог всех файлов: [Chandra 3D Files](https://chandra.harvard.edu/resources/illustrations/3d_files.html)

| Объект | Что это | Прямые файлы |
|---|---|---|
| **Crab Nebula** | остаток сверхновой + пульсар внутри | [OBJ](https://chandra.harvard.edu/deadstar/images/3d_files/CrabNebulaXrayModel_OBJexport.obj) · [MTL](https://chandra.harvard.edu/deadstar/images/3d_files/CrabNebulaXrayModel_OBJexport.mtl) · [FBX](https://chandra.harvard.edu/deadstar/images/3d_files/CrabNebulaXrayModel_FBXexport.fbx) · [STL](https://chandra.harvard.edu/deadstar/images/3d_files/Crab_X_Ray_3D_modelReadyPrint.stl) · [карточка NASA](https://nasa3d.arc.nasa.gov/detail/crab-nebula) |
| **Helix Nebula** | планетарная туманность | [STL](https://chandra.harvard.edu/deadstar/images/3d_files/helix.stl) |
| **Eagle / Pillars of Creation** | столпы звездообразования | [STL](https://chandra.harvard.edu/deadstar/images/3d_files/m16.stl) |
| **Eta Carinae Homunculus** | биполярная туманность вокруг звезды | [OBJ](https://chandra.harvard.edu/deadstar/images/3d_files/EtaCar_Modified_Jan21.obj) · [MTL](https://chandra.harvard.edu/deadstar/images/3d_files/EtaCar_Modified_Jan21.mtl) |
| **IC 443 Jellyfish** | остаток сверхновой | [Blastwave STL](https://chandra.harvard.edu/deadstar/images/3d_files/IC443_Blastwave.stl) · [Ejecta](https://chandra.harvard.edu/deadstar/images/3d_files/IC443_Ejecta.stl) · [страница NASA](https://science.nasa.gov/3d-resources/ic-443-jellyfish-nebula/) |
| **Vela Pulsar remnant** | оболочка нейтронной звезды | [blast](https://chandra.harvard.edu/deadstar/images/3d_files/vela_blast.stl) · [ejecta](https://chandra.harvard.edu/deadstar/images/3d_files/vela_ejecta.stl) |
| **Cassiopeia A** | классический SNR | [STL 28 MB](https://chandra.harvard.edu/graphics/resources/illustrations/3d_files/CasA.stl) |
| **SN 1006** | сферический остаток | [EJECTA Full Globe](https://chandra.harvard.edu/deadstar/images/SN1006_EJECTA_FullGlobe.stl) |
| **Cygnus Loop** | ударная волна | [STL](https://chandra.harvard.edu/photo/2025/3dmodels/3dmodels_testprint_cygnus.stl) |
| **DG Tau** | молодая звезда + джеты + диск | [OBJ](https://chandra.harvard.edu/deadstar/images/3d_files/DG_Tau.obj) |

Дополнительно:

- [NASA 3D Resources](https://science.nasa.gov/3d-resources/)
- [NASA 3D Models (старый каталог)](https://nasa3d.arc.nasa.gov/)
- [GitHub nasa/NASA-3D-Resources](https://github.com/nasa/NASA-3D-Resources)
- [Chandra Tactile plates (есть GLB!)](https://chandra.harvard.edu/tactile/3d_plates.html) — плоские тактильные пластины, для карты слабые, но формат уже GLB.

Стилизованная объёмная туманность (не NASA):

- [Red Nebula — HumbertoCII, CC BY, скачивается](https://sketchfab.com/3d-models/red-nebula-dd9993b74a7a4b4d80e95b6c7d8b708e)

## 3. Картинки Hubble / JWST как спрайты секторов

Если нужна красота, а не научный меш — берите кадры и вырезайте альфу:

- [ESA/Hubble images](https://esahubble.org/images/)
- [NASA Image Library](https://images.nasa.gov/)
- [Chandra Photo Album](https://chandra.harvard.edu/photo/)

Лицензия NASA/ESA изображений обычно позволяет использование с указанием кредита.

## Конвертация STL/OBJ → GLB (Windows / Blender)

1. Скачайте Blender (бесплатно).
2. `File → Import → STL` или `OBJ`.
3. В Shading поставьте Principled BSDF:  
   `Emission 2–6`, `Alpha 0.15–0.35`, `Blend Mode: Alpha Blend`.
4. `File → Export → glTF 2.0 (.glb)`, включите `Compression`.
5. Положите в `public/assets/nebulae/models/crab.glb`.

Не кладите сырые 20–40 MB STL в `public/` — карта снова станет дерганой.
