import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
// Импортируем фабрику и утилитарные функции
import { createObjectInteractor, createOrbitRing, setOrbitPosition } from './objectUse.js' 

// --- 1. SCENE SETUP (как раньше) ---
const scene = new THREE.Scene()
const ambientLight = new THREE.AmbientLight(0xffffff, 0.1)
scene.add(ambientLight)

// ДОБАВЛЯЕМ точечный свет от солнца
const sunLight = new THREE.PointLight(0xffffff, 10, 200, 0.5)
sunLight.position.set(10, 10, 0) // Точно на позиции солнца
scene.add(sunLight)

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10000)
camera.position.set(0, 0, 5)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
document.body.appendChild(renderer.domElement)

const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.05
controls.minDistance = 1
controls.maxDistance = 100
controls.target.set(0, 0, 0)

// --- 2. ИНИЦИАЛИЗАЦИЯ ИНТЕРАКТОРА ---
const interactor = createObjectInteractor(scene, camera, controls)

// --- 3. СОЗДАНИЕ ПЛАНЕТ С ИСПОЛЬЗОВАНИЕМ ТЕКСТУР ---
const textureLoader = new THREE.TextureLoader()

// ПЛУТОН
const pluto = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 32, 32),
    new THREE.MeshStandardMaterial({ map: textureLoader.load('public\\planets\\textures\\Pluto.jpg') })
)
pluto.userData.rotationSpeed = { x: 0, y: 0.001 }
pluto.userData.orbit = {
    radius: 20,
    speed: 0.001,
    angle: 0,
    center: new THREE.Vector3(10, 10, 0)
}
// Используем импортированную функцию!
setOrbitPosition(pluto, 10, 10, 0)
scene.add(createOrbitRing(20, 10, 10, 0, 0x8888ff))
scene.add(pluto)

// ВЕНЕРА
const venus = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 32, 32),
    new THREE.MeshStandardMaterial({ map: textureLoader.load('public\\planets\\textures\\Venus.jpg') })
)
venus.userData.rotationSpeed = { x: 0, y: 0.001 }
venus.userData.orbit = {
    radius: 30,
    speed: 0.0005,
    angle: 0,
    center: new THREE.Vector3(10, 10, 0)
}
setOrbitPosition(venus, 10, 10, 0)
scene.add(createOrbitRing(30, 10, 10, 0, 0xffaa00))
scene.add(venus)

// --- 4. ЗАГРУЗКА GLTF (как раньше) ---
const loader = new GLTFLoader()

loader.load('public\\stars\\models\\sun.glb', (gltf) => {
    const sun = gltf.scene
    sun.scale.set(1, 1, 1)
    sun.position.set(10, 10, 0)
    sun.userData.rotationSpeed = { x: 0, y: 0.0005 }
    scene.add(sun)
})

loader.load('public\\stars\\models\\blackhole.glb', (gltf) => {
    const blackHole = gltf.scene
    blackHole.scale.set(1, 1, 1)
    blackHole.position.set(0, 5, -10)
    blackHole.userData.rotationSpeed = { x: 0, y: 0.002 }
    
    // НОВОЕ: Полностью отключаем вращение мышкой для всей черной дыры
    blackHole.userData.lockRotation = true
    
    // Настраиваем дочерние меши для фокуса камеры
    blackHole.traverse((child) => {
        if (child.isMesh) {
            // Камера подлетает только к ядру (core)
            if (child.name.includes('core') && !child.name.includes('001') && !child.name.includes('002')) {
                child.userData.cameraFocus = true
            }
        }
    })
    
    scene.add(blackHole)
})

// loader.load('public\\nebulae\\models\\billions_stars_skybox_hdri_panorama.glb', (gltf) => {
//     const panorama = gltf.scene
//     panorama.scale.set(1500, 1500, 1500)
//     panorama.position.set(0, 0, 0)
    
//     panorama.traverse((child) => {
//         if (child.isMesh) {
//             child.userData.clickable = false
            
//             // Уменьшаем яркость материалов
//             if (child.material) {
//                 // Если есть свечение (emissive), уменьшаем его
//                 if (child.material.emissive) {
//                     child.material.emissive.multiplyScalar(0.1)
//                 }
//             }
//         }
//     })
    
//     scene.add(panorama)
// })

// loader.load('public\\nebulae\\models\\nebula_skybox_16k.glb', (gltf) => {
//     const panorama16k = gltf.scene
//     panorama16k.scale.set(10, 10, 10)
//     panorama16k.position.set(0, 0, 0)

//     panorama16k.traverse((child) => {
//         if (child.isMesh) {
//             child.userData.clickable = false

//             // Уменьшаем яркость материалов
//             if (child.material) {
//                 // Если есть свечение (emissive), уменьшаем его
//                 if (child.material.emissive) {
//                     child.material.emissive.multiplyScalar(0.3)
//                 }
//             }
//         }
//     })
//     scene.add(panorama16k)
// })

loader.load('public\\nebulae\\models\\need_some_space.glb', (gltf) => {
    const panorama16k = gltf.scene
    panorama16k.scale.set(3000, 3000, 3000)
    panorama16k.position.set(-5000, -4000, 5000)

    panorama16k.traverse((child) => {
        if (child.isMesh) {
            child.userData.clickable = false

            // Уменьшаем яркость материалов
            if (child.material) {
                // Если есть свечение (emissive), уменьшаем его
                if (child.material.emissive) {
                    child.material.emissive.multiplyScalar(0.1)
                }
            }
        }
    })
    scene.add(panorama16k)
})

loader.load('public\\nebulae\\models\\nebula_mapa.glb', (gltf) => {
    const mapa = gltf.scene
    mapa.scale.set(600, 600, 600)
    mapa.position.set(0, 1000, 500)

    mapa.traverse((child) => {
        if (child.isMesh) {
            child.userData.clickable = false
        }
    })
    scene.add(mapa)
})

// --- 5. ОБРАБОТКА ИЗМЕНЕНИЯ РАЗМЕРА ОКНА ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
})

// --- 6. ГЛАВНЫЙ ЦИКЛ АНИМАЦИИ ---
function animate() {
    requestAnimationFrame(animate)
    interactor.update()
    controls.update()
    renderer.render(scene, camera)
}

animate()