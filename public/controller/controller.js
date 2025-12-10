// AR Mine Safety Navigation System - Controller Client
// Tablet/Mobile controller with motion sensors

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
    motionUpdateRate: 50, // ms between motion updates
    calibrationDuration: 2000, // ms for calibration
    minSpeed: 0.1, // minimum tilt to register movement
    maxTilt: 45 // maximum tilt angle in degrees
};

// ============================================
// GLOBAL VARIABLES
// ============================================
let socket;
let roomId = null;
let isConnected = false;
let hasMotionPermission = false;
let isCalibrating = false;
let calibrationOffset = { alpha: 0, beta: 0, gamma: 0 };
let currentRotation = { alpha: 0, beta: 0, gamma: 0 };
let currentCameraPosition = { x: 0, y: 0, z: 0 };
let motionInterval = null;

// Restricted zone drawing
let restrictedVertices = [];
let restrictedCanvas, restrictedCtx;

// Touch controls
let controlMode = 'motion'; // 'motion' or 'touch'
let touchMovement = { forward: 0, right: 0, lookX: 0, lookY: 0 };
let isRunning = false;
let touchSpeed = 50;
let touchControlInterval = null;
let activeJoystick = null;
let joystickStartPos = { x: 0, y: 0 };

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    initSocket();
    initEventListeners();
    initMotionSensors();
    initRestrictedCanvas();
    initTouchControls();
    setDefaultDate();
});

function initSocket() {
    socket = io();

    socket.on('connect', () => {
        console.log('Connected to server');
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from server');
        setConnectionStatus(false);
        showToast('Disconnected from server', 'error');
    });

    socket.on('display-disconnected', () => {
        showToast('Display disconnected', 'error');
        setConnectionStatus(false);
    });

    socket.on('camera-position-update', (position) => {
        currentCameraPosition = position;
    });

    socket.on('annotation-added', (annotation) => {
        showToast(`${annotation.type} added successfully`, 'success');
    });

    socket.on('annotations-cleared', () => {
        showToast('All annotations cleared', 'success');
    });
}

function initEventListeners() {
    // Join room
    document.getElementById('join-btn').addEventListener('click', joinRoom);
    document.getElementById('room-code-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') joinRoom();
    });

    // Disconnect
    document.getElementById('disconnect-btn').addEventListener('click', disconnectRoom);

    // Calibration
    document.getElementById('calibrate-btn').addEventListener('click', calibrateMotion);

    // Motion permission (iOS)
    document.getElementById('enable-motion-btn').addEventListener('click', requestMotionPermission);

    // Action buttons
    document.getElementById('danger-btn').addEventListener('click', () => showDangerModal());
    document.getElementById('arrow-btn').addEventListener('click', () => showArrowModal());
    document.getElementById('incident-btn').addEventListener('click', () => showIncidentModal());
    document.getElementById('restricted-btn').addEventListener('click', () => showRestrictedModal());
    document.getElementById('clear-btn').addEventListener('click', () => showClearModal());

    // Danger modal
    document.getElementById('danger-cancel').addEventListener('click', () => hideModal('danger-modal'));
    document.getElementById('danger-confirm').addEventListener('click', addDangerZone);
    document.getElementById('danger-radius').addEventListener('input', (e) => {
        document.getElementById('radius-value').textContent = e.target.value;
    });

    // Arrow modal
    document.getElementById('arrow-cancel').addEventListener('click', () => hideModal('arrow-modal'));
    document.getElementById('arrow-confirm').addEventListener('click', addArrow);
    document.getElementById('arrow-distance').addEventListener('input', (e) => {
        document.getElementById('distance-value').textContent = e.target.value;
    });

    // Incident modal
    document.getElementById('incident-cancel').addEventListener('click', () => hideModal('incident-modal'));
    document.getElementById('incident-confirm').addEventListener('click', addIncident);
    document.querySelectorAll('.severity-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.severity-btn').forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
        });
    });

    // Restricted modal
    document.getElementById('restricted-cancel').addEventListener('click', () => {
        hideModal('restricted-modal');
        restrictedVertices = [];
    });
    document.getElementById('restricted-confirm').addEventListener('click', addRestrictedZone);
    document.getElementById('restricted-clear').addEventListener('click', clearRestrictedPoints);
    document.getElementById('restricted-undo').addEventListener('click', undoRestrictedPoint);

    // Clear modal
    document.getElementById('clear-cancel').addEventListener('click', () => hideModal('clear-modal'));
    document.getElementById('clear-confirm').addEventListener('click', clearAllAnnotations);

    // Placement mode cancel
    document.getElementById('cancel-placement').addEventListener('click', () => {
        document.getElementById('placement-mode').classList.add('hidden');
    });
}

// ============================================
// CONNECTION
// ============================================
function joinRoom() {
    const roomCode = document.getElementById('room-code-input').value.trim();

    if (roomCode.length !== 4 || !/^\d+$/.test(roomCode)) {
        showError('Please enter a valid 4-digit room code');
        return;
    }

    socket.emit('join-room', roomCode, (response) => {
        if (response.success) {
            roomId = roomCode;
            setConnectionStatus(true);
            showToast('Connected to display!', 'success');
            document.getElementById('connected-room').textContent = roomCode;
        } else {
            showError(response.error || 'Failed to join room');
        }
    });
}

function disconnectRoom() {
    socket.disconnect();
    socket.connect();
    roomId = null;
    setConnectionStatus(false);
    stopMotionTracking();
}

function setConnectionStatus(connected) {
    isConnected = connected;
    const statusEl = document.getElementById('connection-status');
    const statusText = document.getElementById('status-text');

    if (connected) {
        statusEl.classList.add('connected');
        statusEl.classList.remove('disconnected');
        statusText.textContent = 'Connected';

        document.getElementById('room-input-container').classList.add('hidden');
        document.getElementById('connected-info').classList.remove('hidden');
        document.getElementById('motion-panel').classList.remove('hidden');
        document.getElementById('actions-panel').classList.remove('hidden');

        startMotionTracking();
    } else {
        statusEl.classList.remove('connected');
        statusEl.classList.add('disconnected');
        statusText.textContent = 'Disconnected';

        document.getElementById('room-input-container').classList.remove('hidden');
        document.getElementById('connected-info').classList.add('hidden');
        document.getElementById('motion-panel').classList.add('hidden');
        document.getElementById('actions-panel').classList.add('hidden');
    }
}

function showError(message) {
    const errorEl = document.getElementById('connection-error');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
    setTimeout(() => errorEl.classList.add('hidden'), 3000);
}

// ============================================
// MOTION SENSORS
// ============================================
function initMotionSensors() {
    // Check if DeviceOrientation is available
    if (typeof DeviceOrientationEvent !== 'undefined') {
        // iOS 13+ requires permission
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            document.getElementById('motion-permission').classList.remove('hidden');
        } else {
            // Non-iOS or older iOS
            hasMotionPermission = true;
            setupMotionListener();
        }
    } else {
        document.getElementById('calibration-status').textContent = 'Motion sensors not available';
    }
}

async function requestMotionPermission() {
    try {
        const response = await DeviceOrientationEvent.requestPermission();
        if (response === 'granted') {
            hasMotionPermission = true;
            document.getElementById('motion-permission').classList.add('hidden');
            setupMotionListener();
            showToast('Motion sensors enabled!', 'success');
        } else {
            showToast('Motion permission denied', 'error');
        }
    } catch (error) {
        console.error('Motion permission error:', error);
        showToast('Motion permission error', 'error');
    }
}

function setupMotionListener() {
    window.addEventListener('deviceorientation', handleMotion, true);
}

function handleMotion(event) {
    if (!hasMotionPermission) return;

    currentRotation = {
        alpha: event.alpha || 0,
        beta: event.beta || 0,
        gamma: event.gamma || 0
    };

    updateMotionVisualizer();
}

function updateMotionVisualizer() {
    const dot = document.getElementById('tilt-dot');
    const indicator = document.getElementById('motion-indicator');

    // Apply calibration offset
    const beta = currentRotation.beta - calibrationOffset.beta;
    const gamma = currentRotation.gamma - calibrationOffset.gamma;

    // Map tilt to position (beta = forward/back, gamma = left/right)
    const maxOffset = indicator.clientWidth / 2 - 15;
    const xOffset = Math.max(-maxOffset, Math.min(maxOffset, (gamma / CONFIG.maxTilt) * maxOffset));
    const yOffset = Math.max(-maxOffset, Math.min(maxOffset, ((beta - 45) / CONFIG.maxTilt) * maxOffset));

    dot.style.transform = `translate(calc(-50% + ${xOffset}px), calc(-50% + ${yOffset}px))`;

    // Calculate speed based on tilt
    const tiltMagnitude = Math.sqrt(Math.pow(beta - 45, 2) + Math.pow(gamma, 2));
    const speed = Math.min(1, Math.max(0, (tiltMagnitude - 5) / CONFIG.maxTilt));

    // Update speed bar
    document.getElementById('speed-fill').style.width = `${speed * 100}%`;
    document.getElementById('speed-value').textContent = `${Math.round(speed * 100)}%`;
}

function startMotionTracking() {
    if (motionInterval) clearInterval(motionInterval);

    motionInterval = setInterval(() => {
        if (!isConnected || !roomId) return;

        // Apply calibration
        const calibratedRotation = {
            alpha: currentRotation.alpha - calibrationOffset.alpha,
            beta: currentRotation.beta - calibrationOffset.beta,
            gamma: currentRotation.gamma - calibrationOffset.gamma
        };

        // Calculate speed from forward tilt
        const forwardTilt = calibratedRotation.beta - 45;
        const speed = Math.min(1, Math.max(0, forwardTilt / CONFIG.maxTilt));

        socket.emit('tablet-movement', {
            roomId: roomId,
            rotation: calibratedRotation,
            speed: speed > CONFIG.minSpeed ? speed : 0
        });
    }, CONFIG.motionUpdateRate);
}

function stopMotionTracking() {
    if (motionInterval) {
        clearInterval(motionInterval);
        motionInterval = null;
    }
}

function calibrateMotion() {
    if (isCalibrating) return;

    isCalibrating = true;
    const statusEl = document.getElementById('calibration-status');
    const btn = document.getElementById('calibrate-btn');

    btn.disabled = true;
    statusEl.textContent = 'Hold tablet flat...';

    setTimeout(() => {
        calibrationOffset = {
            alpha: currentRotation.alpha,
            beta: currentRotation.beta,
            gamma: currentRotation.gamma
        };

        statusEl.textContent = 'Calibrated!';
        btn.disabled = false;
        isCalibrating = false;

        setTimeout(() => {
            statusEl.textContent = '';
        }, 2000);

        showToast('Controls calibrated', 'success');
    }, CONFIG.calibrationDuration);
}

// ============================================
// ANNOTATION MODALS
// ============================================
function showModal(id) {
    document.getElementById(id).classList.remove('hidden');
}

function hideModal(id) {
    document.getElementById(id).classList.add('hidden');
}

function showDangerModal() {
    document.getElementById('danger-label').value = 'Danger Zone';
    document.getElementById('danger-radius').value = 5;
    document.getElementById('radius-value').textContent = '5';
    showModal('danger-modal');
}

function showArrowModal() {
    document.getElementById('arrow-label').value = '';
    document.getElementById('arrow-distance').value = 10;
    document.getElementById('distance-value').textContent = '10';
    showModal('arrow-modal');
}

function showIncidentModal() {
    document.getElementById('incident-description').value = '';
    document.querySelectorAll('.severity-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.severity-btn[data-severity="medium"]').classList.add('active');
    showModal('incident-modal');
}

function showRestrictedModal() {
    restrictedVertices = [];
    updateRestrictedCanvas();
    updateVertexCount();
    showModal('restricted-modal');
}

function showClearModal() {
    showModal('clear-modal');
}

// ============================================
// ADD ANNOTATIONS
// ============================================
function addDangerZone() {
    const label = document.getElementById('danger-label').value || 'Danger Zone';
    const radius = parseInt(document.getElementById('danger-radius').value) || 5;

    socket.emit('add-danger-zone', {
        roomId: roomId,
        position: { ...currentCameraPosition },
        radius: radius,
        label: label
    });

    hideModal('danger-modal');
}

function addArrow() {
    const label = document.getElementById('arrow-label').value || 'Direction';
    const distance = parseInt(document.getElementById('arrow-distance').value) || 10;

    // Calculate end position based on current camera direction
    // For simplicity, we'll create an arrow pointing forward from current position
    const start = { ...currentCameraPosition };
    const end = {
        x: start.x,
        y: start.y,
        z: start.z - distance // Forward is -Z direction
    };

    socket.emit('add-arrow', {
        roomId: roomId,
        start: start,
        end: end,
        label: label
    });

    hideModal('arrow-modal');
}

function addIncident() {
    const date = document.getElementById('incident-date').value;
    const description = document.getElementById('incident-description').value || 'Incident reported';
    const severity = document.querySelector('.severity-btn.active').dataset.severity;

    socket.emit('add-incident', {
        roomId: roomId,
        position: { ...currentCameraPosition },
        date: date,
        description: description,
        severity: severity
    });

    hideModal('incident-modal');
}

function addRestrictedZone() {
    if (restrictedVertices.length < 3) {
        showToast('Need at least 3 points', 'error');
        return;
    }

    // Convert canvas coordinates to world coordinates
    const worldVertices = restrictedVertices.map(v => ({
        x: currentCameraPosition.x + (v.x - 100) * 0.3,
        z: currentCameraPosition.z + (v.y - 100) * 0.3
    }));

    socket.emit('add-restricted-zone', {
        roomId: roomId,
        vertices: worldVertices,
        active: true
    });

    hideModal('restricted-modal');
    restrictedVertices = [];
}

function clearAllAnnotations() {
    socket.emit('clear-annotations', { roomId: roomId });
    hideModal('clear-modal');
}

// ============================================
// RESTRICTED ZONE CANVAS
// ============================================
function initRestrictedCanvas() {
    restrictedCanvas = document.getElementById('restricted-canvas');
    restrictedCtx = restrictedCanvas.getContext('2d');

    restrictedCanvas.addEventListener('click', (e) => {
        const rect = restrictedCanvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        restrictedVertices.push({ x, y });
        updateRestrictedCanvas();
        updateVertexCount();
    });

    // Touch support
    restrictedCanvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        const rect = restrictedCanvas.getBoundingClientRect();
        const touch = e.changedTouches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        restrictedVertices.push({ x, y });
        updateRestrictedCanvas();
        updateVertexCount();
    });
}

function updateRestrictedCanvas() {
    const ctx = restrictedCtx;
    const canvas = restrictedCanvas;

    // Clear
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= canvas.width; i += 20) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, canvas.height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i);
        ctx.lineTo(canvas.width, i);
        ctx.stroke();
    }

    // Draw center cross
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    // Draw polygon
    if (restrictedVertices.length > 0) {
        ctx.fillStyle = 'rgba(255, 0, 255, 0.2)';
        ctx.strokeStyle = '#ff00ff';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(restrictedVertices[0].x, restrictedVertices[0].y);
        restrictedVertices.forEach((v, i) => {
            if (i > 0) ctx.lineTo(v.x, v.y);
        });

        if (restrictedVertices.length > 2) {
            ctx.closePath();
            ctx.fill();
        }
        ctx.stroke();

        // Draw vertices
        restrictedVertices.forEach((v, i) => {
            ctx.fillStyle = '#ff00ff';
            ctx.beginPath();
            ctx.arc(v.x, v.y, 5, 0, Math.PI * 2);
            ctx.fill();

            // Number label
            ctx.fillStyle = '#fff';
            ctx.font = '10px Arial';
            ctx.fillText(i + 1, v.x + 8, v.y - 5);
        });
    }
}

function updateVertexCount() {
    const count = restrictedVertices.length;
    document.getElementById('vertex-count').textContent = `Points: ${count} (minimum 3)`;
    document.getElementById('restricted-confirm').disabled = count < 3;
}

function clearRestrictedPoints() {
    restrictedVertices = [];
    updateRestrictedCanvas();
    updateVertexCount();
}

function undoRestrictedPoint() {
    if (restrictedVertices.length > 0) {
        restrictedVertices.pop();
        updateRestrictedCanvas();
        updateVertexCount();
    }
}

// ============================================
// UTILITIES
// ============================================
function setDefaultDate() {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('incident-date').value = today;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Haptic feedback (if available)
function vibrate(pattern = 50) {
    if (navigator.vibrate) {
        navigator.vibrate(pattern);
    }
}

// Add vibration to buttons
document.querySelectorAll('.action-btn, .primary-btn').forEach(btn => {
    btn.addEventListener('click', () => vibrate());
});

// ============================================
// TOUCH CONTROLS
// ============================================
function initTouchControls() {
    // Control mode toggle
    document.getElementById('mode-motion').addEventListener('click', () => setControlMode('motion'));
    document.getElementById('mode-touch').addEventListener('click', () => setControlMode('touch'));

    // Speed slider
    document.getElementById('touch-speed-slider').addEventListener('input', (e) => {
        touchSpeed = parseInt(e.target.value);
        document.getElementById('touch-speed-value').textContent = `${touchSpeed}%`;
    });

    // Run button
    const runBtn = document.getElementById('run-btn');
    runBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isRunning = true;
        runBtn.classList.add('active');
        vibrate(30);
    });
    runBtn.addEventListener('touchend', () => {
        isRunning = false;
        runBtn.classList.remove('active');
    });
    runBtn.addEventListener('mousedown', () => {
        isRunning = true;
        runBtn.classList.add('active');
    });
    runBtn.addEventListener('mouseup', () => {
        isRunning = false;
        runBtn.classList.remove('active');
    });
    runBtn.addEventListener('mouseleave', () => {
        isRunning = false;
        runBtn.classList.remove('active');
    });

    // Flashlight button
    const flashlightBtn = document.getElementById('flashlight-btn');
    flashlightBtn.addEventListener('click', () => {
        flashlightBtn.classList.toggle('flashlight-on');
        socket.emit('toggle-flashlight', { roomId: roomId });
        vibrate(20);
        const isOn = flashlightBtn.classList.contains('flashlight-on');
        showToast(`Flashlight ${isOn ? 'ON' : 'OFF'}`, 'success');
    });

    // Initialize joysticks
    initJoystick('move-joystick', 'move-stick', handleMoveJoystick);
    initJoystick('look-joystick', 'look-stick', handleLookJoystick);

    // Initialize D-Pad buttons
    initDPadButtons();
}

function setControlMode(mode) {
    controlMode = mode;

    // Update UI
    document.getElementById('mode-motion').classList.toggle('active', mode === 'motion');
    document.getElementById('mode-touch').classList.toggle('active', mode === 'touch');
    document.getElementById('motion-control-mode').classList.toggle('hidden', mode !== 'motion');
    document.getElementById('touch-control-mode').classList.toggle('hidden', mode !== 'touch');

    // Start/stop appropriate tracking
    if (mode === 'motion') {
        stopTouchTracking();
        startMotionTracking();
    } else {
        stopMotionTracking();
        startTouchTracking();
    }

    vibrate(20);
    showToast(`Switched to ${mode} controls`, 'success');
}

function initJoystick(containerId, stickId, moveHandler) {
    const container = document.getElementById(containerId);
    const stick = document.getElementById(stickId);
    const base = container.querySelector('.joystick-base');

    let activeTouchId = null;
    let centerX, centerY, maxDistance;

    function startDrag(touch) {
        if (activeTouchId !== null) return; // Already tracking a touch
        activeTouchId = touch.identifier;
        const rect = base.getBoundingClientRect();
        centerX = rect.left + rect.width / 2;
        centerY = rect.top + rect.height / 2;
        maxDistance = rect.width / 2 - 25; // stick radius
        stick.classList.add('active');
        vibrate(10);
        moveDrag(touch.clientX, touch.clientY);
    }

    function moveDrag(clientX, clientY) {
        let dx = clientX - centerX;
        let dy = clientY - centerY;

        // Limit to circle
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > maxDistance) {
            dx = (dx / distance) * maxDistance;
            dy = (dy / distance) * maxDistance;
        }

        // Move stick
        stick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

        // Normalize values (-1 to 1)
        const normalX = dx / maxDistance;
        const normalY = dy / maxDistance;

        moveHandler(normalX, normalY);
    }

    function endDrag() {
        activeTouchId = null;
        stick.style.transform = 'translate(-50%, -50%)';
        stick.classList.remove('active');
        moveHandler(0, 0);
    }

    // Touch events on the base
    base.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        for (let i = 0; i < e.changedTouches.length; i++) {
            startDrag(e.changedTouches[i]);
        }
    }, { passive: false });

    base.addEventListener('touchmove', (e) => {
        e.preventDefault();
        e.stopPropagation();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            if (touch.identifier === activeTouchId) {
                moveDrag(touch.clientX, touch.clientY);
            }
        }
    }, { passive: false });

    base.addEventListener('touchend', (e) => {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === activeTouchId) {
                endDrag();
            }
        }
    });

    base.addEventListener('touchcancel', (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === activeTouchId) {
                endDrag();
            }
        }
    });

    // Mouse events (for testing on desktop)
    let isMouseDragging = false;

    base.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isMouseDragging = true;
        const rect = base.getBoundingClientRect();
        centerX = rect.left + rect.width / 2;
        centerY = rect.top + rect.height / 2;
        maxDistance = rect.width / 2 - 25;
        stick.classList.add('active');
        moveDrag(e.clientX, e.clientY);
    });

    document.addEventListener('mousemove', (e) => {
        if (!isMouseDragging) return;
        moveDrag(e.clientX, e.clientY);
    });

    document.addEventListener('mouseup', () => {
        if (isMouseDragging) {
            isMouseDragging = false;
            stick.style.transform = 'translate(-50%, -50%)';
            stick.classList.remove('active');
            moveHandler(0, 0);
        }
    });
}

function handleMoveJoystick(x, y) {
    touchMovement.right = x;
    touchMovement.forward = -y; // Invert Y for intuitive control
}

function handleLookJoystick(x, y) {
    touchMovement.lookX = x;
    touchMovement.lookY = y;
}

function initDPadButtons() {
    const dpadBtns = document.querySelectorAll('.dpad-btn');

    dpadBtns.forEach(btn => {
        const action = btn.dataset.action;

        // Touch events
        btn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            handleDPadPress(action, true);
            btn.classList.add('pressed');
            vibrate(15);
        });

        btn.addEventListener('touchend', (e) => {
            e.preventDefault();
            handleDPadPress(action, false);
            btn.classList.remove('pressed');
        });

        btn.addEventListener('touchcancel', () => {
            handleDPadPress(action, false);
            btn.classList.remove('pressed');
        });

        // Mouse events (for testing)
        btn.addEventListener('mousedown', () => {
            handleDPadPress(action, true);
            btn.classList.add('pressed');
        });

        btn.addEventListener('mouseup', () => {
            handleDPadPress(action, false);
            btn.classList.remove('pressed');
        });

        btn.addEventListener('mouseleave', () => {
            handleDPadPress(action, false);
            btn.classList.remove('pressed');
        });
    });
}

function handleDPadPress(action, pressed) {
    const value = pressed ? 1 : 0;

    switch (action) {
        case 'forward':
            touchMovement.forward = value;
            break;
        case 'backward':
            touchMovement.forward = -value;
            break;
        case 'left':
            touchMovement.right = -value;
            break;
        case 'right':
            touchMovement.right = value;
            break;
        case 'stop':
            touchMovement.forward = 0;
            touchMovement.right = 0;
            break;
        case 'look-up':
            touchMovement.lookY = -value;
            break;
        case 'look-down':
            touchMovement.lookY = value;
            break;
        case 'look-left':
            touchMovement.lookX = -value;
            break;
        case 'look-right':
            touchMovement.lookX = value;
            break;
        case 'look-reset':
            touchMovement.lookX = 0;
            touchMovement.lookY = 0;
            break;
    }
}

function startTouchTracking() {
    if (touchControlInterval) clearInterval(touchControlInterval);

    touchControlInterval = setInterval(() => {
        if (!isConnected || !roomId || controlMode !== 'touch') return;

        // Calculate speed multiplier
        const speedMultiplier = (touchSpeed / 100) * (isRunning ? 2 : 1);

        // Send touch movement data
        socket.emit('touch-movement', {
            roomId: roomId,
            movement: {
                forward: touchMovement.forward * speedMultiplier,
                right: touchMovement.right * speedMultiplier,
                lookX: touchMovement.lookX,
                lookY: touchMovement.lookY
            },
            isRunning: isRunning
        });
    }, CONFIG.motionUpdateRate);
}

function stopTouchTracking() {
    if (touchControlInterval) {
        clearInterval(touchControlInterval);
        touchControlInterval = null;
    }
    // Reset movement
    touchMovement = { forward: 0, right: 0, lookX: 0, lookY: 0 };
}
