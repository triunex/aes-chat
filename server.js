/**
 * AES Chat - Premium Encrypted Chat Room Server
 * Production-ready, real-time encrypted messaging platform
 * 
 * Features:
 * - End-to-end AES-256 encryption
 * - Real-time messaging with Socket.io
 * - Room-based chat with shareable links
 * - Voice messages, file sharing, reactions
 * - Typing indicators, read receipts, user presence
 * - Disappearing messages, message threading
 */

const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');

// Keep-Alive Mechanism
const PING_INTERVAL = 5 * 60 * 1000; // 5 minutes
const APP_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`;

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 10e6 // 10MB for file uploads
});

// Middleware
app.use(express.static('public'));
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => {
        const uniqueName = `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`;
        cb(null, uniqueName);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// In-memory data stores (production would use Redis/MongoDB)
const rooms = new Map();
const users = new Map();
const messageStore = new Map();
const typingUsers = new Map();

// Persistence Logic
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'rooms.json');
let saveTimeout = null;
let db = null;
let useFirebase = false;

// Initialize Persistence
async function initPersistence() {
    // 1. Try Firebase
    try {
        let serviceAccount;
        const localKeyPath = path.join(__dirname, 'service-account.json');

        if (fs.existsSync(localKeyPath)) {
            // Local Dev: Read from file
            serviceAccount = JSON.parse(fs.readFileSync(localKeyPath, 'utf8'));
            console.log('✅ Found local Firebase credentials');
        } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            // Render/Cloud: Read from ENV
            serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        }

        if (serviceAccount) {
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            db = admin.firestore();
            useFirebase = true;
            console.log('✅ Firebase initialized for persistence');
        }
    } catch (e) {
        console.error('⚠️ Firebase init failed (falling back to local):', e.message);
    }

    // 2. Fallback to Local File
    if (!useFirebase) {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        console.log('📂 Using local file storage for persistence');
    }

    await loadRooms();
}

// Save Rooms (Throttled)
function saveRooms() {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            if (useFirebase) {
                // Save to Firestore (Batch write or individual)
                // For simplicity/robustness, we'll save each room as a doc
                const batch = db.batch();
                rooms.forEach((room, roomId) => {
                    const docRef = db.collection('rooms').doc(roomId);
                    const roomData = {
                        id: room.id,
                        name: room.name,
                        createdBy: room.createdBy,
                        createdAt: room.createdAt.toISOString(),
                        settings: room.settings,
                        messages: room.messages.map(m => ({ ...m, timestamp: m.timestamp.toISOString() })),
                        // Don't save transient members store, they re-join
                    };
                    batch.set(docRef, roomData, { merge: true });
                });
                await batch.commit();
                // console.log('Saved to Firebase');
            } else {
                // Local File Save
                const data = Array.from(rooms.values()).map(room => ({
                    ...room,
                    members: Array.from(room.members.entries()),
                    messages: room.messages
                }));
                fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
                // console.log('Saved to local disk');
            }
        } catch (error) {
            console.error('Failed to save room data:', error);
        }
    }, 2000); // 2-second throttle
}

// Load Rooms
async function loadRooms() {
    try {
        if (useFirebase) {
            const snapshot = await db.collection('rooms').get();
            if (snapshot.empty) return;

            snapshot.forEach(doc => {
                const data = doc.data();
                const room = new Room(data.id, data.name, data.createdBy);
                room.createdAt = new Date(data.createdAt);
                room.settings = data.settings;
                // Hydrate messages
                room.messages = (data.messages || []).map(m => {
                    const msg = new Message(m); // Message ctor handles basic copy
                    msg.id = m.id;
                    msg.timestamp = new Date(m.timestamp);
                    msg.reactions = m.reactions || {};
                    msg.readBy = m.readBy || [];
                    msg.fileData = m.fileData; // Ensure file data is preserved
                    return msg;
                });
                rooms.set(room.id, room);
            });
            console.log(`🔥 Loaded ${rooms.size} rooms from Firebase`);
        } else {
            // Local Load
            if (fs.existsSync(DATA_FILE)) {
                const rawData = fs.readFileSync(DATA_FILE, 'utf8');
                const data = JSON.parse(rawData);
                data.forEach(roomData => {
                    const room = new Room(roomData.id, roomData.name, roomData.createdBy);
                    room.createdAt = new Date(roomData.createdAt);
                    room.settings = roomData.settings;
                    room.messages = roomData.messages || [];
                    rooms.set(room.id, room);
                });
                console.log(`📂 Loaded ${rooms.size} rooms from local storage`);
            }
        }
    } catch (error) {
        console.error('Failed to load room data:', error);
    }
}

// Start persistence
initPersistence();

// Keep-Alive Ping
app.get('/ping', (req, res) => res.status(200).send('pong'));
setInterval(() => {
    const pingModule = APP_URL.startsWith('https') ? https : http;
    pingModule.get(`${APP_URL}/ping`, () => { }).on('error', () => { });
}, PING_INTERVAL);

// Room class for better organization
class Room {
    constructor(id, name, createdBy) {
        this.id = id;
        this.name = name || `Room ${id.substring(0, 6)}`;
        this.createdAt = new Date();
        this.createdBy = createdBy;
        this.members = new Map();
        this.messages = [];
        this.settings = {
            disappearingMessages: null, // null, 5000, 60000, 3600000, 86400000
            maxMembers: 100,
            isPrivate: true,
            allowFileSharing: true,
            allowVoiceMessages: true
        };
    }

    addMember(userId, userData) {
        this.members.set(userId, {
            ...userData,
            joinedAt: new Date(),
            isOnline: true
        });
    }

    removeMember(userId) {
        this.members.delete(userId);
    }

    getMembersList() {
        return Array.from(this.members.entries()).map(([id, data]) => ({
            id,
            ...data
        }));
    }
}

// Message class
class Message {
    constructor(data) {
        this.id = uuidv4();
        this.roomId = data.roomId;
        this.senderId = data.senderId;
        this.senderName = data.senderName;
        this.senderAvatar = data.senderAvatar;
        this.content = data.content;
        this.type = data.type || 'text'; // text, voice, file, image, system
        this.timestamp = new Date();
        this.replyTo = data.replyTo || null;
        this.reactions = {};
        this.readBy = [data.senderId];
        this.edited = false;
        this.editedAt = null;
        this.deleted = false;
        this.disappearAt = data.disappearAt || null;
        this.fileData = data.fileData || null;
    }
}

// API Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/room/:roomId', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// Create new room
app.post('/api/rooms', (req, res) => {
    const { name, creatorName } = req.body;
    const roomId = uuidv4();
    const room = new Room(roomId, name, creatorName);
    rooms.set(roomId, room);
    saveRooms(); // Save after creation

    res.json({
        success: true,
        roomId,
        inviteLink: `/room/${roomId}`
    });
});

// Get room info
app.get('/api/rooms/:roomId', (req, res) => {
    const room = rooms.get(req.params.roomId);
    if (!room) {
        return res.status(404).json({ error: 'Room not found' });
    }
    res.json({
        id: room.id,
        name: room.name,
        memberCount: room.members.size,
        createdAt: room.createdAt,
        settings: room.settings
    });
});

// File upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
    }
    res.json({
        success: true,
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype,
        url: `/uploads/${req.file.filename}`
    });
});

// Socket.io connection handling
io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);
    let currentRoom = null;
    let currentUser = null;

    // Join room
    socket.on('join-room', ({ roomId, userName, userAvatar }) => {
        // Create room if doesn't exist (for direct link access)
        if (!rooms.has(roomId)) {
            const room = new Room(roomId, null, userName);
            rooms.set(roomId, room);
        }

        const room = rooms.get(roomId);
        currentRoom = roomId;
        currentUser = {
            id: socket.id,
            name: userName,
            avatar: userAvatar,
            color: generateUserColor(userName)
        };

        // Add user to room
        room.addMember(socket.id, currentUser);
        users.set(socket.id, { ...currentUser, roomId });

        // Join socket room
        socket.join(roomId);

        // Send room data to joining user
        socket.emit('room-joined', {
            roomId,
            roomName: room.name,
            members: room.getMembersList(),
            messages: room.messages.slice(-5000), // Increased history limit
            settings: room.settings
        });
        saveRooms(); // Save state

        // Notify others
        socket.to(roomId).emit('user-joined', {
            user: currentUser,
            members: room.getMembersList()
        });
    });

    // Handle messages
    socket.on('send-message', (data) => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        if (!room) return;

        const message = new Message({
            roomId: currentRoom,
            senderId: socket.id,
            senderName: currentUser.name,
            senderAvatar: currentUser.avatar,
            content: data.content,
            type: data.type || 'text',
            replyTo: data.replyTo,
            fileData: data.fileData,
            disappearAt: room.settings.disappearingMessages
                ? new Date(Date.now() + room.settings.disappearingMessages)
                : null
        });

        room.messages.push(message);
        io.to(currentRoom).emit('message', message);
        saveRooms();

        // Handle disappearing messages
        if (message.disappearAt) {
            setTimeout(() => {
                const msgIndex = room.messages.findIndex(m => m.id === message.id);
                if (msgIndex > -1) {
                    room.messages[msgIndex].deleted = true;
                    room.messages[msgIndex].content = 'This message has disappeared';
                    io.to(currentRoom).emit('message-deleted', { messageId: message.id });
                }
            }, room.settings.disappearingMessages);
        }
    });

    // Typing indicator
    socket.on('typing-start', () => {
        if (!currentRoom || !currentUser) return;
        socket.to(currentRoom).emit('user-typing', {
            userId: socket.id,
            userName: currentUser.name
        });
    });

    socket.on('typing-stop', () => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('user-stopped-typing', {
            userId: socket.id
        });
    });

    // Message reactions
    socket.on('add-reaction', ({ messageId, emoji }) => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        const message = room.messages.find(m => m.id === messageId);

        if (message) {
            if (!message.reactions[emoji]) {
                message.reactions[emoji] = [];
            }

            const userIndex = message.reactions[emoji].indexOf(socket.id);
            if (userIndex > -1) {
                message.reactions[emoji].splice(userIndex, 1);
                if (message.reactions[emoji].length === 0) {
                    delete message.reactions[emoji];
                }
            } else {
                message.reactions[emoji].push(socket.id);
            }

            io.to(currentRoom).emit('reaction-updated', {
                messageId,
                reactions: message.reactions
            });
        }
    });

    // Read receipts
    socket.on('mark-read', ({ messageIds }) => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        messageIds.forEach(msgId => {
            const message = room.messages.find(m => m.id === msgId);
            if (message && !message.readBy.includes(socket.id)) {
                message.readBy.push(socket.id);
                socket.to(currentRoom).emit('message-read', {
                    messageId: msgId,
                    userId: socket.id,
                    userName: currentUser.name
                });
            }
        });
    });

    // Edit message
    socket.on('edit-message', ({ messageId, newContent }) => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        const message = room.messages.find(m => m.id === messageId);

        if (message && message.senderId === socket.id) {
            message.content = newContent;
            message.edited = true;
            message.editedAt = new Date();

            io.to(currentRoom).emit('message-edited', {
                messageId,
                newContent,
                editedAt: message.editedAt
            });
            saveRooms();
        }
    });

    // Delete message
    socket.on('delete-message', ({ messageId }) => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        const message = room.messages.find(m => m.id === messageId);

        if (message && message.senderId === socket.id) {
            message.deleted = true;
            message.content = 'This message was deleted';

            io.to(currentRoom).emit('message-deleted', { messageId });
            saveRooms();
        }
    });

    // Update room settings
    socket.on('update-settings', (settings) => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        room.settings = { ...room.settings, ...settings };

        io.to(currentRoom).emit('settings-updated', room.settings);
    });

    // Voice message
    socket.on('voice-message', (data) => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        const message = new Message({
            roomId: currentRoom,
            senderId: socket.id,
            senderName: currentUser.name,
            senderAvatar: currentUser.avatar,
            content: 'Voice message',
            type: 'voice',
            fileData: {
                audioData: data.audioData,
                duration: data.duration,
                waveform: data.waveform
            }
        });

        room.messages.push(message);
        io.to(currentRoom).emit('message', message);
        saveRooms();
    });

    // WebRTC Signaling for Holo-Voice
    socket.on('voice-signal', ({ targetId, signal }) => {
        io.to(targetId).emit('voice-signal', {
            senderId: socket.id,
            signal: signal
        });
    });

    socket.on('join-voice', () => {
        if (!currentRoom) return;
        // Tell everyone in room to prepare connections
        socket.to(currentRoom).emit('user-joined-voice', { userId: socket.id });
    });

    socket.on('leave-voice', () => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('user-left-voice', { userId: socket.id });
    });

    // Whiteboard Relay
    socket.on('canvas-stroke', (data) => {
        if (!currentRoom) return;
        socket.to(currentRoom).emit('canvas-stroke', data);
    });

    // PQC Key Exchange Handshake
    socket.on('handshake-init', (data) => {
        if (!currentRoom) return;
        // Broadcast public key to room, asking for the Session Key
        socket.to(currentRoom).emit('handshake-request', {
            senderId: socket.id,
            pk: data.pk
        });
    });

    socket.on('handshake-response', ({ targetId, ciphertext, encryptedKey }) => {
        // Send the encapsulated Session Key back to the specific joiner
        io.to(targetId).emit('handshake-complete', {
            ciphertext,
            encryptedKey
        });
    });

    // Kick Member

    // Kick Member
    socket.on('kick-member', ({ targetId }) => {
        if (!currentRoom) return;
        const room = rooms.get(currentRoom);

        // Verify only creator can kick
        if (room && room.createdBy === currentUser.name) {
            const targetSocket = io.sockets.sockets.get(targetId);

            // Remove from room data
            room.removeMember(targetId);

            // Notify target and disconnect them from room
            if (targetSocket) {
                targetSocket.leave(currentRoom);
                targetSocket.emit('kicked', { roomName: room.name });
            }

            // Notify others
            io.to(currentRoom).emit('user-left', {
                user: { id: targetId }, // Partial user obj just for ID
                members: room.getMembersList()
            });

            saveRooms();
        }
    });

    // User presence
    socket.on('presence-update', (status) => {
        if (!currentRoom) return;

        const room = rooms.get(currentRoom);
        const member = room.members.get(socket.id);
        if (member) {
            member.status = status;
            io.to(currentRoom).emit('presence-changed', {
                userId: socket.id,
                status
            });
            saveRooms();
        }
    });

    // Disconnect handling
    socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);

        if (currentRoom && currentUser) {
            const room = rooms.get(currentRoom);
            if (room) {
                room.removeMember(socket.id);

                io.to(currentRoom).emit('user-left', {
                    user: currentUser,
                    members: room.getMembersList()
                });
                // No more auto-delete - persist forever
            }
        }

        users.delete(socket.id);
        saveRooms(); // Save state on disconnect too
    });
});

// Helper function to generate consistent user colors
function generateUserColor(name) {
    const colors = [
        '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
        '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
        '#F8B500', '#00CED1', '#FF69B4', '#32CD32', '#FFD700'
    ];
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
        hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`
    ╔═══════════════════════════════════════════════════════════╗
    ║                                                           ║
    ║     █████╗ ███████╗███████╗     ██████╗██╗  ██╗ █████╗ ████████╗    ║
    ║    ██╔══██╗██╔════╝██╔════╝    ██╔════╝██║  ██║██╔══██╗╚══██╔══╝    ║
    ║    ███████║█████╗  ███████╗    ██║     ███████║███████║   ██║       ║
    ║    ██╔══██║██╔══╝  ╚════██║    ██║     ██╔══██║██╔══██║   ██║       ║
    ║    ██║  ██║███████╗███████║    ╚██████╗██║  ██║██║  ██║   ██║       ║
    ║    ╚═╝  ╚═╝╚══════╝╚══════╝     ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝   ╚═╝       ║
    ║                                                           ║
    ║         🔐 End-to-End Encrypted Chat Platform             ║
    ║                                                           ║
    ║         Server running at http://localhost:${PORT}          ║
    ║                                                           ║
    ╚═══════════════════════════════════════════════════════════╝
    `);
});

module.exports = { app, server, io };
