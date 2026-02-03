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
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

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
            messages: room.messages.slice(-100), // Last 100 messages
            settings: room.settings
        });

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

                // Clean up empty rooms after 24 hours
                if (room.members.size === 0) {
                    setTimeout(() => {
                        if (room.members.size === 0) {
                            rooms.delete(currentRoom);
                        }
                    }, 24 * 60 * 60 * 1000);
                }
            }
        }

        users.delete(socket.id);
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
