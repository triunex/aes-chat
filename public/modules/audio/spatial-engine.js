/**
 * Holo-Spatial Audio Engine
 * Advanced 3D Audio Processing & Visual Radar Interface
 * 
 * Implements HRTF (Head-Related Transfer Function) spatializtion
 * for hyper-realistic voice positioning.
 */

export class SpatialAudioEngine {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.sources = new Map(); // Map<UserId, { panner, gain, element, x, y, z }>
        this.listener = this.ctx.listener;

        // Radar UI Configuration
        this.radarCanvas = null;
        this.radarCtx = null;
        this.isDragging = false;
        this.draggedUser = null;
        this.centerX = 0;
        this.centerY = 0;
        this.scale = 50; // Pixels per meter

        this.initAudioListener();
    }

    // Initialize the listener (the user's ears)
    initAudioListener() {
        // Center the listener in the virtual room
        if (this.listener.positionX) {
            this.listener.positionX.value = 0;
            this.listener.positionY.value = 0;
            this.listener.positionZ.value = 0;
            this.listener.forwardZ.value = -1;
            this.listener.upY.value = 1;
        } else {
            // Deprecated API fallback
            this.listener.setPosition(0, 0, 0);
            this.listener.setOrientation(0, 0, -1, 0, 1, 0);
        }
    }

    /**
     * Connect a new remote audio stream to the spatial engine
     * @param {string} userId - ID of the remote user
     * @param {MediaStream} stream - WebRTC Audio Stream
     */
    addSource(userId, stream) {
        if (this.sources.has(userId)) return;

        // Create Audio Graph: Source -> Gain -> Panner -> Destination
        const source = this.ctx.createMediaStreamSource(stream);
        const gain = this.ctx.createGain();
        const panner = this.ctx.createPanner();

        // High-Quality HRTF Panning
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.maxDistance = 10;
        panner.rolloffFactor = 1;
        panner.coneInnerAngle = 360;
        panner.coneOuterAngle = 0;
        panner.coneOuterGain = 0;

        // Default Position (In front, slightly scattered)
        const randomOffset = (Math.random() - 0.5) * 2;
        panner.positionX.value = randomOffset;
        panner.positionY.value = 0;
        panner.positionZ.value = -2; // 2 meters in front

        source.connect(gain);
        gain.connect(panner);
        panner.connect(this.ctx.destination);

        this.sources.set(userId, {
            source,
            gain,
            panner,
            x: randomOffset,
            y: 0,
            z: -2,
            color: this.generateUserColor(userId)
        });

        this.updateRadar();
    }

    removeSource(userId) {
        const node = this.sources.get(userId);
        if (node) {
            node.source.disconnect();
            node.gain.disconnect();
            node.panner.disconnect();
            this.sources.delete(userId);
            this.updateRadar();
        }
    }

    /**
     * Set the volume for a specific user
     */
    setVolume(userId, value) {
        const node = this.sources.get(userId);
        if (node) {
            node.gain.gain.value = Math.max(0, Math.min(1, value));
        }
    }

    /**
     * Initialize the Visual Radar UI
     * @param {HTMLElement} container - DOM element to mount the radar
     */
    mountRadar(container) {
        // Container Setup
        container.innerHTML = '';
        container.style.position = 'relative';
        container.style.width = '100%';
        container.style.height = '300px';
        container.style.background = 'radial-gradient(circle at center, #1a1a1a 0%, #000 100%)';
        container.style.borderRadius = '12px';
        container.style.overflow = 'hidden';
        container.style.border = '1px solid #333';
        container.style.boxShadow = 'inset 0 0 20px rgba(0,0,0,0.8)';

        // Canvas Setup
        this.radarCanvas = document.createElement('canvas');
        this.radarCanvas.width = container.clientWidth;
        this.radarCanvas.height = container.clientHeight;
        this.radarCanvas.style.display = 'block';
        container.appendChild(this.radarCanvas);

        this.radarCtx = this.radarCanvas.getContext('2d');
        this.centerX = this.radarCanvas.width / 2;
        this.centerY = this.radarCanvas.height / 2;

        // Overlay UI
        const label = document.createElement('div');
        label.innerText = 'HOLO-SPATIAL RADAR';
        label.style.position = 'absolute';
        label.style.top = '10px';
        label.style.left = '10px';
        label.style.color = '#00ff9d';
        label.style.fontSize = '10px';
        label.style.fontFamily = 'monospace';
        label.style.letterSpacing = '2px';
        label.style.pointerEvents = 'none';
        container.appendChild(label);

        // Event Listeners for Interaction
        this.attachRadarEvents();

        // Start Render Loop
        this.startRadarLoop();
    }

    attachRadarEvents() {
        const getPos = (e) => {
            const rect = this.radarCanvas.getBoundingClientRect();
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        };

        this.radarCanvas.addEventListener('mousedown', (e) => {
            const pos = getPos(e);
            // Check collision
            for (const [userId, node] of this.sources.entries()) {
                const screenX = this.centerX + (node.x * this.scale);
                const screenY = this.centerY + (node.z * this.scale); // Z maps to Y (top-down view)

                const dist = Math.hypot(pos.x - screenX, pos.y - screenY);
                if (dist < 15) { // Hitbox radius
                    this.isDragging = true;
                    this.draggedUser = userId;
                    this.radarCanvas.style.cursor = 'grabbing';
                    break;
                }
            }
        });

        window.addEventListener('mousemove', (e) => {
            if (!this.isDragging || !this.draggedUser) return;
            const rect = this.radarCanvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            // Convert Screen -> World Coordinates
            // Restrict bounds
            const worldX = (x - this.centerX) / this.scale;
            const worldZ = (y - this.centerY) / this.scale;

            this.updatePosition(this.draggedUser, worldX, 0, worldZ);
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.draggedUser = null;
            if (this.radarCanvas) this.radarCanvas.style.cursor = 'default';
        });
    }

    updatePosition(userId, x, y, z) {
        const node = this.sources.get(userId);
        if (node) {
            // Smooth interpolation could go here
            node.x = x;
            node.y = y;
            node.z = z;

            // Web Audio API Update
            if (node.panner.positionX) {
                node.panner.positionX.value = x;
                node.panner.positionY.value = y;
                node.panner.positionZ.value = z;
            } else {
                node.panner.setPosition(x, y, z);
            }
        }
    }

    startRadarLoop() {
        const loop = () => {
            if (!this.radarCtx) return;
            this.renderRadar();
            requestAnimationFrame(loop);
        };
        loop();
    }

    renderRadar() {
        const ctx = this.radarCtx;
        const w = this.radarCanvas.width;
        const h = this.radarCanvas.height;

        // Clear & Background
        ctx.clearRect(0, 0, w, h);

        // Grid Lines
        ctx.strokeStyle = 'rgba(0, 255, 157, 0.1)';
        ctx.lineWidth = 1;

        // Concentric circles (Distance markers)
        for (let r = 50; r < Math.max(w, h); r += 50) {
            ctx.beginPath();
            ctx.arc(this.centerX, this.centerY, r, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Crosshair
        ctx.beginPath();
        ctx.moveTo(0, this.centerY);
        ctx.lineTo(w, this.centerY);
        ctx.moveTo(this.centerX, 0);
        ctx.lineTo(this.centerX, h);
        ctx.stroke();

        // Draw Listener (You/Center)
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(this.centerX, this.centerY, 6, 0, Math.PI * 2);
        ctx.fill();
        // Listener cone (facing forward/up in 2D)
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        ctx.moveTo(this.centerX, this.centerY);
        ctx.lineTo(this.centerX - 20, this.centerY - 40);
        ctx.lineTo(this.centerX + 20, this.centerY - 40);
        ctx.closePath();
        ctx.fill();

        // Draw Sources (Users)
        this.sources.forEach((node, userId) => {
            const screenX = this.centerX + (node.x * this.scale);
            const screenY = this.centerY + (node.z * this.scale);

            // Pulse effect if talking (Volume based? Mocking it for now)
            const pulseSize = 15 + Math.sin(Date.now() / 200) * 2;

            ctx.shadowBlur = 10;
            ctx.shadowColor = node.color;
            ctx.fillStyle = node.color;
            ctx.beginPath();
            ctx.arc(screenX, screenY, 6, 0, Math.PI * 2);
            ctx.fill();

            // Drag handle halo
            ctx.strokeStyle = node.color;
            ctx.beginPath();
            ctx.arc(screenX, screenY, pulseSize, 0, Math.PI * 2);
            ctx.stroke();
            ctx.shadowBlur = 0;

            // ID Label
            ctx.fillStyle = '#aaa';
            ctx.font = '10px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(userId.substring(0, 4), screenX, screenY + 25);
        });
    }

    updateRadar() {
        // Trigger manual update if needed, but loop handles continuous rendering
    }

    generateUserColor(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        const c = (hash & 0x00FFFFFF).toString(16).toUpperCase();
        return '#' + '00000'.substring(0, 6 - c.length) + c;
    }
}
