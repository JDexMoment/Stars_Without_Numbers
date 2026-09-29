import * as THREE from 'three'

export function createOrbitRing(radius, x = 0, y = 0, z = 0, color = 0xffffff) {
    const geometry = new THREE.RingGeometry(radius - 0.02, radius + 0.02, 64)
    const material = new THREE.MeshBasicMaterial({ 
        color: color, 
        side: THREE.DoubleSide, 
        transparent: true, 
        opacity: 0.3 
    })
    const ring = new THREE.Mesh(geometry, material)
    ring.rotation.x = -Math.PI / 2 
    ring.position.set(x, y, z)
    ring.userData.clickable = false
    return ring
}

export function setOrbitPosition(object, x, y, z) {
    const orbit = object.userData.orbit
    if (!orbit) {
        console.warn('У объекта нет данных об орбите!')
        return
    }
    const centerX = orbit.center ? orbit.center.x : 0
    const centerZ = orbit.center ? orbit.center.z : 0
    const angle = Math.atan2(z - centerZ, x - centerX)
    orbit.angle = angle
    object.position.set(x, y, z)
}

export function createObjectInteractor(scene, camera, controls) {
    let clickedObject = null
    let previousClickedObject = null
    let isObjectClicked = false
    let isDragging = false
    let previousMousePosition = { x: 0, y: 0 }
    let dragStartPos = { x: 0, y: 0 }
    let ignoreNextClick = false
    
    // НОВОЕ: Состояние для вращения камеры ПКМ
    let isRightDragging = false
    let previousRightMousePosition = { x: 0, y: 0 }
    
    let cameraState = 'IDLE'
    let isSceneFrozen = false
    
    let savedCameraPos = new THREE.Vector3()
    let savedTargetPos = new THREE.Vector3()
    let cameraOffset = new THREE.Vector3()
    let targetOffset = new THREE.Vector3()

    const raycaster = new THREE.Raycaster()
    const mouse = new THREE.Vector2()

    const closeButton = document.createElement('button')
    closeButton.innerHTML = '✕'
    closeButton.style.cssText = `
        position: fixed; top: 20px; right: 20px; width: 40px; height: 40px;
        font-size: 24px; background: rgba(255, 255, 255, 0.9); border: none;
        border-radius: 50%; cursor: pointer; display: none; z-index: 1000;
        color: #333; font-weight: bold;
    `
    document.body.appendChild(closeButton)

    function getCameraParamsForObj(obj) {
        let focusObj = obj
        
        // Если у объекта есть дети, ищем меш с флагом cameraFocus
        if (obj.children && obj.children.length > 0) {
            obj.traverse((child) => {
                if (child.isMesh && child.userData.cameraFocus === true) {
                    focusObj = child
                }
            })
        }
        
        const worldPosition = new THREE.Vector3()
        focusObj.getWorldPosition(worldPosition)
        
        const boundingBox = new THREE.Box3().setFromObject(focusObj)
        const boundingSphere = new THREE.Sphere()
        boundingBox.getBoundingSphere(boundingSphere)
        
        const safeRadius = Math.max(1, Math.min(boundingSphere.radius, 15))
        const distance = safeRadius * 1.5
        const lookAtOffset = safeRadius * 0.5
        
        return {
            camPos: new THREE.Vector3(worldPosition.x, worldPosition.y + lookAtOffset * 0.5, worldPosition.z + distance),
            targetPos: new THREE.Vector3(worldPosition.x + lookAtOffset, worldPosition.y, worldPosition.z)
        }
    }

    function resetObjectRotation(obj) {
        if (obj && obj.userData.rotationBeforeDrag) {
            gsap.to(obj.rotation, {
                duration: 1.5,
                x: obj.userData.rotationBeforeDrag.x,
                y: obj.userData.rotationBeforeDrag.y,
                z: obj.userData.rotationBeforeDrag.z,
                ease: 'power2.inOut'
            })
        }
    }

    function resetSelection() {
        if (cameraState === 'FLYING_BACK') return
        
        cameraState = 'FLYING_BACK'
        isObjectClicked = false
        isDragging = false
        isRightDragging = false
        closeButton.style.display = 'none'
        controls.enabled = true
        isSceneFrozen = true
        
        gsap.killTweensOf(camera.position)
        gsap.killTweensOf(controls.target)
        
        resetObjectRotation(previousClickedObject)
        
        gsap.to(camera.position, { 
            duration: 1.5, 
            x: savedCameraPos.x, 
            y: savedCameraPos.y, 
            z: savedCameraPos.z, 
            ease: 'power2.inOut',
            onComplete: () => {
                cameraState = 'IDLE'
                clickedObject = null
                previousClickedObject = null
                isSceneFrozen = false
            }
        })
        
        gsap.to(controls.target, { 
            duration: 1.5, 
            x: savedTargetPos.x, 
            y: savedTargetPos.y, 
            z: savedTargetPos.z, 
            ease: 'power2.inOut', 
            onUpdate: () => controls.update() 
        })
    }

    closeButton.addEventListener('click', resetSelection)

    function onMouseMove(event) {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1

        // ЛКМ — вращение объекта вокруг своей оси
        if (isObjectClicked && isDragging && clickedObject && event.buttons === 1) {
            // НОВОЕ: Если объект полностью заблокирован от вращения, пропускаем
            if (clickedObject.userData.lockRotation === true) {
                return
            }
            
            const deltaX = event.clientX - previousMousePosition.x
            const deltaY = event.clientY - previousMousePosition.y
            
            // Функция вращения с проверкой блокировки
            const applyRotation = (obj) => {
                if (obj.userData.lockRotation !== true) {
                    obj.rotation.y += deltaX * 0.005
                    obj.rotation.x += deltaY * 0.005
                }
            }
            
            // Если это группа (как черная дыра), крутим каждый меш отдельно,
            // пропуская те, у которых стоит lockRotation
            if (clickedObject.children && clickedObject.children.length > 0) {
                clickedObject.traverse((child) => {
                    if (child.isMesh) applyRotation(child)
                })
            } else {
                applyRotation(clickedObject)
            }
        }
        
        // НОВОЕ: ПКМ — вращение камеры вокруг объекта
        if (isObjectClicked && isRightDragging && clickedObject && event.buttons === 2) {
            const deltaX = event.clientX - previousRightMousePosition.x
            const deltaY = event.clientY - previousRightMousePosition.y
            
            // Конвертируем текущее смещение камеры в сферические координаты
            const spherical = new THREE.Spherical()
            spherical.setFromVector3(cameraOffset)
            
            // Меняем углы на основе движения мыши
            spherical.theta -= deltaX * 0.005  // Горизонтальное вращение
            spherical.phi -= deltaY * 0.005    // Вертикальное вращение
            
            // Ограничиваем вертикальный угол, чтобы камера не переворачивалась
            spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi))
            
            // Конвертируем обратно в вектор и обновляем смещение
            const newOffset = new THREE.Vector3().setFromSpherical(spherical)
            cameraOffset.copy(newOffset)
            
            previousRightMousePosition.x = event.clientX
            previousRightMousePosition.y = event.clientY
        }
        
        previousMousePosition.x = event.clientX
        previousMousePosition.y = event.clientY
    }

    function onMouseClick(event) {
        if (closeButton.contains(event.target)) return
        if (ignoreNextClick) {
            ignoreNextClick = false
            return
        }
        
        if (cameraState === 'FLYING_BACK') {
            gsap.killTweensOf(camera.position)
            gsap.killTweensOf(controls.target)
            isSceneFrozen = false
        }

        raycaster.setFromCamera(mouse, camera)
        const intersects = raycaster.intersectObjects(scene.children, true)
        const validIntersects = intersects.filter(hit => 
            hit.object.isMesh && 
            hit.object.geometry && 
            hit.object.userData.clickable !== false
        )

        if (validIntersects.length > 0) {
            let targetObject = validIntersects[0].object
            
            while (targetObject.parent && targetObject.parent !== scene) {
                targetObject = targetObject.parent
            }
            
            if (clickedObject === targetObject && (cameraState === 'FOLLOWING' || cameraState === 'FLYING_TO')) {
                return
            }
            
            if (clickedObject && clickedObject !== targetObject) {
                resetObjectRotation(clickedObject)
            }
            
            clickedObject = targetObject
            previousClickedObject = clickedObject
            isObjectClicked = true
            isDragging = false
            isRightDragging = false
            
            clickedObject.userData.rotationBeforeDrag = clickedObject.rotation.clone()
            
            savedCameraPos.copy(camera.position)
            savedTargetPos.copy(controls.target)
            
            isSceneFrozen = true
            cameraState = 'FLYING_TO'
            
            const enterParams = getCameraParamsForObj(clickedObject)
            gsap.killTweensOf(camera.position)
            gsap.killTweensOf(controls.target)

            gsap.to(camera.position, { 
                duration: 1.5, 
                x: enterParams.camPos.x, 
                y: enterParams.camPos.y, 
                z: enterParams.camPos.z, 
                ease: 'power2.inOut',
                onComplete: () => {
                    const objPos = new THREE.Vector3()
                    clickedObject.getWorldPosition(objPos)
                    cameraOffset.subVectors(camera.position, objPos)
                    targetOffset.subVectors(controls.target, objPos)
                    isSceneFrozen = false
                    cameraState = 'FOLLOWING'
                }
            })

            gsap.to(controls.target, { 
                duration: 1.5, 
                x: enterParams.targetPos.x, 
                y: enterParams.targetPos.y, 
                z: enterParams.targetPos.z, 
                ease: 'power2.inOut', 
                onUpdate: () => controls.update() 
            })
            
            controls.enabled = false
            closeButton.style.display = 'block'
        } else {
            return
        }
    }

    function onMouseDown(event) {
        if (event.button === 0) { // ЛКМ
            dragStartPos.x = event.clientX
            dragStartPos.y = event.clientY
            ignoreNextClick = false
            if (isObjectClicked) isDragging = true
        }
        
        // НОВОЕ: ПКМ — начинаем вращение камеры
        if (event.button === 2) {
            if (isObjectClicked && cameraState === 'FOLLOWING') {
                isRightDragging = true
                previousRightMousePosition.x = event.clientX
                previousRightMousePosition.y = event.clientY
            }
        }
    }

    function onMouseUp(event) {
        if (event.button === 0) {
            isDragging = false
            const deltaX = event.clientX - dragStartPos.x
            const deltaY = event.clientY - dragStartPos.y
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
            if (distance > 5) ignoreNextClick = true
        }
        
        // НОВОЕ: Отпускаем ПКМ
        if (event.button === 2) {
            isRightDragging = false
        }
    }

    function onContextMenu(event) {
        // Блокируем контекстное меню, чтобы ПКМ работало для вращения камеры
        if (isObjectClicked) event.preventDefault()
    }

    window.addEventListener('mousemove', onMouseMove, false)
    window.addEventListener('click', onMouseClick, false)
    window.addEventListener('mousedown', onMouseDown, false)
    window.addEventListener('mouseup', onMouseUp, false)
    window.addEventListener('contextmenu', onContextMenu, false)

    function update() {
        if (!isSceneFrozen) {
            scene.traverse((child) => {
                if (child.userData && child.userData.rotationSpeed) {
                    child.rotation.y += child.userData.rotationSpeed.y || 0
                    child.rotation.x += child.userData.rotationSpeed.x || 0
                }
                if (child.userData && child.userData.orbit) {
                    const orbit = child.userData.orbit
                    orbit.angle += orbit.speed
                    const centerX = orbit.center ? orbit.center.x : 0
                    const centerY = orbit.center ? orbit.center.y : 0
                    const centerZ = orbit.center ? orbit.center.z : 0
                    const newX = centerX + Math.cos(orbit.angle) * orbit.radius
                    const newZ = centerZ + Math.sin(orbit.angle) * orbit.radius
                    child.position.set(newX, centerY, newZ)
                }
            })
        }

        if (cameraState === 'FOLLOWING' && clickedObject) {
            const objPos = new THREE.Vector3()
            clickedObject.getWorldPosition(objPos)
            const targetCamPos = objPos.clone().add(cameraOffset)
            const targetLookPos = objPos.clone().add(targetOffset)
            camera.position.lerp(targetCamPos, 0.15)
            controls.target.lerp(targetLookPos, 0.15)
            controls.update()
        }
    }

    function dispose() {
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('click', onMouseClick)
        window.removeEventListener('mousedown', onMouseDown)
        window.removeEventListener('mouseup', onMouseUp)
        window.removeEventListener('contextmenu', onContextMenu)
        document.body.removeChild(closeButton)
    }

    return { update, dispose }
}