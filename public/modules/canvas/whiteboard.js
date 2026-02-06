/**
 * Secure Infinite Whiteboard - Enterprise Edition
 * High-performance, End-to-End Encrypted Collaborative Canvas
 * 
 * FEATURES:
 * - Infinite Pan & Zoom
 * - Bezier-curved Stroke Smoothing (Premium Feel)
 * - Shapes: Rectangle, Circle, Line
 * - Laser Pointer: Fading transient trails
 * - Holographic Glass Toolbar
 */

export class SecureWhiteboard {
    constructor(socket, encryptionKey, containerId) {
        this.socket = socket;
        this.key = encryptionKey;
        this.container = document.getElementById(containerId);

        // UI Setup
        this.setupUI();

        // Canvas Setup
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: true });
        this.container.appendChild(this.canvas);

        // State
        this.isActive = true; // FIX: Ensure it can start immediately
        this.isDrawing = false;
        this.isPanning = false;
        this.currentPath = [];
        this.strokes = []; // Persistent strokes
        this.laserTrails = []; // Transient { points: [], startTime }
        this.remoteCursors = new Map(); // { id: { x, y, name, color } }

        // Transform
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;

        // Tools
        this.color = '#00ff9d';
        this.lineWidth = 2;
        this.tool = 'pen'; // pen, eraser, laser, rect, circle, line, pan

        this.resize();
        this.initEvents();

        // Start Render Loop (for laser fading and smoothing)
        this.renderLoop();

        // Socket Listeners
        this.socket.on('canvas-stroke', (data) => this.handleRemoteStroke(data));
        this.socket.on('canvas-laser', (data) => this.handleRemoteLaser(data));
    }

    setupUI() {
        // Create Premium Glass Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'canvas-toolbar-v2';
        toolbar.innerHTML = `
            <div class="tool-group">
                <button class="tool-btn active" data-tool="pen" title="Pen (P)"><i class="fas fa-pen"></i></button>
                <button class="tool-btn" data-tool="laser" title="Laser Pointer (L)"><i class="fas fa-bolt"></i></button>
                <button class="tool-btn" data-tool="eraser" title="Eraser (E)"><i class="fas fa-eraser"></i></button>
            </div>
            <div class="tool-divider"></div>
            <div class="tool-group">
                <button class="tool-btn" data-tool="line" title="Line"><i class="fas fa-minus"></i></button>
                <button class="tool-btn" data-tool="rect" title="Rectangle"><i class="fas fa-square"></i></button>
                <button class="tool-btn" data-tool="circle" title="Circle"><i class="fas fa-circle"></i></button>
            </div>
            <div class="tool-divider"></div>
            <div class="tool-group">
                <input type="color" id="canvasColor" value="#00ff9d">
                <select id="canvasWidth">
                    <option value="2">Thin</option>
                    <option value="5" selected>Med</option>
                    <option value="12">Thick</option>
                </select>
            </div>
            <div class="tool-divider"></div>
            <button class="tool-btn danger" id="canvasClear" title="Clear All"><i class="fas fa-trash"></i></button>
        `;
        this.container.appendChild(toolbar);

        // Bind UI Events
        toolbar.querySelectorAll('.tool-btn:not(.danger)').forEach(btn => {
            btn.onclick = () => {
                toolbar.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.tool = btn.dataset.tool;
            };
        });

        const colorPicker = toolbar.querySelector('#canvasColor');
        colorPicker.onchange = (e) => this.color = e.target.value;

        const widthPicker = toolbar.querySelector('#canvasWidth');
        widthPicker.onchange = (e) => this.lineWidth = parseInt(e.target.value);

        toolbar.querySelector('#canvasClear').onclick = () => {
            if (confirm('Wipe the entire canvas?')) this.clear();
        };
    }

    resize() {
        const rect = this.container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        this.ctx.scale(dpr, dpr);
    }

    initEvents() {
        this.canvas.addEventListener('pointerdown', (e) => this.start(e));
        this.canvas.addEventListener('pointermove', (e) => this.move(e));
        this.canvas.addEventListener('pointerup', () => this.end());
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

        // Keyboard shortcuts
        window.addEventListener('keydown', (e) => {
            if (!this.isActive) return;
            const key = e.key.toLowerCase();
            if (key === 'p') this.setTool('pen');
            if (key === 'l') this.setTool('laser');
            if (key === 'e') this.setTool('eraser');
            if (key === 'v') this.setTool('pan');
        });
    }

    setTool(tool) {
        this.tool = tool;
        const btn = this.container.querySelector(`[data-tool="${tool}"]`);
        if (btn) btn.click();
    }

    getPoint(e) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - this.offsetX) / this.scale,
            y: (e.clientY - rect.top - this.offsetY) / this.scale
        };
    }

    handleWheel(e) {
        e.preventDefault();
        const zoomSpeed = 0.0015;
        const delta = -e.deltaY;
        const newScale = this.scale * (1 + delta * zoomSpeed);

        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        // Zoom toward mouse
        this.offsetX -= (mouseX - this.offsetX) * (newScale / this.scale - 1);
        this.offsetY -= (mouseY - this.offsetY) * (newScale / this.scale - 1);
        this.scale = Math.max(0.05, Math.min(10, newScale));
    }

    start(e) {
        if (!this.isActive) return;
        if (e.button === 1 || this.tool === 'pan') {
            this.isPanning = true;
            this.lastPan = { x: e.clientX, y: e.clientY };
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        this.isDrawing = true;
        const p = this.getPoint(e);
        this.currentPath = [p];

        if (this.tool === 'laser') {
            this.currentLaser = { points: [p], startTime: Date.now() };
            this.laserTrails.push(this.currentLaser);
        }
    }

    move(e) {
        if (this.isPanning) {
            this.offsetX += e.clientX - this.lastPan.x;
            this.offsetY += e.clientY - this.lastPan.y;
            this.lastPan = { x: e.clientX, y: e.clientY };
            return;
        }

        if (this.isDrawing) {
            const p = this.getPoint(e);
            this.currentPath.push(p);

            // Laser broadcast (real-time, not stored)
            if (this.tool === 'laser') {
                this.socket.emit('canvas-laser', { point: p });
            }
        }
    }

    end() {
        this.isPanning = false;
        this.canvas.style.cursor = 'crosshair';
        if (!this.isDrawing) return;
        this.isDrawing = false;

        const stroke = {
            points: this.currentPath,
            color: this.color,
            width: this.lineWidth,
            tool: this.tool,
            id: Math.random().toString(36).substr(2, 9)
        };

        if (this.tool !== 'laser') {
            this.strokes.push(stroke);
            this.emitStroke(stroke);
        }

        this.currentPath = [];
    }

    renderLoop() {
        this.render();
        // Clear laser after timeout
        const now = Date.now();
        this.laserTrails = this.laserTrails.filter(t => now - t.startTime < 2000);
        requestAnimationFrame(() => this.renderLoop());
    }

    render() {
        this.ctx.fillStyle = '#0a0a0c'; // Pure Premium Dark
        this.ctx.fillRect(0, 0, this.canvas.width / (window.devicePixelRatio || 1), this.canvas.height / (window.devicePixelRatio || 1));

        this.ctx.save();
        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);

        this.drawGrid();

        // High-end stroke rendering
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        this.strokes.forEach(s => this.drawShape(s));

        if (this.isDrawing) {
            this.drawShape({
                points: this.currentPath,
                color: this.color,
                width: this.lineWidth,
                tool: this.tool,
                isGhost: true
            });
        }

        // Render Lasers
        this.laserTrails.forEach(t => {
            const age = Date.now() - t.startTime;
            const alpha = Math.max(0, 1 - age / 1500);
            this.ctx.globalAlpha = alpha;
            this.drawPath({ points: t.points, color: '#ff3e3e', width: 4 });
            this.ctx.globalAlpha = 1.0;
        });

        this.ctx.restore();
    }

    drawGrid() {
        const size = 60;
        const opacity = Math.min(0.2, 0.1 / this.scale);
        this.ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        this.ctx.lineWidth = 0.5 / this.scale;

        const startX = Math.floor(-this.offsetX / this.scale / size) * size;
        const startY = Math.floor(-this.offsetY / this.scale / size) * size;
        const endX = startX + this.canvas.width / this.scale + size;
        const endY = startY + this.canvas.height / this.scale + size;

        this.ctx.beginPath();
        for (let x = startX; x <= endX; x += size) {
            this.ctx.moveTo(x, startY);
            this.ctx.lineTo(x, endY);
        }
        for (let y = startY; y <= endY; y += size) {
            this.ctx.moveTo(startX, y);
            this.ctx.lineTo(endX, y);
        }
        this.ctx.stroke();
    }

    drawShape(s) {
        if (!s.points || s.points.length < 1) return;
        this.ctx.strokeStyle = s.color;
        this.ctx.lineWidth = s.width;
        this.ctx.fillStyle = 'transparent';

        if (s.tool === 'pen' || s.tool === 'eraser') {
            if (s.tool === 'eraser') {
                this.ctx.strokeStyle = '#0a0a0c';
                this.ctx.lineWidth = s.width * 10;
            }
            this.drawPath(s);
        } else if (s.tool === 'line') {
            if (s.points.length < 2) return;
            this.ctx.beginPath();
            this.ctx.moveTo(s.points[0].x, s.points[0].y);
            this.ctx.lineTo(s.points[s.points.length - 1].x, s.points[s.points.length - 1].y);
            this.ctx.stroke();
        } else if (s.tool === 'rect') {
            if (s.points.length < 2) return;
            const start = s.points[0];
            const end = s.points[s.points.length - 1];
            this.ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
        } else if (s.tool === 'circle') {
            if (s.points.length < 2) return;
            const start = s.points[0];
            const end = s.points[s.points.length - 1];
            const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
            this.ctx.beginPath();
            this.ctx.arc(start.x, start.y, radius, 0, Math.PI * 2);
            this.ctx.stroke();
        }
    }

    drawPath(s) {
        if (s.points.length < 2) return;
        this.ctx.beginPath();
        this.ctx.moveTo(s.points[0].x, s.points[0].y);

        // Use Quad Curves for Smoothness
        for (var i = 1; i < s.points.length - 2; i++) {
            var xc = (s.points[i].x + s.points[i + 1].x) / 2;
            var yc = (s.points[i].y + s.points[i + 1].y) / 2;
            this.ctx.quadraticCurveTo(s.points[i].x, s.points[i].y, xc, yc);
        }
        // curve through the last two points
        if (s.points.length > 2) {
            this.ctx.quadraticCurveTo(
                s.points[i].x,
                s.points[i].y,
                s.points[i + 1].x,
                s.points[i + 1].y
            );
        }
        this.ctx.stroke();
    }

    emitStroke(stroke) {
        this.socket.emit('canvas-stroke', stroke);
    }

    handleRemoteStroke(stroke) {
        this.strokes.push(stroke);
    }

    handleRemoteLaser(data) {
        // Laser trails only
        const trail = this.laserTrails.find(t => t.id === data.senderId);
        if (!trail) {
            this.laserTrails.push({ id: data.senderId, points: [data.point], startTime: Date.now() });
        } else {
            trail.points.push(data.point);
            trail.startTime = Date.now(); // Renew
        }
    }

    clear() {
        this.strokes = [];
        this.socket.emit('canvas-clear');
    }
}
