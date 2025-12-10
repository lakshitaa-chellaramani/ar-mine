// Blueprint to 3D Mine Converter
// Uses OpenCV.js for image processing and Three.js for 3D rendering

// ============================================
// GLOBAL STATE
// ============================================
let cvReady = false;
let uploadedImage = null;
let processedData = null;

// Three.js globals
let scene, camera, renderer, clock;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false;
let isRunning = false;
let velocity = new THREE.Vector3();
let direction = new THREE.Vector3();
let euler = new THREE.Euler(0, 0, 0, 'YXZ');
let isPointerLocked = false;
let minimapCanvas, minimapCtx;
let dustParticles;
let flickerLights = [];
let flashlight;
let isFlashlightOn = true;
let mineData = null;

// Configuration
const CONFIG = {
    camera: { height: 1.7, fov: 75, near: 0.1, far: 1000 },
    movement: { speed: 0.15, runMultiplier: 2, sensitivity: 0.002 },
    fog: { color: 0x0a0a0a, density: 0.015 },
    lighting: { ambient: 0x1a1a1a, point: 0xffaa44 }
};

// ============================================
// OPENCV READY CALLBACK
// ============================================
function onOpenCvReady() {
    cvReady = true;
    console.log('OpenCV.js is ready');
}

// ============================================
// DOM READY INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    setupUploadHandlers();
    setupSettingsHandlers();
    setupActionHandlers();
});

// ============================================
// FILE UPLOAD HANDLING
// ============================================
function setupUploadHandlers() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    // Drag and drop events
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });

    // Click to browse
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    // Change file button
    document.getElementById('change-file').addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
    });
}

function handleFile(file) {
    // Validate file type
    if (!file.type.startsWith('image/')) {
        alert('Please upload an image file (PNG, JPG, JPEG)');
        return;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
        alert('File size must be less than 10MB');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        uploadedImage = new Image();
        uploadedImage.onload = () => {
            showPreview();
            processImage();
        };
        uploadedImage.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function showPreview() {
    document.getElementById('drop-zone').style.display = 'none';
    document.getElementById('preview-section').classList.remove('hidden');

    // Draw original image
    const originalCanvas = document.getElementById('original-canvas');
    const ctx = originalCanvas.getContext('2d');

    // Scale to fit
    const maxSize = 400;
    const scale = Math.min(maxSize / uploadedImage.width, maxSize / uploadedImage.height);
    originalCanvas.width = uploadedImage.width * scale;
    originalCanvas.height = uploadedImage.height * scale;

    ctx.drawImage(uploadedImage, 0, 0, originalCanvas.width, originalCanvas.height);
}

// ============================================
// IMAGE PROCESSING WITH OPENCV
// ============================================
function processImage() {
    if (!cvReady) {
        setTimeout(processImage, 100);
        return;
    }

    const threshold = parseInt(document.getElementById('threshold-slider').value);

    try {
        // Create cv.Mat from original canvas
        const originalCanvas = document.getElementById('original-canvas');
        let src = cv.imread(originalCanvas);
        let dst = new cv.Mat();
        let gray = new cv.Mat();
        let edges = new cv.Mat();
        let lines = new cv.Mat();
        let contours = new cv.MatVector();
        let hierarchy = new cv.Mat();

        // Convert to grayscale
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

        // Apply Gaussian blur to reduce noise
        cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);

        // Apply Canny edge detection
        cv.Canny(gray, edges, threshold * 0.5, threshold, 3, false);

        // Dilate edges to connect broken lines
        let kernel = cv.Mat.ones(3, 3, cv.CV_8U);
        cv.dilate(edges, edges, kernel);

        // Find contours for room detection
        cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

        // Detect lines using Hough Transform
        cv.HoughLinesP(edges, lines, 1, Math.PI / 180, 50, 30, 10);

        // Process detected walls and rooms
        processedData = extractMineData(lines, contours, originalCanvas.width, originalCanvas.height);

        // Draw processed result
        const processedCanvas = document.getElementById('processed-canvas');
        processedCanvas.width = originalCanvas.width;
        processedCanvas.height = originalCanvas.height;

        // Create output image
        dst = cv.Mat.zeros(src.rows, src.cols, cv.CV_8UC3);

        // Draw detected walls (lines)
        for (let i = 0; i < lines.rows; i++) {
            let startPoint = new cv.Point(lines.data32S[i * 4], lines.data32S[i * 4 + 1]);
            let endPoint = new cv.Point(lines.data32S[i * 4 + 2], lines.data32S[i * 4 + 3]);
            cv.line(dst, startPoint, endPoint, [0, 255, 0, 255], 2);
        }

        // Draw contours (rooms)
        for (let i = 0; i < contours.size(); i++) {
            let color = new cv.Scalar(255, 128, 0);
            cv.drawContours(dst, contours, i, color, 1, cv.LINE_8, hierarchy, 0);
        }

        cv.imshow('processed-canvas', dst);

        // Update info display
        document.getElementById('wall-count').textContent = processedData.walls.length;
        document.getElementById('rooms-count').textContent = processedData.rooms.length;

        // Cleanup
        src.delete();
        dst.delete();
        gray.delete();
        edges.delete();
        lines.delete();
        contours.delete();
        hierarchy.delete();
        kernel.delete();

    } catch (err) {
        console.error('OpenCV processing error:', err);
        // Fallback: create simple grid-based mine
        processedData = createFallbackMineData();
    }
}

function extractMineData(lines, contours, width, height) {
    const walls = [];
    const rooms = [];
    const scale = parseFloat(document.getElementById('scale-slider').value);
    const wallHeight = parseFloat(document.getElementById('height-slider').value);

    // Normalize coordinates to world space
    // Center the blueprint at origin, scale appropriately
    const worldScale = 0.5 * scale; // pixels to meters
    const offsetX = width / 2;
    const offsetY = height / 2;

    // Extract walls from lines
    for (let i = 0; i < lines.rows; i++) {
        const x1 = (lines.data32S[i * 4] - offsetX) * worldScale;
        const z1 = (lines.data32S[i * 4 + 1] - offsetY) * worldScale;
        const x2 = (lines.data32S[i * 4 + 2] - offsetX) * worldScale;
        const z2 = (lines.data32S[i * 4 + 3] - offsetY) * worldScale;

        // Filter very short segments
        const length = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(z2 - z1, 2));
        if (length > 1) {
            walls.push({
                start: { x: x1, z: z1 },
                end: { x: x2, z: z2 },
                height: wallHeight,
                length: length
            });
        }
    }

    // Extract rooms from contours
    for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);

        // Filter small contours
        if (area > 500) {
            const rect = cv.boundingRect(contour);
            const roomWidth = rect.width * worldScale;
            const roomDepth = rect.height * worldScale;
            const roomCenterX = (rect.x + rect.width / 2 - offsetX) * worldScale;
            const roomCenterZ = (rect.y + rect.height / 2 - offsetY) * worldScale;

            if (roomWidth > 2 && roomDepth > 2) {
                rooms.push({
                    center: { x: roomCenterX, z: roomCenterZ },
                    width: roomWidth,
                    depth: roomDepth,
                    area: roomWidth * roomDepth
                });
            }
        }
    }

    // Calculate total area
    const totalArea = rooms.reduce((sum, room) => sum + room.area, 0);
    document.getElementById('total-area').textContent = `${totalArea.toFixed(1)} m²`;

    // Calculate bounds for minimap and navigation limits
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    walls.forEach(wall => {
        minX = Math.min(minX, wall.start.x, wall.end.x);
        maxX = Math.max(maxX, wall.start.x, wall.end.x);
        minZ = Math.min(minZ, wall.start.z, wall.end.z);
        maxZ = Math.max(maxZ, wall.start.z, wall.end.z);
    });

    return {
        walls,
        rooms,
        bounds: { minX, maxX, minZ, maxZ },
        wallHeight,
        imageWidth: width,
        imageHeight: height
    };
}

function createFallbackMineData() {
    // Create a simple mine layout when OpenCV fails
    const scale = parseFloat(document.getElementById('scale-slider').value);
    const wallHeight = parseFloat(document.getElementById('height-slider').value);

    const walls = [
        // Main corridor
        { start: { x: -4, z: 0 }, end: { x: -4, z: -80 }, height: wallHeight },
        { start: { x: 4, z: 0 }, end: { x: 4, z: -80 }, height: wallHeight },
        // End wall
        { start: { x: -4, z: -80 }, end: { x: 4, z: -80 }, height: wallHeight },
        // Side tunnels
        { start: { x: -4, z: -20 }, end: { x: -25, z: -20 }, height: wallHeight },
        { start: { x: -4, z: -25 }, end: { x: -25, z: -25 }, height: wallHeight },
        { start: { x: -25, z: -20 }, end: { x: -25, z: -25 }, height: wallHeight },
        // Right tunnel
        { start: { x: 4, z: -40 }, end: { x: 25, z: -40 }, height: wallHeight },
        { start: { x: 4, z: -45 }, end: { x: 25, z: -45 }, height: wallHeight },
        { start: { x: 25, z: -40 }, end: { x: 25, z: -45 }, height: wallHeight },
    ];

    const rooms = [
        { center: { x: 0, z: -40 }, width: 8, depth: 80, area: 640 },
        { center: { x: -15, z: -22.5 }, width: 21, depth: 5, area: 105 },
        { center: { x: 15, z: -42.5 }, width: 21, depth: 5, area: 105 },
    ];

    document.getElementById('total-area').textContent = '850 m²';
    document.getElementById('wall-count').textContent = walls.length;
    document.getElementById('rooms-count').textContent = rooms.length;

    return {
        walls: walls.map(w => ({ ...w, length: Math.sqrt(Math.pow(w.end.x - w.start.x, 2) + Math.pow(w.end.z - w.start.z, 2)) })),
        rooms,
        bounds: { minX: -25, maxX: 25, minZ: -80, maxZ: 0 },
        wallHeight
    };
}

// ============================================
// SETTINGS HANDLERS
// ============================================
function setupSettingsHandlers() {
    const thresholdSlider = document.getElementById('threshold-slider');
    const heightSlider = document.getElementById('height-slider');
    const scaleSlider = document.getElementById('scale-slider');

    thresholdSlider.addEventListener('input', (e) => {
        document.getElementById('threshold-value').textContent = e.target.value;
        if (uploadedImage) processImage();
    });

    heightSlider.addEventListener('input', (e) => {
        document.getElementById('height-value').textContent = e.target.value + 'm';
    });

    scaleSlider.addEventListener('input', (e) => {
        document.getElementById('scale-value').textContent = e.target.value + 'x';
        if (uploadedImage) processImage();
    });
}

// ============================================
// ACTION HANDLERS
// ============================================
function setupActionHandlers() {
    document.getElementById('generate-btn').addEventListener('click', generate3DEnvironment);
    document.getElementById('back-btn').addEventListener('click', backToUpload);
    document.getElementById('fullscreen-btn').addEventListener('click', toggleFullscreen);
    document.getElementById('export-btn').addEventListener('click', exportMineData);
}

function backToUpload() {
    document.getElementById('viewer-container').classList.add('hidden');
    document.getElementById('upload-panel').classList.remove('hidden');

    // Reset Three.js
    if (renderer) {
        renderer.dispose();
        document.getElementById('canvas-container').innerHTML = '';
    }
    scene = null;
    camera = null;
    renderer = null;
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

function exportMineData() {
    if (!processedData) return;

    const exportData = {
        name: 'Generated Mine',
        version: '1.0',
        generatedAt: new Date().toISOString(),
        settings: {
            wallHeight: parseFloat(document.getElementById('height-slider').value),
            scale: parseFloat(document.getElementById('scale-slider').value)
        },
        walls: processedData.walls,
        rooms: processedData.rooms,
        bounds: processedData.bounds
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mine_layout_${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================
// 3D ENVIRONMENT GENERATION
// ============================================
function generate3DEnvironment() {
    if (!processedData) {
        alert('Please upload and process a blueprint first');
        return;
    }

    // Show processing overlay
    const overlay = document.getElementById('processing-overlay');
    const progressFill = document.getElementById('progress-fill');
    const statusText = document.getElementById('processing-status');
    overlay.classList.remove('hidden');
    progressFill.style.width = '0%';

    // Simulate progress
    const steps = [
        { progress: 20, status: 'Creating 3D scene...' },
        { progress: 40, status: 'Building walls and floors...' },
        { progress: 60, status: 'Setting up lighting...' },
        { progress: 80, status: 'Adding particles and effects...' },
        { progress: 100, status: 'Finalizing environment...' }
    ];

    let stepIndex = 0;
    const progressInterval = setInterval(() => {
        if (stepIndex < steps.length) {
            progressFill.style.width = steps[stepIndex].progress + '%';
            statusText.textContent = steps[stepIndex].status;
            stepIndex++;
        } else {
            clearInterval(progressInterval);
            setTimeout(() => {
                overlay.classList.add('hidden');
                document.getElementById('upload-panel').classList.add('hidden');
                document.getElementById('viewer-container').classList.remove('hidden');
                init3DScene();
            }, 300);
        }
    }, 400);
}

// ============================================
// THREE.JS 3D SCENE
// ============================================
function init3DScene() {
    mineData = processedData;

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

    // Start at center of mine
    const startZ = mineData.bounds ? (mineData.bounds.maxZ + mineData.bounds.minZ) / 2 : 0;
    camera.position.set(0, CONFIG.camera.height, startZ + 5);

    // Renderer setup
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.getElementById('canvas-container').appendChild(renderer.domElement);

    clock = new THREE.Clock();

    // Build the mine
    createLighting();
    createFlashlight();
    createMineFromData();

    if (document.getElementById('add-dust').checked) {
        createDustParticles();
    }

    // Setup controls
    setupControls();
    setupMinimap();

    // Start animation loop
    animate();
}

function createLighting() {
    // Ambient light (very dim)
    const ambient = new THREE.AmbientLight(CONFIG.lighting.ambient, 0.3);
    scene.add(ambient);

    if (!document.getElementById('add-lights').checked) return;

    // Generate lights based on room positions
    const lightPositions = [];

    if (mineData.rooms && mineData.rooms.length > 0) {
        mineData.rooms.forEach(room => {
            lightPositions.push({ x: room.center.x, y: 3, z: room.center.z });
        });
    }

    // Add lights along bounds
    if (mineData.bounds) {
        const { minX, maxX, minZ, maxZ } = mineData.bounds;
        const midX = (minX + maxX) / 2;
        const midZ = (minZ + maxZ) / 2;

        // Add perimeter lights
        lightPositions.push({ x: midX, y: 3, z: minZ + 5 });
        lightPositions.push({ x: midX, y: 3, z: maxZ - 5 });
        lightPositions.push({ x: midX, y: 3, z: midZ });
    }

    // Fallback lights
    if (lightPositions.length === 0) {
        lightPositions.push(
            { x: 0, y: 3, z: -15 },
            { x: 0, y: 3, z: -30 },
            { x: 0, y: 3, z: -45 }
        );
    }

    lightPositions.forEach(pos => {
        const light = new THREE.PointLight(CONFIG.lighting.point, 1, 30);
        light.position.set(pos.x, pos.y, pos.z);
        light.castShadow = true;
        light.shadow.mapSize.width = 512;
        light.shadow.mapSize.height = 512;
        scene.add(light);

        // Light fixture mesh
        const fixtureGeom = new THREE.CylinderGeometry(0.1, 0.2, 0.3, 8);
        const fixtureMat = new THREE.MeshBasicMaterial({ color: 0xffaa44 });
        const fixture = new THREE.Mesh(fixtureGeom, fixtureMat);
        fixture.position.set(pos.x, pos.y + 0.3, pos.z);
        scene.add(fixture);

        flickerLights.push({ light, baseIntensity: 1 });
    });
}

function createFlashlight() {
    flashlight = new THREE.SpotLight(0xffffff, 2, 50, Math.PI / 6, 0.3, 1);
    flashlight.position.set(0, 0, 0);
    flashlight.castShadow = true;
    flashlight.shadow.mapSize.width = 1024;
    flashlight.shadow.mapSize.height = 1024;

    const flashlightTarget = new THREE.Object3D();
    flashlightTarget.position.set(0, 0, -1);
    scene.add(flashlightTarget);
    flashlight.target = flashlightTarget;

    camera.add(flashlight);
    flashlight.position.set(0.3, -0.2, 0);

    scene.add(camera);

    // Player light
    const playerLight = new THREE.PointLight(0xffffee, 0.5, 8);
    playerLight.position.set(0, 0, 0);
    camera.add(playerLight);

    // Flashlight beam
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
    camera.children.forEach(child => {
        if (child.type === 'Mesh') {
            child.visible = isFlashlightOn;
        }
    });
}

function createMineFromData() {
    // Create textures
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

    // Create floor and ceiling based on bounds
    if (mineData.bounds) {
        const { minX, maxX, minZ, maxZ } = mineData.bounds;
        const width = maxX - minX + 20;
        const depth = maxZ - minZ + 20;
        const centerX = (minX + maxX) / 2;
        const centerZ = (minZ + maxZ) / 2;

        // Floor
        const floorGeom = new THREE.PlaneGeometry(width, depth);
        const floor = new THREE.Mesh(floorGeom, floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.set(centerX, 0, centerZ);
        floor.receiveShadow = true;
        scene.add(floor);

        // Ceiling
        const ceiling = new THREE.Mesh(floorGeom, ceilingMaterial);
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.set(centerX, mineData.wallHeight, centerZ);
        scene.add(ceiling);
    }

    // Create walls from processed data
    mineData.walls.forEach(wall => {
        createWallSegment(wall, wallMaterial);
    });

    // Create pillars at room corners
    mineData.rooms.forEach(room => {
        createRoomPillars(room, wallMaterial);
    });

    // Add rock formations
    createRockFormations();

    // Add rails
    createRails();
}

function createWallSegment(wall, material) {
    const dx = wall.end.x - wall.start.x;
    const dz = wall.end.z - wall.start.z;
    const length = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dx, dz);

    const wallGeom = new THREE.BoxGeometry(0.3, wall.height, length);
    const wallMesh = new THREE.Mesh(wallGeom, material);

    const centerX = (wall.start.x + wall.end.x) / 2;
    const centerZ = (wall.start.z + wall.end.z) / 2;

    wallMesh.position.set(centerX, wall.height / 2, centerZ);
    wallMesh.rotation.y = angle;
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;

    scene.add(wallMesh);
}

function createRoomPillars(room, material) {
    const pillarPositions = [
        { x: room.center.x - room.width / 4, z: room.center.z - room.depth / 4 },
        { x: room.center.x + room.width / 4, z: room.center.z - room.depth / 4 },
        { x: room.center.x - room.width / 4, z: room.center.z + room.depth / 4 },
        { x: room.center.x + room.width / 4, z: room.center.z + room.depth / 4 },
    ];

    pillarPositions.forEach(pos => {
        // Only add pillar 30% of the time for variety
        if (Math.random() > 0.7) {
            const pillarGeom = new THREE.CylinderGeometry(0.4, 0.5, mineData.wallHeight, 8);
            const pillar = new THREE.Mesh(pillarGeom, material);
            pillar.position.set(pos.x, mineData.wallHeight / 2, pos.z);
            pillar.castShadow = true;
            pillar.receiveShadow = true;
            scene.add(pillar);
        }
    });
}

function createRockFormations() {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 1 });

    if (!mineData.bounds) return;

    const { minX, maxX, minZ, maxZ } = mineData.bounds;

    for (let i = 0; i < 30; i++) {
        const size = 0.2 + Math.random() * 0.5;
        const rock = new THREE.Mesh(
            new THREE.DodecahedronGeometry(size, 0),
            rockMat
        );
        rock.position.set(
            minX + Math.random() * (maxX - minX),
            size * 0.5,
            minZ + Math.random() * (maxZ - minZ)
        );
        rock.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        rock.castShadow = true;
        scene.add(rock);
    }
}

function createRails() {
    const railMat = new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.9, roughness: 0.3 });

    if (!mineData.bounds) return;

    const { minZ, maxZ } = mineData.bounds;
    const railLength = maxZ - minZ;

    // Left rail
    const railGeom = new THREE.BoxGeometry(0.1, 0.1, railLength);
    const leftRail = new THREE.Mesh(railGeom, railMat);
    leftRail.position.set(-1.5, 0.05, (minZ + maxZ) / 2);
    scene.add(leftRail);

    // Right rail
    const rightRail = new THREE.Mesh(railGeom, railMat);
    rightRail.position.set(-0.5, 0.05, (minZ + maxZ) / 2);
    scene.add(rightRail);

    // Cross ties
    for (let z = minZ; z < maxZ; z += 2) {
        const tie = new THREE.Mesh(
            new THREE.BoxGeometry(2, 0.05, 0.2),
            new THREE.MeshStandardMaterial({ color: 0x4a3728 })
        );
        tie.position.set(-1, 0.02, z);
        scene.add(tie);
    }
}

function createRockTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 5000; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const gray = Math.floor(30 + Math.random() * 30);
        ctx.fillStyle = `rgb(${gray}, ${gray}, ${gray})`;
        ctx.fillRect(x, y, 2, 2);
    }

    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
        ctx.beginPath();
        ctx.moveTo(Math.random() * 256, Math.random() * 256);
        for (let j = 0; j < 5; j++) {
            ctx.lineTo(Math.random() * 256, Math.random() * 256);
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

    ctx.fillStyle = '#3d3428';
    ctx.fillRect(0, 0, 256, 256);

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

function createDustParticles() {
    if (!mineData.bounds) return;

    const { minX, maxX, minZ, maxZ } = mineData.bounds;
    const particleCount = 500;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount * 3; i += 3) {
        positions[i] = minX + Math.random() * (maxX - minX);
        positions[i + 1] = Math.random() * mineData.wallHeight;
        positions[i + 2] = minZ + Math.random() * (maxZ - minZ);
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
    const canvas = renderer.domElement;

    canvas.addEventListener('click', () => {
        canvas.requestPointerLock();
    });

    document.addEventListener('pointerlockchange', () => {
        isPointerLocked = document.pointerLockElement === canvas;
    });

    document.addEventListener('mousemove', (event) => {
        if (!isPointerLocked) return;

        const movementX = event.movementX || 0;
        const movementY = event.movementY || 0;

        euler.y -= movementX * CONFIG.movement.sensitivity;
        euler.x -= movementY * CONFIG.movement.sensitivity;
        euler.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, euler.x));

        camera.quaternion.setFromEuler(euler);
    });

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
            case 'Escape':
                document.exitPointerLock();
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
    if (!minimapCtx || !mineData) return;

    const ctx = minimapCtx;
    const width = minimapCanvas.width;
    const height = minimapCanvas.height;

    // Clear
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);

    if (!mineData.bounds) return;

    const { minX, maxX, minZ, maxZ } = mineData.bounds;
    const scaleX = (width - 20) / (maxX - minX);
    const scaleZ = (height - 20) / (maxZ - minZ);
    const scale = Math.min(scaleX, scaleZ);

    const offsetX = width / 2;
    const offsetZ = height / 2;

    // Draw walls
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 2;
    mineData.walls.forEach(wall => {
        ctx.beginPath();
        ctx.moveTo(
            offsetX + wall.start.x * scale,
            offsetZ - wall.start.z * scale
        );
        ctx.lineTo(
            offsetX + wall.end.x * scale,
            offsetZ - wall.end.z * scale
        );
        ctx.stroke();
    });

    // Draw rooms
    ctx.fillStyle = 'rgba(42, 42, 42, 0.5)';
    mineData.rooms.forEach(room => {
        ctx.fillRect(
            offsetX + (room.center.x - room.width / 2) * scale,
            offsetZ - (room.center.z + room.depth / 2) * scale,
            room.width * scale,
            room.depth * scale
        );
    });

    // Draw player
    const playerMapX = offsetX + camera.position.x * scale;
    const playerMapZ = offsetZ - camera.position.z * scale;

    ctx.save();
    ctx.translate(playerMapX, playerMapZ);
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
// ANIMATION LOOP
// ============================================
function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    const time = clock.getElapsedTime();

    // Apply movement
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

        const moveDir = new THREE.Vector3(velocity.x, 0, velocity.z);
        moveDir.applyQuaternion(camera.quaternion);
        moveDir.y = 0;

        camera.position.add(moveDir);
    }

    // Keep camera at proper height
    camera.position.y = CONFIG.camera.height;

    // Bound camera to mine area
    if (mineData && mineData.bounds) {
        const { minX, maxX, minZ, maxZ } = mineData.bounds;
        camera.position.x = Math.max(minX - 5, Math.min(maxX + 5, camera.position.x));
        camera.position.z = Math.max(minZ - 5, Math.min(maxZ + 5, camera.position.z));
    }

    // Update dust particles
    if (dustParticles) {
        dustParticles.position.x = camera.position.x;
        dustParticles.position.z = camera.position.z;
        dustParticles.rotation.y += delta * 0.1;
    }

    // Flicker lights
    flickerLights.forEach(fl => {
        fl.light.intensity = fl.baseIntensity * (0.8 + Math.random() * 0.4);
    });

    // Update minimap
    updateMinimap();

    renderer.render(scene, camera);
}
