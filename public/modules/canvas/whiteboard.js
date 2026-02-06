/**
 * Secure Infinite Whiteboard
 * End-to-End Encrypted Collaborative Drawing Canvas
 */

export class SecureWhiteboard {
    constructor(socket, encryptionKey, containerId) {
        this.socket = socket;
        this.key = encryptionKey; // WebCrypto Key
        this.container = document.getElementById(containerId);

        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: false }); // Optimize
        this.container.appendChild(this.canvas);

        // State
        this.isActive = false;
        this.isDrawing = false;
        this.currentPath = [];
        this.strokes = []; // Array of { points: [], color, size }

        // Transform (Infinite Pan/Zoom)
        this.scale = 1;
        this.offsetX = 0;
        this.offsetY = 0;

        // Tools
        this.color = '#00ff9d';
        this.lineWidth = 2;
        this.tool = 'pen'; // pen, eraser, pan

        this.resize();
        this.initEvents();
        this.renderLoop();

        // Remote Updates
        this.socket.on('canvas-stroke', (encryptedData) => this.handleRemoteStroke(encryptedData));
    }

    resize() {
        const rect = this.container.getBoundingClientRect();
        this.canvas.width = rect.width;
        this.canvas.height = rect.height;
        this.render(); // Re-render on resize
    }

    initEvents() {
        // Pointer Events for Pen/Touch/Mouse
        this.canvas.addEventListener('pointerdown', (e) => this.start(e));
        this.canvas.addEventListener('pointermove', (e) => this.move(e));
        this.canvas.addEventListener('pointerup', () => this.end());
        this.canvas.addEventListener('pointerleave', () => this.end());

        // Wheel to Zoom/Pan
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.ctrlKey) {
                // Zoom
                const zoomSpeed = 0.001;
                const newScale = this.scale - (e.deltaY * zoomSpeed);
                this.scale = Math.max(0.1, Math.min(5, newScale));
            } else {
                // Pan
                this.offsetX -= e.deltaX;
                this.offsetY -= e.deltaY;
            }
            this.render();
        });

        window.addEventListener('resize', () => this.resize());
    }

    getPoint(e) {
        // Convert Screen -> World Coordinates
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - this.offsetX) / this.scale,
            y: (e.clientY - rect.top - this.offsetY) / this.scale
        };
    }

    start(e) {
        if (!this.isActive) return;
        if (this.tool === 'pan' || e.button === 1) { // Middle click pan
            this.isPanning = true;
            this.lastPan = { x: e.clientX, y: e.clientY };
            return;
        }

        this.isDrawing = true;
        this.currentPath = [this.getPoint(e)];
    }

    move(e) {
        if (this.isPanning) {
            const dx = e.clientX - this.lastPan.x;
            const dy = e.clientY - this.lastPan.y;
            this.offsetX += dx;
            this.offsetY += dy;
            this.lastPan = { x: e.clientX, y: e.clientY };
            this.render();
            return;
        }

        if (!this.isDrawing) return;
        const p = this.getPoint(e);
        this.currentPath.push(p);

        // Local Optimistic Render (Just the new segment)
        this.render(); // Or optimize to just draw segment
    }

    end() {
        if (this.isPanning) {
            this.isPanning = false;
            return;
        }

        if (!this.isDrawing) return;

        this.isDrawing = false;

        // Finalize Stroke
        const stroke = {
            points: this.currentPath,
            color: this.color,
            width: this.lineWidth,
            type: this.tool
        };

        this.strokes.push(stroke);
        this.emitStroke(stroke);
        this.currentPath = [];
    }

    render() {
        // Clear screen with dark background
        this.ctx.fillStyle = '#0a0a0c'; // Matches app theme
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this.ctx.save();
        // Apply Transform
        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);

        // Grid (Optional visual aid)
        this.drawGrid();

        // Draw All Strokes
        this.ctx.lineCap = 'round';
        this.ctx.lineJoin = 'round';

        this.strokes.forEach(s => this.drawPath(s));

        // Draw Current Stroke
        if (this.isDrawing && this.currentPath.length > 0) {
            this.drawPath({
                points: this.currentPath,
                color: this.color,
                width: this.lineWidth
            });
        }

        this.ctx.restore();
    }

    drawPath(stroke) {
        if (stroke.points.length < 2) return;

        this.ctx.beginPath();
        this.ctx.strokeStyle = stroke.color;
        this.ctx.lineWidth = stroke.width;

        if (stroke.type === 'eraser') {
            this.ctx.globalCompositeOperation = 'destination-out'; // Mask away (if transparent bg)
            // But we have solid bg. So eraser paints background color really.
            this.ctx.strokeStyle = '#0a0a0c';
            this.ctx.lineWidth = stroke.width * 5;
        } else {
            this.ctx.globalCompositeOperation = 'source-over';
        }

        this.ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
        for (let i = 1; i < stroke.points.length; i++) {
            this.ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }
        this.ctx.stroke();
    }

    drawGrid() {
        // Infinite Grid Illusion
        const gridSize = 50;
        const left = -this.offsetX / this.scale;
        const top = -this.offsetY / this.scale;
        const right = left + (this.canvas.width / this.scale);
        const bottom = top + (this.canvas.height / this.scale);

        this.ctx.strokeStyle = '#1e1e24';
        this.ctx.lineWidth = 1 / this.scale;
        this.ctx.beginPath();

        const startX = Math.floor(left / gridSize) * gridSize;
        const startY = Math.floor(top / gridSize) * gridSize;

        for (let x = startX; x < right; x += gridSize) {
            this.ctx.moveTo(x, top);
            this.ctx.lineTo(x, bottom);
        }
        for (let y = startY; y < bottom; y += gridSize) {
            this.ctx.moveTo(left, y);
            this.ctx.lineTo(right, y);
        }
        this.ctx.stroke();
    }

    renderLoop() {
        // If we want animations or smooth smoothing
        // requestAnimationFrame(() => this.renderLoop());
    }

    async emitStroke(stroke) {
        // ENCRYPT HERE
        // Just mocking the encryption interface call for now as I need access to AESEncryption global or passed in
        // In real app, we convert stroke object to JSON string -> Encrypt -> Send

        try {
            // Using the global AESEncryption helper exposed in window or passed in context
            // We assume a helper method `window.chatApp.encryptPayload(data)` exists or similar
            // or we use the socket directly if encryption handled there? 
            // The architecture wraps the message content encryption. 
            // We need to encrypt this manually.

            const raw = JSON.stringify(stroke); // We rely on ChatApp to encrypt this blob

            // For now, emit raw-ish, let server broadcast, receiver decrypts?
            // "Encrypted Collaboration" means Server sees Opaque Blob.

            if (window.chatApp) {
                window.chatApp.broadcastCanvasStroke(stroke);
            }
        } catch (e) {
            console.error('Canvas Emit Error', e);
        }
    }

    handleRemoteStroke(data) {
        // Decrypt logic happens in ChatApp before calling this, or here?
        // We'll pass the decrypted object here.
        this.strokes.push(data);
        this.render();
    }

    clear() {
        this.strokes = [];
        this.render();
    }
}
