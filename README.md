# AR Mine Safety Navigation System

A real-time AR mine safety navigation system where a **laptop displays a 3D underground mine environment** and a **tablet acts as a wireless controller** to add safety annotations, navigate, and mark hazards.

## Demo Video Preview

![AR Mine System](https://img.shields.io/badge/Status-Ready%20for%20Demo-brightgreen)
![Node.js](https://img.shields.io/badge/Node.js-18+-green)
![Three.js](https://img.shields.io/badge/Three.js-r128-blue)
![Socket.IO](https://img.shields.io/badge/Socket.IO-4.x-purple)

## System Architecture

```
TABLET (Controller) ←→ SERVER (WebSocket Bridge) ←→ LAPTOP (3D Display)
```

### Three Components:
1. **Server** (Node.js + Express + Socket.IO) - WebSocket bridge
2. **Laptop Display** (Three.js + WebGL) - 3D mine visualization with AR overlays
3. **Tablet Controller** (HTML5 + Touch/Motion APIs) - Wireless input device

## Features

### 3D Mine Environment
- Realistic underground mine with corridors and tunnels
- Dynamic lighting with flickering effects
- Dust particle system
- First-person navigation
- Procedurally generated textures

### AR Safety Overlays
- **Danger Zones**: Red pulsing spheres marking hazardous areas
- **Directional Arrows**: Cyan arrows pointing to equipment/exits
- **Incident Markers**: Orange cones marking historical incident locations
- **Restricted Zones**: Laser-fence boundaries preventing entry

### HUD Elements
- Real-time minimap with player position
- Status panel (depth, O2, methane, temperature)
- Warning count indicator
- Connection status display
- Active annotation list

### Tablet Controller
- Device motion control (tilt to navigate)
- Touch-based annotation placement
- Quick action buttons for all annotation types
- Calibration system for accurate control

## Quick Start

### Prerequisites
- Node.js v18 or higher
- Modern web browser (Chrome, Firefox, Safari)
- Tablet/mobile device (for controller)

### Installation

```bash
# Clone or navigate to project directory
cd ar_mine

# Install dependencies
npm install

# Start the server
npm start
```

### Access the Application

1. **Laptop Display**: Open http://localhost:3000/display
2. **Tablet Controller**: Open http://localhost:3000/controller

### Connecting Devices

1. Note the 4-digit room code displayed on the laptop
2. Enter the code on the tablet controller
3. Tap "JOIN" to connect
4. Start navigating!

## Usage Guide

### Navigation Controls

**Keyboard (Laptop fallback):**
- `W` / `↑` : Move forward
- `S` / `↓` : Move backward
- `A` / `←` : Strafe left
- `D` / `→` : Strafe right
- `Shift` : Run
- `Mouse` : Look around (click to lock)

**Tablet:**
- Tilt forward: Move forward
- Tilt left/right: Turn
- Speed is controlled by tilt angle

### Adding Annotations

1. **Danger Zone**
   - Tap the red "Danger Zone" button
   - Enter a label and set radius
   - Tap "Add Danger Zone"
   - Marker appears at current camera position

2. **Directional Arrow**
   - Tap the cyan "Add Arrow" button
   - Enter a label and set distance
   - Arrow points forward from current position

3. **Incident Marker**
   - Tap the orange "Incident" button
   - Fill in date, description, and severity
   - Marker placed at current position

4. **Restricted Zone**
   - Tap the purple "Restricted" button
   - Tap on the canvas to add polygon vertices (min 3)
   - Tap "Create Zone" to confirm

5. **Clear All**
   - Tap "Clear All Annotations" to remove everything

## Network Setup for Demo

### Local Network (Same WiFi)

Both devices must be on the same network.

1. Find your laptop's IP address:
   ```bash
   # macOS/Linux
   ifconfig | grep "inet "

   # Windows
   ipconfig
   ```

2. On the tablet, navigate to:
   ```
   http://YOUR_LAPTOP_IP:3000/controller
   ```

### Remote Access (ngrok)

For demos across different networks:

```bash
# Install ngrok
npm install -g ngrok

# Expose local server
ngrok http 3000
```

Use the provided public URL on the tablet.

## Project Structure

```
ar_mine/
├── server/
│   └── server.js              # Express + Socket.IO server
├── public/
│   ├── display/
│   │   ├── index.html         # Laptop 3D view
│   │   ├── display.js         # Mine visualization
│   │   └── styles.css         # Display styles
│   └── controller/
│       ├── index.html         # Tablet controller
│       ├── controller.js      # Input handling
│       └── styles.css         # Controller styles
├── data/                      # Room state persistence
├── package.json
└── README.md
```

## Technical Details

### Server Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `create-room` | Display → Server | Create new room |
| `join-room` | Controller → Server | Join existing room |
| `tablet-movement` | Controller → Display | Motion data |
| `add-danger-zone` | Controller → Display | Place danger marker |
| `add-arrow` | Controller → Display | Place directional arrow |
| `add-incident` | Controller → Display | Place incident marker |
| `add-restricted-zone` | Controller → Display | Create restricted area |
| `clear-annotations` | Controller → Display | Remove all markers |

### Browser Requirements

- WebGL 2.0 support
- DeviceOrientation API (for tablet motion)
- WebSocket support
- ES6+ JavaScript

## Troubleshooting

### Motion sensors not working on tablet
- Ensure you're using HTTPS (or localhost)
- iOS 13+ requires explicit permission - tap "Enable Motion"
- Try the "Calibrate" button after enabling

### Devices can't connect
- Verify both devices are on the same network
- Check firewall settings
- Ensure the room code is correct

### Performance issues
- Reduce browser window size
- Close other GPU-intensive applications
- The system targets 30+ FPS

### Annotations not appearing
- Check browser console for errors
- Verify socket connection is established
- Ensure you're in the same room

## Presentation Script (5 minutes)

**Minute 1: Problem Statement**
"Underground mines are dangerous. Workers can get lost, forget hazard locations, or enter restricted areas."

**Minute 2: Solution Demo**
- Show movement using tablet tilt
- Walk through main corridor

**Minute 3: Safety Features**
- Place danger zone
- Add directional arrow
- Mark incident location

**Minute 4: Restricted Zones**
- Draw restricted area polygon
- Demonstrate blocking behavior

**Minute 5: Impact**
"This system requires no expensive VR headsets - just a tablet and laptop."

## Future Enhancements

- [ ] Voice narration for annotations
- [ ] Path-finding to exits
- [ ] Multi-tablet support
- [ ] Real sensor integration
- [ ] WebXR VR headset mode
- [ ] Historical incident database

## License

MIT License - Free for hackathon and educational use.

## Credits

Built with:
- [Three.js](https://threejs.org/) - 3D graphics
- [Socket.IO](https://socket.io/) - Real-time communication
- [Express.js](https://expressjs.com/) - Web server

---

Good luck with your demo! 🚀⛏️
