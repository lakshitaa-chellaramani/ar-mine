// AR Mine Safety Navigation System - Display Client
// Three.js 3D Mine Visualization

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    grid: { size: 80, cellSize: 4 },
    camera: { height: 1.7, fov: 75, near: 0.1, far: 1000 },
    movement: { speed: 0.15, runMultiplier: 2, sensitivity: 0.002 },
    fog: { color: 0x0a0a0a, density: 0.015 },
    lighting: { ambient: 0x1a1a1a, point: 0xffaa44 }
};

// ============================================
// GLOBAL VARIABLES
// ============================================
let scene, camera, renderer, clock;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let isRunning = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let euler = new THREE.Euler(0, 0, 0, 'YXZ');
let isPointerLocked = false;
let socket;
let roomId = null;
let annotations = [];
let mineWalls = [];
let playerPosition = new THREE.Vector3(0, CONFIG.camera.height, 0);
let minimapCanvas, minimapCtx;
let dustParticles;
let flickerLights = [];

// Flashlight
let flashlight;
let flashlightTarget;
let isFlashlightOn = true;

// Audio
let audioContext;
let ambientSound, alertSound, warningSound;

// ============================================
// INITIALIZATION
// ============================================
function init() {
    updateLoadingStatus('Creating scene...');

    // Scene setup
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.fog.color);
    scene.fog = new THREE.FogExp2(CONFIG.fog.color, CONFIG.fog.density);

    // Camera setup
    camera = new THREE.PerspectiveCamera(
        CONFIG.camera.fov,
        window.innerWidth / window.innerHeight,
        CONFIG.camera.near,
        CONFIG.camera.far
    );
    camera.position.set(0, CONFIG.camera.height, 0);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    clock = new THREE.Clock();

    updateLoadingStatus('Building mine environment...');

    // Build the mine
    createLighting();
    createFlashlight();
    createMineEnvironment();
    createDustParticles();

    updateLoadingStatus('Setting up controls...');

    // Setup controls and events
    setupControls();
    setupMinimap();

    updateLoadingStatus('Connecting to server...');

    // Connect to server
    connectToServer();

    // Initialize audio
    initAudio();

    // Start animation loop
    animate();

    // Hide loading screen after delay
    setTimeout(() => {
        document.getElementById('loading-screen').classList.add('hidden');
    }, 1500);
}

function updateLoadingStatus(status) {
    const statusEl = document.getElementById('loading-status');
    if (statusEl) statusEl.textContent = status;
}

// ============================================
// LIGHTING
// ============================================
function createLighting() {
    // Ambient light (very dim)
    const ambient = new THREE.AmbientLight(CONFIG.lighting.ambient, 0.3);
    scene.add(ambient);

    // Create flickering point lights along corridors
    const lightPositions = [
        { x: 0, y: 3, z: -15 },
        { x: 0, y: 3, z: -30 },
        { x: 0, y: 3, z: -45 },
        { x: 0, y: 3, z: -60 },
        { x: 0, y: 3, z: -75 },
        { x: -20, y: 3, z: -30 },
        { x: 20, y: 3, z: -30 },
        { x: -20, y: 3, z: -60 },
        { x: 20, y: 3, z: -60 },
    ];

    lightPositions.forEach(pos => {
        const light = new THREE.PointLight(CONFIG.lighting.point, 1, 30);
        light.position.set(pos.x, pos.y, pos.z);
        light.castShadow = true;
        light.shadow.mapSize.width = 512;
        light.shadow.mapSize.height = 512;
        scene.add(light);

        // Light fixture mesh
        const fixtureGeom = new THREE.CylinderGeometry(0.1, 0.2, 0.3, 8);
        const fixtureMat = new THREE.MeshBasicMaterial({ color: 0xffaa44, emissive: 0xffaa44 });
        const fixture = new THREE.Mesh(fixtureGeom, fixtureMat);
        fixture.position.copy(light.position);
        fixture.position.y += 0.3;
        scene.add(fixture);

        flickerLights.push({ light, baseIntensity: 1 });
    });
}

// ============================================
// FLASHLIGHT
// ============================================
function createFlashlight() {
    // Create a spotlight that follows the camera (flashlight effect)
    flashlight = new THREE.SpotLight(0xffffff, 2, 50, Math.PI / 6, 0.3, 1);
    flashlight.position.set(0, 0, 0);
    flashlight.castShadow = true;
    flashlight.shadow.mapSize.width = 1024;
    flashlight.shadow.mapSize.height = 1024;
    flashlight.shadow.camera.near = 0.5;
    flashlight.shadow.camera.far = 50;

    // Create a target for the spotlight to point at
    flashlightTarget = new THREE.Object3D();
    flashlightTarget.position.set(0, 0, -1);
    scene.add(flashlightTarget);

    flashlight.target = flashlightTarget;

    // Add flashlight to camera so it moves with the player
    camera.add(flashlight);
    flashlight.position.set(0.3, -0.2, 0); // Slightly offset like holding a flashlight

    // Add camera to scene (required for camera children to work)
    scene.add(camera);

    // Add a subtle point light for ambient illumination around player
    const playerLight = new THREE.PointLight(0xffffee, 0.5, 8);
    playerLight.position.set(0, 0, 0);
    camera.add(playerLight);

    // Create flashlight beam visual effect (volumetric cone)
    const beamGeometry = new THREE.ConeGeometry(0.8, 8, 16, 1, true);
    const beamMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffcc,
        transparent: true,
        opacity: 0.03,
        side: THREE.DoubleSide,
        depthWrite: false
    });
    const beam = new THREE.Mesh(beamGeometry, beamMaterial);
    beam.rotation.x = Math.PI / 2;
    beam.position.set(0.3, -0.2, -4);
    camera.add(beam);
}

function toggleFlashlight() {
    isFlashlightOn = !isFlashlightOn;
    if (flashlight) {
        flashlight.intensity = isFlashlightOn ? 2 : 0;
    }
    // Update beam visibility
    camera.children.forEach(child => {
        if (child.type === 'Mesh') {
            child.visible = isFlashlightOn;
        }
    });
}

// ============================================
// MINE ENVIRONMENT
// ============================================
function createMineEnvironment() {
    // Create textures procedurally
    const rockTexture = createRockTexture();
    const floorTexture = createFloorTexture();

    // Materials
    const wallMaterial = new THREE.MeshStandardMaterial({
        map: rockTexture,
        roughness: 0.9,
        metalness: 0.1,
        bumpMap: rockTexture,
        bumpScale: 0.3
    });

    const floorMaterial = new THREE.MeshStandardMaterial({
        map: floorTexture,
        roughness: 0.95,
        metalness: 0.05
    });

    const ceilingMaterial = new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 1,
        metalness: 0
    });

    // Main corridor (North-South)
    createTunnel(0, 0, -90, 8, 4, 180, wallMaterial, floorMaterial, ceilingMaterial);

    // Side tunnels (East-West)
    createTunnel(-25, 0, -30, 50, 4, 6, wallMaterial, floorMaterial, ceilingMaterial);
    createTunnel(25, 0, -30, 50, 4, 6, wallMaterial, floorMaterial, ceilingMaterial);
    createTunnel(-25, 0, -60, 50, 4, 6, wallMaterial, floorMaterial, ceilingMaterial);
    createTunnel(25, 0, -60, 50, 4, 6, wallMaterial, floorMaterial, ceilingMaterial);
    createTunnel(-25, 0, -90, 50, 4, 6, wallMaterial, floorMaterial, ceilingMaterial);

    // Support pillars
    const pillarPositions = [
        { x: -3, z: -20 }, { x: 3, z: -20 },
        { x: -3, z: -40 }, { x: 3, z: -40 },
        { x: -3, z: -70 }, { x: 3, z: -70 },
        { x: -3, z: -100 }, { x: 3, z: -100 },
    ];

    pillarPositions.forEach(pos => {
        createPillar(pos.x, pos.z, wallMaterial);
    });

    // Equipment rooms
    createEquipmentRoom(-40, -30, wallMaterial, floorMaterial);
    createEquipmentRoom(40, -60, wallMaterial, floorMaterial);
    createEquipmentRoom(-40, -90, wallMaterial, floorMaterial);

    // Random rock formations
    createRockFormations();

    // Rails on floor
    createRails();
}

function createTunnel(x, y, z, width, height, depth, wallMat, floorMat, ceilingMat) {
    // Floor
    const floorGeom = new THREE.PlaneGeometry(width, depth);
    const floor = new THREE.Mesh(floorGeom, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(x, y, z);
    floor.receiveShadow = true;
    scene.add(floor);

    // Ceiling
    const ceiling = new THREE.Mesh(floorGeom, ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(x, y + height, z);
    scene.add(ceiling);

    // Left wall
    const wallGeom = new THREE.PlaneGeometry(depth, height);
    const leftWall = new THREE.Mesh(wallGeom, wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(x - width / 2, y + height / 2, z);
    leftWall.receiveShadow = true;
    scene.add(leftWall);
    mineWalls.push({ mesh: leftWall, normal: new THREE.Vector3(1, 0, 0), position: leftWall.position.clone() });

    // Right wall
    const rightWall = new THREE.Mesh(wallGeom, wallMat);
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(x + width / 2, y + height / 2, z);
    rightWall.receiveShadow = true;
    scene.add(rightWall);
    mineWalls.push({ mesh: rightWall, normal: new THREE.Vector3(-1, 0, 0), position: rightWall.position.clone() });
}

function createPillar(x, z, material) {
    const pillarGeom = new THREE.CylinderGeometry(0.5, 0.6, 4, 8);
    const pillar = new THREE.Mesh(pillarGeom, material);
    pillar.position.set(x, 2, z);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    scene.add(pillar);
}

function createEquipmentRoom(x, z, wallMat, floorMat) {
    // Room floor
    const roomFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(15, 15),
        floorMat
    );
    roomFloor.rotation.x = -Math.PI / 2;
    roomFloor.position.set(x, 0, z);
    scene.add(roomFloor);

    // Equipment (simple boxes to represent machinery)
    const equipmentMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.8, roughness: 0.3 });

    // Generator-like object
    const generator = new THREE.Mesh(
        new THREE.BoxGeometry(3, 2, 2),
        equipmentMat
    );
    generator.position.set(x - 3, 1, z);
    generator.castShadow = true;
    scene.add(generator);

    // Control panel
    const panel = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 1.5, 2),
        new THREE.MeshStandardMaterial({ color: 0x333333 })
    );
    panel.position.set(x + 4, 0.75, z);
    scene.add(panel);

    // Blinking light on panel
    const indicatorLight = new THREE.PointLight(0x00ff00, 0.5, 3);
    indicatorLight.position.set(x + 4, 1.5, z);
    scene.add(indicatorLight);
    flickerLights.push({ light: indicatorLight, baseIntensity: 0.5, isIndicator: true });
}

function createRockFormations() {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 1 });

    for (let i = 0; i < 20; i++) {
        const size = 0.3 + Math.random() * 0.7;
        const rock = new THREE.Mesh(
            new THREE.DodecahedronGeometry(size, 0),
            rockMat
        );
        rock.position.set(
            (Math.random() - 0.5) * 6,
            size * 0.5,
            -Math.random() * 150
        );
        rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        rock.castShadow = true;
        scene.add(rock);
    }
}

function createRails() {
    const railMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.9, roughness: 0.3 });

    // Left rail
    const railGeom = new THREE.BoxGeometry(0.1, 0.1, 180);
    const leftRail = new THREE.Mesh(railGeom, railMat);
    leftRail.position.set(-1.5, 0.05, -90);
    scene.add(leftRail);

    // Right rail
    const rightRail = new THREE.Mesh(railGeom, railMat);
    rightRail.position.set(-0.5, 0.05, -90);
    scene.add(rightRail);

    // Cross ties
    for (let z = 0; z > -180; z -= 2) {
        const tie = new THREE.Mesh(
            new THREE.BoxGeometry(2, 0.05, 0.2),
            new THREE.MeshStandardMaterial({ color: 0x4a3728 })
        );
        tie.position.set(-1, 0.02, z);
        scene.add(tie);
    }
}

// ============================================
// PROCEDURAL TEXTURES
// ============================================
function createRockTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Base color
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, 256, 256);

    // Add noise
    for (let i = 0; i < 5000; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const gray = Math.floor(30 + Math.random() * 30);
        ctx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
        ctx.fillRect(x, y, 2, 2);
    }

    // Add cracks
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
        ctx.beginPath();
        ctx.moveTo(Math.random() * 256, Math.random() * 256);
        for (let j = 0; j < 5; j++) {
            ctx.lineTo(
                ctx.canvas.width * Math.random(),
                ctx.canvas.height * Math.random()
            );
        }
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
}

function createFloorTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Dirt base
    ctx.fillStyle = '#3d3428';
    ctx.fillRect(0, 0, 256, 256);

    // Add pebbles and variations
    for (let i = 0; i < 300; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const size = 1 + Math.random() * 4;
        const gray = Math.floor(40 + Math.random() * 30);
        ctx.fillStyle = `rgb(${gray}, ${gray - 5}, ${gray - 10})`;
        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 8);
    return texture;
}

// ============================================
// DUST PARTICLES
// ============================================
function createDustParticles() {
    const particleCount = 500;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 20;
        positions[i + 1] = Math.random() * 4;
        positions[i + 2] = Math.random() * -180;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
        color: 0x888888,
        size: 0.05,
        transparent: true,
        opacity: 0.6
    });

    dustParticles = new THREE.Points(geometry, material);
    scene.add(dustParticles);
}

// ============================================
// CONTROLS
// ============================================
function setupControls() {
    // Pointer lock for mouse control
    const canvas = renderer.domElement;

    canvas.addEventListener('click', () => {
        canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
        isPointerLocked = document.pointerLockElement === canvas;
    });

    // Mouse movement
    document.addEventListener('mousemove', (event) => {
        if (!isPointerLocked) return;

        const movementX = event.movementX || 0;
        const movementY = event.movementY || 0;

        euler.y -= movementX * CONFIG.movement.sensitivity;
        euler.x -= movementY * CONFIG.movement.sensitivity;
        euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));

        camera.quaternion.setFromEuler(euler);
    });

    // Keyboard controls
    document.addEventListener('keydown', (event) => {
        switch (event.code) {
            case 'KeyW':
            case 'ArrowUp':
                moveForward = true;
                break;
            case 'KeyS':
            case 'ArrowDown':
                moveBackward = true;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                moveLeft = true;
                break;
            case 'KeyD':
            case 'ArrowRight':
                moveRight = true;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                isRunning = true;
                break;
            case 'KeyF':
                toggleFlashlight();
                break;
        }
    });

    document.addEventListener('keyup', (event) => {
        switch (event.code) {
            case 'KeyW':
            case 'ArrowUp':
                moveForward = false;
                break;
            case 'KeyS':
            case 'ArrowDown':
                moveBackward = false;
                break;
            case 'KeyA':
            case 'ArrowLeft':
                moveLeft = false;
                break;
            case 'KeyD':
            case 'ArrowRight':
                moveRight = false;
                break;
            case 'ShiftLeft':
            case 'ShiftRight':
                isRunning = false;
                break;
        }
    });

    // Window resize
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// ============================================
// MINIMAP
// ============================================
function setupMinimap() {
    minimapCanvas = document.getElementById('minimap');
    minimapCtx = minimapCanvas.getContext('2d');
}

function updateMinimap() {
    const ctx = minimapCtx;
    const width = minimapCanvas.width;
    const height = minimapCanvas.height;
    const scale = 1.2;

    // Clear
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    // Draw mine layout
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;

    // Main corridor
    ctx.strokeRect(width / 2 - 5, 10, 10, height - 20);

    // Side tunnels
    ctx.strokeRect(width / 2 - 60, 50, 120, 8);
    ctx.strokeRect(width / 2 - 60, 100, 120, 8);
    ctx.strokeRect(width / 2 - 60, 150, 120, 8);

    // Equipment rooms
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(width / 2 - 70, 45, 15, 15);
    ctx.fillRect(width / 2 + 55, 95, 15, 15);
    ctx.fillRect(width / 2 - 70, 145, 15, 15);

    // Draw annotations
    annotations.forEach(ann => {
        const mapX = width / 2 + (ann.position?.x || ann.start?.x || 0) * scale;
        const mapY = 10 - (ann.position?.z || ann.start?.z || 0) * scale;

        ctx.beginPath();
        switch (ann.type) {
            case 'danger':
                ctx.fillStyle = '#ff4444';
                ctx.arc(mapX, mapY, 5, 0, Math.PI * 2);
                ctx.fill();
                break;
            case 'arrow':
                ctx.fillStyle = '#00ffff';
                ctx.arc(mapX, mapY, 4, 0, Math.PI * 2);
                ctx.fill();
                break;
            case 'incident':
                ctx.fillStyle = '#ff8800';
                ctx.arc(mapX, mapY, 4, 0, Math.PI * 2);
                ctx.fill();
                break;
            case 'restricted':
                ctx.fillStyle = 'rgba(255, 0, 255, 0.5)';
                if (ann.vertices && ann.vertices.length > 2) {
                    ctx.beginPath();
                    ctx.moveTo(width / 2 + ann.vertices[0].x * scale, 10 - ann.vertices[0].z * scale);
                    ann.vertices.forEach(v => {
                        ctx.lineTo(width / 2 + v.x * scale, 10 - v.z * scale);
                    });
                    ctx.closePath();
                    ctx.fill();
                }
                break;
        }
    });

    // Draw player position
    const playerMapX = width / 2 + camera.position.x * scale;
    const playerMapY = 10 - camera.position.z * scale;

    // Player direction indicator
    ctx.save();
    ctx.translate(playerMapX, playerMapY);
    ctx.rotate(-euler.y);
    ctx.fillStyle = '#00ff88';
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(-5, 5);
    ctx.lineTo(5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Border
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, width, height);
}

// ============================================
// SOCKET CONNECTION
// ============================================
function connectToServer() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connected to server');

        // Create a room
        socket.emit('create-room', (response) => {
            if (response.success) {
                roomId = response.roomCode;
                document.getElementById('room-code').textContent = roomId;
                console.log('Room created:', roomId);
            }
        });
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        updateControllerStatus(false);
    });

    socket.on('controller-connected', () => {
        console.log('Controller connected');
        updateControllerStatus(true);
        playSound('alert');
    });

    socket.on('controller-disconnected', () => {
        console.log('Controller disconnected');
        updateControllerStatus(false);
    });

    // Handle movement from tablet (motion sensor mode)
    socket.on('movement-update', (data) => {
        handleTabletMovement(data);
    });

    // Handle touch movement from tablet (touch control mode)
    socket.on('touch-movement-update', (data) => {
        handleTouchMovement(data);
    });

    // Handle flashlight toggle from tablet
    socket.on('flashlight-toggle', () => {
        toggleFlashlight();
    });

    // Handle annotations
    socket.on('annotation-added', (annotation) => {
        addAnnotation(annotation);
        updateAnnotationList();
        playSound('alert');
    });

    socket.on('annotation-removed', (data) => {
        removeAnnotation(data.id);
        updateAnnotationList();
    });

    socket.on('annotations-cleared', () => {
        clearAllAnnotations();
        updateAnnotationList();
    });

    // Handle placement requests
    socket.on('get-placement-position', (data) => {
        // Return current camera forward position
        const forward = new THREE.Vector3(0, 0, -5);
        forward.applyQuaternion(camera.quaternion);
        forward.add(camera.position);

        socket.emit('placement-position', {
            roomId: roomId,
            position: { x: forward.x, y: 0, z: forward.z }
        });
    });
}

function updateControllerStatus(connected) {
    const statusEl = document.getElementById('controller-status');
    if (connected) {
        statusEl.className = 'status connected';
        statusEl.innerHTML = '<span class="dot"></span>Connected';
    } else {
        statusEl.className = 'status disconnected';
        statusEl.innerHTML = '<span class="dot"></span>Disconnected';
    }
}

// ============================================
// TABLET MOVEMENT HANDLING
// ============================================
let tabletRotation = { alpha: 0, beta: 0, gamma: 0 };
let tabletSpeed = 0;

// Touch control state
let touchControlData = { forward: 0, right: 0, lookX: 0, lookY: 0 };
let isTouchRunning = false;

function handleTabletMovement(data) {
    tabletRotation = data.rotation;
    tabletSpeed = data.speed || 0;
}

function handleTouchMovement(data) {
    touchControlData = data.movement || { forward: 0, right: 0, lookX: 0, lookY: 0 };
    isTouchRunning = data.isRunning || false;
}

function applyTabletMovement(delta) {
    if (!tabletRotation) return;

    // Apply rotation from tablet
    const targetY = THREE.MathUtils.degToRad(-(tabletRotation.alpha || 0));
    const targetX = THREE.MathUtils.degToRad(Math.max(-45, Math.min(45, tabletRotation.beta - 45)));

    euler.y = THREE.MathUtils.lerp(euler.y, targetY, 0.1);
    euler.x = THREE.MathUtils.lerp(euler.x, targetX, 0.1);
    euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));

    camera.quaternion.setFromEuler(euler);

    // Apply forward movement based on tablet tilt
    if (tabletSpeed > 0.1) {
        const moveSpeed = tabletSpeed * CONFIG.movement.speed * 2;
        direction.z = -1;
        direction.applyQuaternion(camera.quaternion);
        direction.y = 0;
        direction.normalize();

        camera.position.addScaledVector(direction, moveSpeed);
    }
}

function applyTouchMovement(delta) {
    const { forward, right, lookX, lookY } = touchControlData;

    // Apply look rotation
    if (Math.abs(lookX) > 0.01 || Math.abs(lookY) > 0.01) {
        const lookSpeed = 0.03;
        euler.y -= lookX * lookSpeed;
        euler.x -= lookY * lookSpeed;
        euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));
        camera.quaternion.setFromEuler(euler);
    }

    // Apply movement
    if (Math.abs(forward) > 0.01 || Math.abs(right) > 0.01) {
        const speed = CONFIG.movement.speed * (isTouchRunning ? CONFIG.movement.runMultiplier : 1);

        // Forward/backward movement
        const forwardDir = new THREE.Vector3(0, 0, -1);
        forwardDir.applyQuaternion(camera.quaternion);
        forwardDir.y = 0;
        forwardDir.normalize();

        // Right/left movement (strafe)
        const rightDir = new THREE.Vector3(1, 0, 0);
        rightDir.applyQuaternion(camera.quaternion);
        rightDir.y = 0;
        rightDir.normalize();

        // Apply movement
        camera.position.addScaledVector(forwardDir, forward * speed);
        camera.position.addScaledVector(rightDir, right * speed);
    }
}

// ============================================
// ANNOTATIONS
// ============================================
function addAnnotation(annotation) {
    annotations.push(annotation);

    switch (annotation.type) {
        case 'danger':
            createDangerZone(annotation);
            break;
        case 'arrow':
            createArrow(annotation);
            break;
        case 'incident':
            createIncidentMarker(annotation);
            break;
        case 'restricted':
            createRestrictedZone(annotation);
            break;
    }

    updateWarningCount();
}

function removeAnnotation(id) {
    const index = annotations.findIndex(a => a.id === id);
    if (index !== -1) {
        const annotation = annotations[index];
        if (annotation.mesh) {
            scene.remove(annotation.mesh);
            if (annotation.mesh.geometry) annotation.mesh.geometry.dispose();
            if (annotation.mesh.material) annotation.mesh.material.dispose();
        }
        if (annotation.group) {
            scene.remove(annotation.group);
        }
        annotations.splice(index, 1);
    }
    updateWarningCount();
}

function clearAllAnnotations() {
    annotations.forEach(ann => {
        if (ann.mesh) {
            scene.remove(ann.mesh);
        }
        if (ann.group) {
            scene.remove(ann.group);
        }
    });
    annotations = [];
    updateWarningCount();
}

// Danger Zone
function createDangerZone(annotation) {
    const group = new THREE.Group();

    // Main sphere
    const geometry = new THREE.SphereGeometry(annotation.radius || 5, 32, 32);
    const material = new THREE.MeshBasicMaterial({
        color: 0xff0000,
        transparent: true,
        opacity: 0.3,
        side: THREE.DoubleSide
    });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.set(annotation.position.x, annotation.radius / 2, annotation.position.z);
    group.add(sphere);

    // Glowing outline
    const outlineMat = new THREE.MeshBasicMaterial({
        color: 0xff4444,
        transparent: true,
        opacity: 0.5,
        wireframe: true
    });
    const outline = new THREE.Mesh(geometry.clone(), outlineMat);
    outline.position.copy(sphere.position);
    outline.scale.set(1.02, 1.02, 1.02);
    group.add(outline);

    // Label
    const labelSprite = createTextSprite(annotation.label || 'DANGER', '#ff4444');
    labelSprite.position.set(annotation.position.x, annotation.radius + 2, annotation.position.z);
    group.add(labelSprite);

    scene.add(group);
    annotation.group = group;
    annotation.mesh = sphere;
}

// Arrow
function createArrow(annotation) {
    const group = new THREE.Group();

    const start = new THREE.Vector3(annotation.start.x, 1, annotation.start.z);
    const end = new THREE.Vector3(annotation.end.x, 1, annotation.end.z);
    const direction = new THREE.Vector3().subVectors(end, start);
    const length = direction.length();

    // Arrow line
    const lineMat = new THREE.LineBasicMaterial({ color: 0x00ffff, linewidth: 3 });
    const lineGeom = new THREE.BufferGeometry().setFromPoints([start, end]);
    const line = new THREE.Line(lineGeom, lineMat);
    group.add(line);

    // Arrow head
    const arrowHelper = new THREE.ArrowHelper(
        direction.clone().normalize(),
        start,
        length,
        0x00ffff,
        length * 0.2,
        length * 0.1
    );
    group.add(arrowHelper);

    // Label at end
    const labelSprite = createTextSprite(annotation.label || 'Direction', '#00ffff');
    labelSprite.position.set(end.x, 2.5, end.z);
    group.add(labelSprite);

    // Distance label
    const distLabel = createTextSprite(`${length.toFixed(1)}m`, '#ffffff');
    distLabel.position.set((start.x + end.x) / 2, 1.5, (start.z + end.z) / 2);
    group.add(distLabel);

    scene.add(group);
    annotation.group = group;
}

// Incident Marker
function createIncidentMarker(annotation) {
    const group = new THREE.Group();

    // Cone marker
    const coneGeom = new THREE.ConeGeometry(0.5, 1.5, 8);
    const coneMat = new THREE.MeshStandardMaterial({
        color: 0xff8800,
        emissive: 0xff4400,
        emissiveIntensity: 0.3,
        transparent: true,
        opacity: 0.9
    });
    const cone = new THREE.Mesh(coneGeom, coneMat);
    cone.position.set(annotation.position.x, 0.75, annotation.position.z);
    group.add(cone);

    // Info panel
    const severity = annotation.severity || 'medium';
    const severityColors = { low: '#ffff00', medium: '#ff8800', high: '#ff0000' };
    const infoText = `${annotation.date}\n${severity.toUpperCase()}\n${annotation.description?.substring(0, 20) || ''}`;
    const labelSprite = createTextSprite(infoText, severityColors[severity]);
    labelSprite.position.set(annotation.position.x, 2.5, annotation.position.z);
    group.add(labelSprite);

    scene.add(group);
    annotation.group = group;
    annotation.mesh = cone;
}

// Restricted Zone
function createRestrictedZone(annotation) {
    if (!annotation.vertices || annotation.vertices.length < 3) return;

    const group = new THREE.Group();

    // Create fence posts at each vertex
    const postMat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
    annotation.vertices.forEach((vertex, i) => {
        const postGeom = new THREE.CylinderGeometry(0.1, 0.1, 3, 8);
        const post = new THREE.Mesh(postGeom, postMat);
        post.position.set(vertex.x, 1.5, vertex.z);
        group.add(post);

        // Laser fence to next vertex
        const nextVertex = annotation.vertices[(i + 1) % annotation.vertices.length];
        const laserMat = new THREE.LineBasicMaterial({
            color: 0xff00ff,
            transparent: true,
            opacity: 0.8
        });

        for (let h = 0.5; h <= 2.5; h += 0.5) {
            const points = [
                new THREE.Vector3(vertex.x, h, vertex.z),
                new THREE.Vector3(nextVertex.x, h, nextVertex.z)
            ];
            const laserGeom = new THREE.BufferGeometry().setFromPoints(points);
            const laser = new THREE.Line(laserGeom, laserMat);
            group.add(laser);
        }
    });

    // Calculate center for label
    const centerX = annotation.vertices.reduce((sum, v) => sum + v.x, 0) / annotation.vertices.length;
    const centerZ = annotation.vertices.reduce((sum, v) => sum + v.z, 0) / annotation.vertices.length;

    // Floating "RESTRICTED" label
    const labelSprite = createTextSprite('RESTRICTED AREA', '#ff00ff');
    labelSprite.position.set(centerX, 3, centerZ);
    group.add(labelSprite);

    scene.add(group);
    annotation.group = group;
    annotation.centerX = centerX;
    annotation.centerZ = centerZ;
}

// Text Sprite helper
function createTextSprite(text, color) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 512;
    canvas.height = 128;

    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.font = 'Bold 36px Arial';
    context.fillStyle = color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const lines = text.split('\n');
    const lineHeight = 40;
    const startY = canvas.height / 2 - ((lines.length - 1) * lineHeight) / 2;

    lines.forEach((line, i) => {
        context.fillText(line, canvas.width / 2, startY + i * lineHeight);
    });

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(4, 1, 1);

    return sprite;
}

function updateAnnotationList() {
    const list = document.getElementById('annotation-list');
    list.innerHTML = '';

    if (annotations.length === 0) {
        list.innerHTML = '<li class="empty">No annotations</li>';
        return;
    }

    annotations.forEach(ann => {
        const li = document.createElement('li');
        li.className = ann.type;

        let icon = '';
        switch (ann.type) {
            case 'danger': icon = '🚨'; break;
            case 'arrow': icon = '➡️'; break;
            case 'incident': icon = '⚠️'; break;
            case 'restricted': icon = '🚫'; break;
        }

        li.innerHTML = `<span class="icon">${icon}</span><span>${ann.label || ann.description || ann.type}</span>`;
        list.appendChild(li);
    });
}

function updateWarningCount() {
    const count = annotations.filter(a => a.type === 'danger' || a.type === 'restricted').length;
    const countEl = document.getElementById('warnings-value');
    countEl.textContent = count;
    countEl.className = count > 0 ? 'warning-count' : 'warning-count safe';
}

// ============================================
// COLLISION DETECTION
// ============================================
function checkRestrictedZones() {
    const playerPos = camera.position;
    let inRestricted = false;

    annotations.forEach(ann => {
        if (ann.type === 'restricted' && ann.vertices) {
            if (isPointInPolygon(playerPos.x, playerPos.z, ann.vertices)) {
                inRestricted = true;
            }
        }

        // Check danger zone proximity
        if (ann.type === 'danger' && ann.position) {
            const dist = Math.sqrt(
                Math.pow(playerPos.x - ann.position.x, 2) +
                Math.pow(playerPos.z - ann.position.z, 2)
            );
            if (dist < (ann.radius || 5)) {
                showWarning('ENTERING DANGER ZONE');
            }
        }
    });

    if (inRestricted) {
        showWarning('RESTRICTED AREA - TURN BACK');
    }
}

function isPointInPolygon(x, z, vertices) {
    let inside = false;
    for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
        const xi = vertices[i].x, zi = vertices[i].z;
        const xj = vertices[j].x, zj = vertices[j].z;

        if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

let warningTimeout;
function showWarning(text) {
    const warningEl = document.getElementById('warning-flash');
    document.getElementById('warning-text').textContent = text;
    warningEl.classList.remove('hidden');
    playSound('warning');

    clearTimeout(warningTimeout);
    warningTimeout = setTimeout(() => {
        warningEl.classList.add('hidden');
    }, 2000);
}

// ============================================
// AUDIO
// ============================================
function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.log('Audio not available');
    }
}

function playSound(type) {
    if (!audioContext) return;

    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    switch (type) {
        case 'alert':
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.1;
            break;
        case 'warning':
            oscillator.frequency.value = 400;
            oscillator.type = 'sawtooth';
            gainNode.gain.value = 0.15;
            break;
    }

    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3);
    oscillator.stop(audioContext.currentTime + 0.3);
}

// ============================================
// ANIMATION LOOP
// ============================================
function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const time = clock.getElapsedTime();

    // Apply keyboard movement
    if (moveForward || moveBackward || moveLeft || moveRight) {
        const speed = CONFIG.movement.speed * (isRunning ? CONFIG.movement.runMultiplier : 1);

        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();

        if (moveForward || moveBackward) {
            velocity.z = direction.z * speed;
        }
        if (moveLeft || moveRight) {
            velocity.x = direction.x * speed;
        }

        // Apply movement in camera direction
        const moveDir = new THREE.Vector3(velocity.x, 0, velocity.z);
        moveDir.applyQuaternion(camera.quaternion);
        moveDir.y = 0;

        camera.position.add(moveDir);
    }

    // Apply tablet movement (motion sensor mode)
    applyTabletMovement(delta);

    // Apply touch movement (touch control mode)
    applyTouchMovement(delta);

    // Keep camera at proper height
    camera.position.y = CONFIG.camera.height;

    // Bound camera to mine area
    camera.position.x = Math.max(-50, Math.min(50, camera.position.x));
    camera.position.z = Math.max(-170, Math.min(10, camera.position.z));

    // Update dust particles
    if (dustParticles) {
        dustParticles.position.x = camera.position.x;
        dustParticles.position.z = camera.position.z;
        dustParticles.rotation.y += delta * 0.1;
    }

    // Flicker lights
    flickerLights.forEach(fl => {
        if (fl.isIndicator) {
            fl.light.intensity = fl.baseIntensity * (Math.sin(time * 3) > 0 ? 1 : 0.2);
        } else {
            fl.light.intensity = fl.baseIntensity * (0.8 + Math.random() * 0.4);
        }
    });

    // Animate danger zone pulsing
    annotations.forEach(ann => {
        if (ann.type === 'danger' && ann.mesh) {
            const scale = 1 + Math.sin(time * 3) * 0.05;
            ann.mesh.scale.set(scale, scale, scale);
        }
    });

    // Check collisions
    checkRestrictedZones();

    // Update HUD
    updateMinimap();
    updateStatusPanel();

    // Send camera position to server for controller
    if (socket && roomId) {
        socket.emit('camera-position', {
            roomId: roomId,
            position: {
                x: camera.position.x,
                y: camera.position.y,
                z: camera.position.z
            }
        });
    }

    renderer.render(scene, camera);
}

function updateStatusPanel() {
    // Simulate changing values
    const depth = Math.abs(Math.floor(camera.position.z * 0.8 + 150));
    document.getElementById('depth-value').textContent = `-${depth}m`;

    // Oxygen decreases slightly over time
    const oxygen = Math.max(85, 98 - clock.getElapsedTime() * 0.01);
    document.getElementById('oxygen-value').textContent = `${oxygen.toFixed(1)}%`;
    document.getElementById('oxygen-bar').style.width = `${oxygen}%`;

    // Methane varies
    const methane = 0.2 + Math.sin(clock.getElapsedTime() * 0.5) * 0.1;
    document.getElementById('methane-value').textContent = `${methane.toFixed(2)}%`;
    document.getElementById('methane-bar').style.width = `${methane * 20}%`;

    // Temperature varies with depth
    const temp = 28 + depth * 0.02;
    document.getElementById('temp-value').textContent = `${temp.toFixed(1)}°C`;
}

// ============================================
// START
// ============================================
window.addEventListener('DOMContentLoaded', init);
