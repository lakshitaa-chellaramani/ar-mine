const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files from public directory
app.use('/display', express.static(path.join(__dirname, '../public/display')));
app.use('/controller', express.static(path.join(__dirname, '../public/controller')));
app.use('/converter', express.static(path.join(__dirname, '../public/converter')));

// Routes
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>AR Mine Safety Navigation System</title>
            <style>
                body {
                    font-family: 'Segoe UI', Arial, sans-serif;
                    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                    color: #fff;
                    min-height: 100vh;
                    margin: 0;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                .container {
                    text-align: center;
                    padding: 40px;
                    background: rgba(255,255,255,0.1);
                    border-radius: 20px;
                    backdrop-filter: blur(10px);
                }
                h1 {
                    font-size: 2.5em;
                    margin-bottom: 10px;
                }
                p {
                    color: #aaa;
                    margin-bottom: 40px;
                }
                .links {
                    display: flex;
                    gap: 20px;
                    justify-content: center;
                }
                a {
                    display: block;
                    padding: 20px 40px;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    color: white;
                    text-decoration: none;
                    border-radius: 10px;
                    font-size: 1.2em;
                    transition: transform 0.3s, box-shadow 0.3s;
                }
                a:hover {
                    transform: translateY(-5px);
                    box-shadow: 0 10px 30px rgba(102,126,234,0.4);
                }
                .display-link {
                    background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
                }
                .controller-link {
                    background: linear-gradient(135deg, #eb3349 0%, #f45c43 100%);
                }
                .converter-link {
                    background: linear-gradient(135deg, #f97316 0%, #fb923c 100%);
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>AR Mine Safety Navigation</h1>
                <p>Select your device type to get started</p>
                <div class="links">
                    <a href="/display" class="display-link">Laptop Display</a>
                    <a href="/controller" class="controller-link">Tablet Controller</a>
                    <a href="/converter" class="converter-link">Blueprint Converter</a>
                </div>
            </div>
        </body>
        </html>
    `);
});

// Room storage
const rooms = new Map();
const DATA_DIR = path.join(__dirname, '../data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Generate unique 4-digit room code
function generateRoomCode() {
    let code;
    do {
        code = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms.has(code));
    return code;
}

// Save room state to file
function saveRoomState(roomId) {
    const room = rooms.get(roomId);
    if (room) {
        const filePath = path.join(DATA_DIR, `room_${roomId}.json`);
        fs.writeFileSync(filePath, JSON.stringify(room, null, 2));
    }
}

// Load room state from file
function loadRoomState(roomId) {
    const filePath = path.join(DATA_DIR, `room_${roomId}.json`);
    if (fs.existsSync(filePath)) {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
            console.error('Error loading room state:', e);
        }
    }
    return null;
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Create a new room (from display client)
    socket.on('create-room', (callback) => {
        const roomCode = generateRoomCode();
        rooms.set(roomCode, {
            displaySocket: socket.id,
            controllerSocket: null,
            annotations: [],
            createdAt: new Date().toISOString()
        });
        socket.join(roomCode);
        socket.roomId = roomCode;
        socket.deviceType = 'display';

        console.log(`Room created: ${roomCode} by display ${socket.id}`);

        if (callback) callback({ success: true, roomCode });
    });

    // Join an existing room (from controller client)
    socket.on('join-room', (roomCode, callback) => {
        const room = rooms.get(roomCode);

        if (!room) {
            if (callback) callback({ success: false, error: 'Room not found' });
            return;
        }

        room.controllerSocket = socket.id;
        socket.join(roomCode);
        socket.roomId = roomCode;
        socket.deviceType = 'controller';

        // Notify display that controller connected
        io.to(room.displaySocket).emit('controller-connected');

        // Send existing annotations to controller
        if (callback) callback({
            success: true,
            annotations: room.annotations
        });

        console.log(`Controller ${socket.id} joined room ${roomCode}`);
    });

    // Handle tablet movement data (motion sensor mode)
    socket.on('tablet-movement', (data) => {
        const room = rooms.get(data.roomId);
        if (room && room.displaySocket) {
            io.to(room.displaySocket).emit('movement-update', {
                rotation: data.rotation,
                speed: data.speed
            });
        }
    });

    // Handle touch movement data (touch control mode)
    socket.on('touch-movement', (data) => {
        const room = rooms.get(data.roomId);
        if (room && room.displaySocket) {
            io.to(room.displaySocket).emit('touch-movement-update', {
                movement: data.movement,
                isRunning: data.isRunning
            });
        }
    });

    // Handle flashlight toggle
    socket.on('toggle-flashlight', (data) => {
        const room = rooms.get(data.roomId);
        if (room && room.displaySocket) {
            io.to(room.displaySocket).emit('flashlight-toggle');
        }
    });

    // Handle adding danger zone
    socket.on('add-danger-zone', (data) => {
        const room = rooms.get(data.roomId);
        if (room) {
            const annotation = {
                id: `danger_${Date.now()}`,
                type: 'danger',
                position: data.position,
                radius: data.radius || 5,
                label: data.label || 'Danger Zone',
                createdAt: new Date().toISOString()
            };
            room.annotations.push(annotation);
            saveRoomState(data.roomId);

            // Broadcast to all clients in room
            io.to(data.roomId).emit('annotation-added', annotation);
            console.log(`Danger zone added in room ${data.roomId}`);
        }
    });

    // Handle adding directional arrow
    socket.on('add-arrow', (data) => {
        const room = rooms.get(data.roomId);
        if (room) {
            const annotation = {
                id: `arrow_${Date.now()}`,
                type: 'arrow',
                start: data.start,
                end: data.end,
                label: data.label || 'Direction',
                createdAt: new Date().toISOString()
            };
            room.annotations.push(annotation);
            saveRoomState(data.roomId);

            io.to(data.roomId).emit('annotation-added', annotation);
            console.log(`Arrow added in room ${data.roomId}`);
        }
    });

    // Handle adding incident marker
    socket.on('add-incident', (data) => {
        const room = rooms.get(data.roomId);
        if (room) {
            const annotation = {
                id: `incident_${Date.now()}`,
                type: 'incident',
                position: data.position,
                date: data.date || new Date().toISOString().split('T')[0],
                description: data.description || 'Incident reported',
                severity: data.severity || 'medium',
                createdAt: new Date().toISOString()
            };
            room.annotations.push(annotation);
            saveRoomState(data.roomId);

            io.to(data.roomId).emit('annotation-added', annotation);
            console.log(`Incident marker added in room ${data.roomId}`);
        }
    });

    // Handle adding restricted zone
    socket.on('add-restricted-zone', (data) => {
        const room = rooms.get(data.roomId);
        if (room) {
            const annotation = {
                id: `restricted_${Date.now()}`,
                type: 'restricted',
                vertices: data.vertices,
                active: data.active !== undefined ? data.active : true,
                createdAt: new Date().toISOString()
            };
            room.annotations.push(annotation);
            saveRoomState(data.roomId);

            io.to(data.roomId).emit('annotation-added', annotation);
            console.log(`Restricted zone added in room ${data.roomId}`);
        }
    });

    // Handle clearing all annotations
    socket.on('clear-annotations', (data) => {
        const room = rooms.get(data.roomId);
        if (room) {
            room.annotations = [];
            saveRoomState(data.roomId);

            io.to(data.roomId).emit('annotations-cleared');
            console.log(`All annotations cleared in room ${data.roomId}`);
        }
    });

    // Handle removing specific annotation
    socket.on('remove-annotation', (data) => {
        const room = rooms.get(data.roomId);
        if (room) {
            room.annotations = room.annotations.filter(a => a.id !== data.annotationId);
            saveRoomState(data.roomId);

            io.to(data.roomId).emit('annotation-removed', { id: data.annotationId });
            console.log(`Annotation ${data.annotationId} removed in room ${data.roomId}`);
        }
    });

    // Handle camera position update (for placing annotations)
    socket.on('camera-position', (data) => {
        const room = rooms.get(data.roomId);
        if (room && room.controllerSocket) {
            io.to(room.controllerSocket).emit('camera-position-update', data.position);
        }
    });

    // Handle touch position for placing annotations
    socket.on('request-placement', (data) => {
        const room = rooms.get(data.roomId);
        if (room && room.displaySocket) {
            io.to(room.displaySocket).emit('get-placement-position', {
                type: data.type,
                callback: data.callback
            });
        }
    });

    // Handle placement position response
    socket.on('placement-position', (data) => {
        const room = rooms.get(data.roomId);
        if (room && room.controllerSocket) {
            io.to(room.controllerSocket).emit('placement-position-response', data.position);
        }
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);

        if (socket.roomId) {
            const room = rooms.get(socket.roomId);
            if (room) {
                if (socket.deviceType === 'display') {
                    // Display disconnected - notify controller
                    if (room.controllerSocket) {
                        io.to(room.controllerSocket).emit('display-disconnected');
                    }
                    // Keep room for potential reconnection
                    room.displaySocket = null;
                } else if (socket.deviceType === 'controller') {
                    // Controller disconnected - notify display
                    if (room.displaySocket) {
                        io.to(room.displaySocket).emit('controller-disconnected');
                    }
                    room.controllerSocket = null;
                }
            }
        }
    });

    // Handle reconnection
    socket.on('reconnect-room', (data, callback) => {
        const room = rooms.get(data.roomId);
        if (room) {
            if (data.deviceType === 'display' && !room.displaySocket) {
                room.displaySocket = socket.id;
                socket.join(data.roomId);
                socket.roomId = data.roomId;
                socket.deviceType = 'display';

                if (callback) callback({
                    success: true,
                    annotations: room.annotations,
                    hasController: room.controllerSocket !== null
                });
            } else if (data.deviceType === 'controller' && !room.controllerSocket) {
                room.controllerSocket = socket.id;
                socket.join(data.roomId);
                socket.roomId = data.roomId;
                socket.deviceType = 'controller';

                if (room.displaySocket) {
                    io.to(room.displaySocket).emit('controller-connected');
                }

                if (callback) callback({
                    success: true,
                    annotations: room.annotations
                });
            } else {
                if (callback) callback({ success: false, error: 'Device type already connected' });
            }
        } else {
            if (callback) callback({ success: false, error: 'Room not found' });
        }
    });
});

// Start server
server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║       AR Mine Safety Navigation System                    ║
║                                                           ║
║       Server running on port ${PORT}                         ║
║                                                           ║
║       Display:    http://localhost:${PORT}/display           ║
║       Controller: http://localhost:${PORT}/controller        ║
║       Converter:  http://localhost:${PORT}/converter         ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    `);
});
