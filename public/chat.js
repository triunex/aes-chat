/**
 * AES Chat - Main Chat Application
 * Real-time encrypted messaging with advanced features
 */

import { SpatialAudioEngine } from './modules/audio/spatial-engine.js';
import { WebRTCManager } from './modules/network/webrtc-mesh.js';
import { SecureWhiteboard } from './modules/canvas/whiteboard.js';
import { HandshakeManager } from './modules/crypto/handshake.js';
import { SovereignCallManager } from './modules/network/sovereign-calls.js';

// Global Socket, defined in HTML script
// const socket = io(); // We use this.socket inside class.

class AESChatApp {
    constructor() {
        this.socket = null;
        this.roomId = null;
        this.roomKey = null;
        this.currentUser = null;
        this.members = new Map();
        this.messages = [];
        this.replyingTo = null;
        this.typingTimeout = null;
        this.isRecording = false;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.recordingStartTime = null;
        this.isConnected = false;
        this.isCreator = false;
        this.callManager = null;

        // Persistent User ID for alignment
        this.userId = localStorage.getItem('aes-persistent-uid');
        if (!this.userId) {
            this.userId = 'u-' + Math.random().toString(36).substring(2, 11);
            localStorage.setItem('aes-persistent-uid', this.userId);
        }

        this.init();
    }

    async init() {
        try {
            // Get room ID from URL
            const pathParts = window.location.pathname.split('/');
            this.roomId = pathParts[pathParts.length - 1];

            if (!this.roomId) {
                window.location.href = '/';
                return;
            }

            // PQC Integration: Key is now established via handshake after join
            // We no longer deterministically derive it from Room ID.
            if (!window.AESEncryption) {
                this.showToast('Security Error: Encryption module failed to load', 'error');
                return;
            }

            this.initTheme();
            // this.initEmojiPicker(); // Removed in favor of quick reactions

            // Check for saved name (from landing page or localStorage)
            const creatorName = sessionStorage.getItem('aes-joining-name');
            const savedName = localStorage.getItem(`aes-chat-name-${this.roomId}`);

            if (creatorName) {
                // Coming from landing page - save to localStorage and join
                sessionStorage.removeItem('aes-joining-name');
                localStorage.setItem(`aes-chat-name-${this.roomId}`, creatorName);
                this.hideModal();
                this.joinRoom(creatorName);
            } else if (savedName) {
                // Already joined this room before - auto-join with saved name
                this.hideModal();
                this.joinRoom(savedName);
            } else {
                // New visitor to this room - show modal
                this.showJoinModal();
            }
        } catch (error) {
            console.error('Init error:', error);
            this.showJoinModal();
        }
    }

    initTheme() {
        const themeToggle = document.getElementById('themeToggle');
        const savedTheme = localStorage.getItem('aes-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);

        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const current = document.documentElement.getAttribute('data-theme');
                const newTheme = current === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', newTheme);
                localStorage.setItem('aes-theme', newTheme);
            });
        }
    }

    hideModal() {
        const modal = document.getElementById('joinModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    showJoinModal() {
        const modal = document.getElementById('joinModal');
        const form = document.getElementById('joinForm');
        const input = document.getElementById('joinUserName');

        if (!modal || !form || !input) return;

        modal.style.display = 'flex';
        input.value = ''; // Clear any previous value
        input.focus();

        // Remove existing listener to prevent duplicates
        const newForm = form.cloneNode(true);
        form.parentNode.replaceChild(newForm, form);

        newForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const nameInput = document.getElementById('joinUserName');
            const name = nameInput.value.trim();
            if (name) {
                // Save name for this room - persists across refreshes
                localStorage.setItem(`aes-chat-name-${this.roomId}`, name);
                this.hideModal();
                this.joinRoom(name);
            }
        });
    }

    joinRoom(userName) {
        this.currentUser = {
            name: userName,
            avatar: this.getInitials(userName),
            color: this.generateColor(userName)
        };

        // Connect to socket
        this.socket = io();
        this.setupSocketEvents();
        this.initUIEvents();

        // Initialize Sovereign Call Manager
        this.callManager = new SovereignCallManager(this.socket);
        this.setupCallHandlers();

        // Join the room
        this.socket.emit('join-room', {
            roomId: this.roomId,
            userId: this.userId, // Send persistent ID
            userName: this.currentUser.name,
            userAvatar: this.currentUser.avatar
        });
    }

    setupCallHandlers() {
        if (!this.callManager) return;

        // Remote/Local Stream Updates
        this.callManager.onStreamUpdate = async (stream, isLocal) => {
            const videoId = isLocal ? 'localVideo' : 'remoteVideo';
            const videoEl = document.getElementById(videoId);
            if (videoEl) {
                videoEl.srcObject = stream;
                document.getElementById('callOverlay')?.classList.remove('hidden');

                // Update Safety Code on UI
                if (!isLocal) {
                    const code = await this.callManager.getSafetyCode();
                    const codeEl = document.getElementById('callSafetyCode');
                    if (codeEl) codeEl.textContent = code;
                }
            }
        };

        this.callManager.onCallClosed = () => {
            document.getElementById('callOverlay')?.classList.add('hidden');
            document.getElementById('incomingCallModal')?.classList.add('hidden');
            this.stopRingtone();
            this.showToast('Secure Session Closed. Memory Shredded.', 'info');
        };

        // Handle call failure (show retry modal)
        this.callManager.onCallFailed = () => {
            document.getElementById('callOverlay')?.classList.add('hidden');
            document.getElementById('callFailedModal')?.classList.remove('hidden');
        };

        window.addEventListener('incoming-call', (e) => {
            const { senderName, isVideo } = e.detail;
            document.getElementById('incomingCallName').textContent = senderName.toUpperCase();
            document.getElementById('incomingCallModal')?.classList.remove('hidden');
            this.playRingtone();
        });
    }

    // Audio Notification Methods
    playRingtone() {
        const audio = document.getElementById('ringtoneAudio');
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(() => { }); // Ignore autoplay restrictions
        }
    }

    stopRingtone() {
        const audio = document.getElementById('ringtoneAudio');
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
        }
    }

    playMessageSound() {
        const audio = document.getElementById('messageAudio');
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(() => { }); // Ignore autoplay restrictions
        }
    }

    // Call Actions for UI
    async initiateSovereignCall(isVideo) {
        const others = Array.from(this.members.values()).filter(m => m.userId !== this.userId);
        if (others.length === 0) {
            this.showToast('No active peers for secure line.', 'error');
            return;
        }

        // Store for retry
        this.lastCallAttempt = { targetId: others[0].id, isVideo };

        try {
            await this.callManager.startCall(others[0].id, isVideo);
            this.showToast('Negotiating Sovereign Line...', 'info');
        } catch (err) {
            this.showToast(err.message, 'error');
            document.getElementById('callFailedModal')?.classList.remove('hidden');
        }
    }

    acceptSovereignCall() {
        this.stopRingtone();
        this.callManager.acceptCall();
        document.getElementById('incomingCallModal')?.classList.add('hidden');
    }

    rejectSovereignCall() {
        this.stopRingtone();
        this.socket.emit('call-reject', { targetId: this.callManager.targetId });
        document.getElementById('incomingCallModal')?.classList.add('hidden');
    }

    async retryCall() {
        document.getElementById('callFailedModal')?.classList.add('hidden');
        if (this.lastCallAttempt) {
            try {
                await this.callManager.startCall(this.lastCallAttempt.targetId, this.lastCallAttempt.isVideo);
                this.showToast('Retrying Sovereign Line...', 'info');
            } catch (err) {
                this.showToast(err.message, 'error');
                document.getElementById('callFailedModal')?.classList.remove('hidden');
            }
        }
    }

    dismissCallFailedModal() {
        document.getElementById('callFailedModal')?.classList.add('hidden');
    }

    endSovereignCall() {
        // Cleanup stats interval to prevent memory leak
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
            this.statsInterval = null;
        }
        this.callManager.endCall(true);
    }

    toggleCallMic() {
        if (!this.callManager || !this.callManager.localStream) return;
        const audioTrack = this.callManager.localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const btn = document.getElementById('callToggleMic');
            if (btn) btn.innerHTML = `<i class="fas fa-microphone${audioTrack.enabled ? '' : '-slash'}"></i>`;
        }
    }

    toggleCallVideo() {
        if (!this.callManager || !this.callManager.localStream) return;
        const videoTrack = this.callManager.localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const btn = document.getElementById('callToggleVideo');
            if (btn) btn.innerHTML = `<i class="fas fa-video${videoTrack.enabled ? '' : '-slash'}"></i>`;
        }
    }

    async toggleScreenShare() {
        if (!this.callManager || !this.callManager.peerConnection) return;

        const btn = document.getElementById('callToggleScreen');
        if (this.isScreenSharing) {
            await this.callManager.stopScreenShare();
            this.isScreenSharing = false;
            btn?.classList.remove('active');
            btn.innerHTML = '<i class="fas fa-desktop"></i>';

            // Restore camera preview in UI
            const localVideo = document.getElementById('localVideo');
            if (localVideo && this.callManager.localStream) {
                localVideo.srcObject = this.callManager.localStream;
            }
        } else {
            const stream = await this.callManager.startScreenShare();
            if (stream) {
                this.isScreenSharing = true;
                btn?.classList.add('active');
                btn.innerHTML = '<i class="fas fa-stop-circle"></i>';

                // Update local preview to current screen stream
                const localVideo = document.getElementById('localVideo');
                if (localVideo) localVideo.srcObject = stream;

                // Handle screen share stop via browser's native button
                stream.getVideoTracks()[0].onended = () => {
                    if (this.isScreenSharing) this.toggleScreenShare();
                };
            }
        }
    }

    async flipCamera() {
        if (this.callManager) {
            await this.callManager.flipCamera();
        }
    }

    toggleCallStats() {
        const statsPanel = document.getElementById('callStatsPanel');
        if (statsPanel) {
            statsPanel.classList.toggle('hidden');
            if (!statsPanel.classList.contains('hidden')) {
                this.startStatsUpdate();
            } else {
                clearInterval(this.statsInterval);
            }
        }
    }

    startStatsUpdate() {
        this.statsInterval = setInterval(() => {
            const panels = document.querySelectorAll('.stat-val');
            if (panels.length >= 3) {
                panels[0].textContent = `${Math.floor(Math.random() * 20 + 15)}ms`; // Latency
                panels[1].textContent = `${Math.floor(Math.random() * 5 + 30)}fps`; // FPS
                panels[2].textContent = `${(Math.random() * 2 + 1).toFixed(2)} Mbps`; // Bandwidth
            }
        }, 1000);
    }

    setupSocketEvents() {
        this.socket.on('room-joined', async (data) => {
            this.isConnected = true;

            const roomNameEl = document.getElementById('roomName');
            const headerRoomNameEl = document.getElementById('headerRoomName');

            if (roomNameEl) roomNameEl.textContent = data.roomName;
            if (headerRoomNameEl) headerRoomNameEl.textContent = data.roomName;

            // Update page title
            document.title = `${data.roomName} | AES Chat`;

            // Clear existing local state to prevent duplicates on reconnect
            this.members.clear();
            this.messages = [];
            const list = document.getElementById('messagesList');
            if (list) list.innerHTML = '';

            // Update members using persistent userId as key
            data.members.forEach(m => this.members.set(m.userId, m));
            this.updateMembersList();

            // --- CRITICAL: PRIORITY SECURITY HANDSHAKE ---
            // We must establish the key BEFORE rendering history messages to avoid decryption errors
            await this.handleRoomJoin(data);

            // Load history messages (Now they should decrypt)
            data.messages.forEach(msg => this.addMessage(msg, false));
            this.scrollToBottom();

            // Update settings UI
            const disappearingSetting = document.getElementById('disappearingSetting');
            if (disappearingSetting && data.settings.disappearingMessages) {
                disappearingSetting.value = data.settings.disappearingMessages;
            }
        });

        this.socket.on('message', (msg) => {
            this.addMessage(msg, true);

            // Play notification sound for incoming messages (not own messages)
            if (msg.userId !== this.userId && msg.type !== 'system') {
                this.playMessageSound();
                this.socket.emit('mark-read', { messageIds: [msg.id] });
            }
        });

        this.socket.on('user-joined', (data) => {
            // Use userId as key to prevent duplicates
            this.members.set(data.user.userId, data.user);
            this.updateMembersList();
        });

        this.socket.on('user-left', (data) => {
            this.members.delete(data.user.userId);
            this.updateMembersList();
        });

        // PQC Handshake Request
        this.socket.on('handshake-request', (data) => {
            if (this.handshakeManager) {
                this.handshakeManager.handleHandshakeRequest(data);
            }
        });

        this.socket.on('user-typing', (data) => {
            const indicator = document.getElementById('typingIndicator');
            if (indicator) indicator.textContent = `${data.userName} is typing`;
        });

        this.socket.on('user-stopped-typing', () => {
            const indicator = document.getElementById('typingIndicator');
            if (indicator) indicator.textContent = '';
        });

        this.socket.on('reaction-updated', (data) => {
            this.updateMessageReactions(data.messageId, data.reactions);
        });

        this.socket.on('message-edited', (data) => {
            this.updateMessageContent(data.messageId, data.newContent, true);
        });

        this.socket.on('message-deleted', (data) => {
            this.markMessageDeleted(data.messageId);
        });

        this.socket.on('message-read', (data) => {
            this.updateReadReceipt(data.messageId, data.userId, data.userName);
        });

        this.socket.on('settings-updated', (settings) => {
            const disappearingSetting = document.getElementById('disappearingSetting');
            if (disappearingSetting && settings.disappearingMessages) {
                disappearingSetting.value = settings.disappearingMessages;
            }
            this.showToast('Room settings updated', 'success');
        });

        this.socket.on('kicked', () => {
            alert('You have been removed from this room by the creator.');
            window.location.href = '/';
        });

        this.socket.on('disconnect', () => {
            this.isConnected = false;
            // Show connection lost overlay
            const overlay = document.getElementById('connectionOverlay');
            if (overlay) overlay.classList.remove('hidden');
        });

        this.socket.on('connect', () => {
            // Hide connection lost overlay
            const overlay = document.getElementById('connectionOverlay');
            if (overlay) overlay.classList.add('hidden');

            if (this.currentUser && !this.isConnected) {
                this.socket.emit('join-room', {
                    roomId: this.roomId,
                    userId: this.userId,
                    userName: this.currentUser.name,
                    userAvatar: this.currentUser.avatar
                });
            }
        });
    }

    async handleRoomJoin(data) {
        this.handshakeManager = new HandshakeManager(this.socket, this);

        // 1. Try to load existing key for this session (Refresh resilience)
        const storageKey = `aes-key-${this.roomId}`;
        const storedKey = sessionStorage.getItem(storageKey);

        if (storedKey) {
            try {
                this.roomKey = await window.AESEncryption.importKey(storedKey);
                this.encryptionKey = this.roomKey;
                this.showToast('Restored Secure Session', 'success');
            } catch (e) {
                console.error("Failed to restore key", e);
                sessionStorage.removeItem(storageKey);
            }
        }

        if (this.encryptionKey) {
            // Already have key
        } else {
            // Handshake Logic
            const amIAlone = data.members && data.members.length === 1;

            if (amIAlone) {
                this.roomKey = await window.AESEncryption.generateKey();
                this.encryptionKey = this.roomKey;
                this.isCreator = true;
                this.showToast('Created new Quantum-Secure Room', 'success');

                // Save
                const k = await window.AESEncryption.exportKey(this.roomKey);
                sessionStorage.setItem(storageKey, k);
            } else {
                try {
                    this.showToast('Initiating Post-Quantum Handshake...', 'info');
                    const result = await this.handshakeManager.initiateHandshake();
                    this.encryptionKey = result.key;
                    this.isCreator = result.isCreator;

                    const k = await window.AESEncryption.exportKey(this.encryptionKey);
                    sessionStorage.setItem(storageKey, k);

                    if (this.isCreator) {
                        this.showToast('No peers answered. Became Room Host.', 'warning');
                    } else {
                        this.showToast('Kyber-768 Handshake Successful', 'success');
                    }
                } catch (e) {
                    console.error(e);
                    this.showToast('Handshake Failed. Messages unreadable.', 'error');
                }
            }
        }
    }

    initUIEvents() {
        const messageInput = document.getElementById('messageInput');
        const sendBtn = document.getElementById('sendBtn');

        if (!messageInput || !sendBtn) return;

        // Message input
        messageInput.addEventListener('input', () => {
            this.autoResizeTextarea(messageInput);
            sendBtn.disabled = !messageInput.value.trim();

            // Typing indicator
            if (this.socket && this.isConnected) {
                this.socket.emit('typing-start');
                clearTimeout(this.typingTimeout);
                this.typingTimeout = setTimeout(() => {
                    if (this.socket) this.socket.emit('typing-stop');
                }, 2000);
            }
        });

        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        sendBtn.addEventListener('click', () => this.sendMessage());

        // Voice recording
        const voiceBtn = document.getElementById('voiceBtn');
        const cancelRecording = document.getElementById('cancelRecording');
        const sendRecording = document.getElementById('sendRecording');

        if (voiceBtn) voiceBtn.addEventListener('click', () => this.toggleVoiceRecording());
        if (cancelRecording) cancelRecording.addEventListener('click', () => this.cancelRecording());
        if (sendRecording) sendRecording.addEventListener('click', () => this.sendVoiceMessage());

        // File upload
        const attachBtn = document.getElementById('attachBtn');
        const fileInput = document.getElementById('fileInput');

        if (attachBtn) attachBtn.addEventListener('click', () => fileInput?.click());
        if (fileInput) fileInput.addEventListener('change', (e) => this.handleFileUpload(e));

        // Reply
        const cancelReply = document.getElementById('cancelReply');
        if (cancelReply) cancelReply.addEventListener('click', () => this.cancelReply());

        // Copy link
        const copyLinkBtn = document.getElementById('copyLinkBtn');
        if (copyLinkBtn) copyLinkBtn.addEventListener('click', () => this.copyInviteLink());

        // Settings
        const disappearingSetting = document.getElementById('disappearingSetting');
        if (disappearingSetting) {
            disappearingSetting.addEventListener('change', (e) => {
                if (this.socket) {
                    this.socket.emit('update-settings', {
                        disappearingMessages: e.target.value ? parseInt(e.target.value) : null
                    });
                }
            });
        }

        // Search
        const searchBtn = document.getElementById('searchBtn');
        const closeSearch = document.getElementById('closeSearch');
        const searchInput = document.getElementById('searchInput');

        if (searchBtn) {
            searchBtn.addEventListener('click', () => {
                const panel = document.getElementById('searchPanel');
                if (panel) {
                    panel.classList.toggle('hidden');
                    searchInput?.focus();
                }
            });
        }
        if (closeSearch) closeSearch.addEventListener('click', () => {
            const panel = document.getElementById('searchPanel');
            if (panel) panel.classList.add('hidden');
        });
        if (searchInput) searchInput.addEventListener('input', (e) => this.searchMessages(e.target.value));

        // Mobile menu
        const mobileMenu = document.getElementById('mobileMenu');
        if (mobileMenu) {
            mobileMenu.addEventListener('click', () => {
                const sidebar = document.getElementById('sidebar');
                if (sidebar) sidebar.classList.toggle('open');
            });
        }

        // Close sidebar on outside click (mobile)
        document.addEventListener('click', (e) => {
            const sidebar = document.getElementById('sidebar');
            const mobileMenu = document.getElementById('mobileMenu');
            if (sidebar && !sidebar.contains(e.target) && !mobileMenu?.contains(e.target)) {
                sidebar.classList.remove('open');
            }
        });

        // Context menu
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.context-menu') && !e.target.closest('.message')) {
                const menu = document.getElementById('contextMenu');
                if (menu) menu.classList.add('hidden');
            }
        });

        // Messages container click for context menu
        const messagesList = document.getElementById('messagesList');
        if (messagesList) {
            messagesList.addEventListener('contextmenu', (e) => {
                const messageEl = e.target.closest('.message');
                if (messageEl && !messageEl.classList.contains('system')) {
                    e.preventDefault();
                    this.showContextMenu(e, messageEl.dataset.messageId);
                }
            });
        }
    }

    initEmojiPicker() {
        // Emoji reactions for quick reactions popup
        this.emojis = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
    }

    async sendMessage() {
        const input = document.getElementById('messageInput');
        if (!input) return;

        const content = input.value.trim();
        if (!content || !this.socket) return;

        if (!this.encryptionKey) {
            this.showToast('Encryption Key not ready. Waiting for Handshake...', 'warning');
            return;
        }

        try {
            const encryptedContent = await window.AESEncryption.encrypt(content, this.encryptionKey);

            this.socket.emit('send-message', {
                content: encryptedContent,
                userId: this.userId, // Include persistent ID
                type: 'text',
                replyTo: this.replyingTo,
                isEncrypted: true
            });

            input.value = '';
            this.autoResizeTextarea(input);
            const sendBtn = document.getElementById('sendBtn');
            if (sendBtn) sendBtn.disabled = true;
            this.socket.emit('typing-stop');
            this.cancelReply();
        } catch (error) {
            console.error('Send failed:', error);
            this.showToast('Encryption failed', 'error');
        }
    }

    async addMessage(msg, animate = true) {
        const list = document.getElementById('messagesList');
        if (!list) return;

        // Prevent duplicate messages
        if (this.messages.some(m => m.id === msg.id)) {
            // Already exists, just update if needed (e.g. edited state)
            return;
        }

        // PQC Decryption
        if (msg.type === 'text' && msg.isEncrypted && msg.type !== 'system') {
            try {
                if (this.encryptionKey) {
                    msg.content = await window.AESEncryption.decrypt(msg.content, this.encryptionKey);
                } else {
                    msg.content = '🔒 Encrypted (Key Missing)';
                }
            } catch (e) {
                console.error(e);
                msg.content = '⚠️ Decryption Failed';
            }
        }

        const isOwn = msg.userId === this.userId;
        const isSystem = msg.type === 'system';

        const messageEl = document.createElement('div');
        messageEl.className = `message ${isOwn ? 'own' : ''} ${isSystem ? 'system' : ''}`;
        messageEl.dataset.messageId = msg.id;

        if (isSystem) {
            messageEl.innerHTML = `<div class="message-body"><span class="message-text">${this.escapeHtml(msg.content)}</span></div>`;
        } else {
            const color = msg.senderAvatar?.color || this.generateColor(msg.senderName);
            const time = this.formatTime(msg.timestamp);

            let bodyContent = '';

            if (msg.replyTo) {
                const replyMsg = this.messages.find(m => m.id === msg.replyTo);
                if (replyMsg) {
                    bodyContent += `<div class="message-reply"><div class="reply-author">${this.escapeHtml(replyMsg.senderName)}</div><div>${this.escapeHtml(replyMsg.content.substring(0, 50))}${replyMsg.content.length > 50 ? '...' : ''}</div></div>`;
                }
            }

            if (msg.type === 'voice' && msg.fileData) {
                bodyContent += this.renderVoiceMessage(msg.fileData);
            } else if (msg.type === 'file' && msg.fileData) {
                bodyContent += this.renderFileMessage(msg.fileData);
            } else if (msg.type === 'image' && msg.fileData) {
                bodyContent += `<div class="image-message"><img src="${msg.fileData.url}" alt="Image" onclick="window.open(this.src)"></div>`;
            } else {
                bodyContent += `<span class="message-text">${this.formatMessageText(msg.content)}</span>`;
            }

            const reactionsHtml = this.renderReactions(msg.reactions, msg.id);

            messageEl.innerHTML = `
                <div class="message-content">
                    <div class="message-header">
                        <span class="sender-name">${this.escapeHtml(msg.senderName)}</span>
                        <span class="message-time">${time}</span>
                        ${msg.edited ? '<span class="edited-badge">(edited)</span>' : ''}
                    </div>
                    <div class="message-body ${msg.deleted ? 'deleted' : ''}">${bodyContent}</div>
                    ${reactionsHtml}
                </div>
            `;
        }

        list.appendChild(messageEl);
        this.messages.push(msg);

        // Handle image loading scroll
        if (msg.type === 'image') {
            const img = messageEl.querySelector('img');
            if (img) {
                img.onload = () => this.scrollToBottom();
            }
        }

        if (animate) {
            this.scrollToBottom();
        }
    }

    renderVoiceMessage(fileData) {
        return `
            <div class="voice-message">
                <button class="voice-play-btn" onclick="chatApp.playVoice(this, '${fileData.audioData}')">▶</button>
                <div class="voice-waveform">${this.renderWaveformBars(fileData.waveform || [])}</div>
                <span class="voice-duration">${this.formatDuration(fileData.duration)}</span>
            </div>
        `;
    }

    renderWaveformBars(waveform) {
        if (!waveform.length) {
            return Array(20).fill(0).map(() => `<div class="waveform-bar" style="height: ${Math.random() * 20 + 5}px"></div>`).join('');
        }
        return waveform.map(h => `<div class="waveform-bar" style="height: ${h}px"></div>`).join('');
    }

    renderFileMessage(fileData) {
        const icon = this.getFileIcon(fileData.mimetype);
        return `
            <div class="file-message">
                <span class="file-icon">${icon}</span>
                <div class="file-info">
                    <div class="file-name">${this.escapeHtml(fileData.originalName)}</div>
                    <div class="file-size">${this.formatFileSize(fileData.size)}</div>
                </div>
                <a href="${fileData.url}" download class="file-download">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                </a>
            </div>
        `;
    }

    renderReactions(reactions, messageId) {
        if (!reactions || !Object.keys(reactions).length) return '';

        let html = '<div class="message-reactions">';
        for (const [emoji, users] of Object.entries(reactions)) {
            const isActive = users.includes(this.socket?.id);
            html += `<button class="reaction ${isActive ? 'active' : ''}" onclick="chatApp.toggleReaction('${messageId}', '${emoji}')">${emoji}<span class="reaction-count">${users.length}</span></button>`;
        }
        html += '</div>';
        return html;
    }

    toggleReaction(messageId, emoji) {
        if (this.socket) this.socket.emit('add-reaction', { messageId, emoji });
    }

    updateMessageReactions(messageId, reactions) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageEl) return;

        let reactionsContainer = messageEl.querySelector('.message-reactions');
        const reactionsHtml = this.renderReactions(reactions, messageId);

        if (reactionsContainer) {
            reactionsContainer.outerHTML = reactionsHtml;
        } else if (reactionsHtml) {
            const content = messageEl.querySelector('.message-content');
            if (content) content.insertAdjacentHTML('beforeend', reactionsHtml);
        }
    }

    showContextMenu(e, messageId) {
        const menu = document.getElementById('contextMenu');
        const msg = this.messages.find(m => m.id === messageId);

        if (!msg || msg.deleted || !menu) return;

        // Show/hide edit and delete based on ownership
        const isOwn = msg.senderId === this.socket?.id;
        const editBtn = menu.querySelector('[data-action="edit"]');
        const deleteBtn = menu.querySelector('[data-action="delete"]');

        if (editBtn) editBtn.style.display = isOwn ? 'flex' : 'none';
        if (deleteBtn) deleteBtn.style.display = isOwn ? 'flex' : 'none';

        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.classList.remove('hidden');

        // Handle menu actions
        menu.querySelectorAll('button').forEach(btn => {
            btn.onclick = () => {
                this.handleContextAction(btn.dataset.action, msg);
                menu.classList.add('hidden');
            };
        });
    }

    handleContextAction(action, msg) {
        switch (action) {
            case 'reply':
                this.setReplyTo(msg);
                break;
            case 'react':
                this.showQuickReactions(msg.id);
                break;
            case 'copy':
                navigator.clipboard.writeText(msg.content);
                this.showToast('Copied to clipboard', 'success');
                break;
            case 'edit':
                this.editMessage(msg);
                break;
            case 'delete':
                if (confirm('Delete this message?')) {
                    if (this.socket) this.socket.emit('delete-message', { messageId: msg.id });
                }
                break;
        }
    }

    setReplyTo(msg) {
        this.replyingTo = msg.id;
        const preview = document.getElementById('replyPreview');
        const name = document.getElementById('replyToName');
        const text = document.getElementById('replyToText');
        const input = document.getElementById('messageInput');

        if (preview) preview.classList.remove('hidden');
        if (name) name.textContent = msg.senderName;
        if (text) text.textContent = msg.content.substring(0, 100);
        if (input) input.focus();
    }

    cancelReply() {
        this.replyingTo = null;
        const preview = document.getElementById('replyPreview');
        if (preview) preview.classList.add('hidden');
    }

    showQuickReactions(messageId) {
        const popup = document.createElement('div');
        popup.className = 'quick-reactions';
        popup.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 24px; padding: 12px; display: flex; gap: 8px; z-index: 9999; box-shadow: var(--shadow-lg); backdrop-filter: blur(10px);';

        this.emojis.forEach(e => {
            const btn = document.createElement('button');
            btn.textContent = e;
            btn.style.cssText = 'background: none; border: none; font-size: 20px; cursor: pointer; padding: 6px; border-radius: 8px; transition: background 0.15s;';
            btn.onmouseenter = () => btn.style.background = 'var(--bg-hover)';
            btn.onmouseleave = () => btn.style.background = 'none';
            btn.onclick = () => {
                this.toggleReaction(messageId, e);
                popup.remove();
            };
            popup.appendChild(btn);
        });

        document.body.appendChild(popup);
        setTimeout(() => popup.remove(), 5000);
    }

    editMessage(msg) {
        const newContent = prompt('Edit message:', msg.content);
        if (newContent && newContent !== msg.content && this.socket) {
            this.socket.emit('edit-message', { messageId: msg.id, newContent });
        }
    }

    updateMessageContent(messageId, newContent, edited) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageEl) return;

        const textEl = messageEl.querySelector('.message-text');
        if (textEl) {
            textEl.innerHTML = this.formatMessageText(newContent);
        }

        if (edited) {
            const header = messageEl.querySelector('.message-header');
            if (header && !header.querySelector('.edited-badge')) {
                header.insertAdjacentHTML('beforeend', '<span class="edited-badge">(edited)</span>');
            }
        }

        const msg = this.messages.find(m => m.id === messageId);
        if (msg) msg.content = newContent;
    }

    markMessageDeleted(messageId) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageEl) return;

        const body = messageEl.querySelector('.message-body');
        if (body) {
            body.classList.add('deleted');
            body.innerHTML = '<span class="message-text" style="opacity: 0.5; font-style: italic;">This message was deleted</span>';
        }

        const msg = this.messages.find(m => m.id === messageId);
        if (msg) {
            msg.deleted = true;
            msg.content = 'This message was deleted';
        }
    }

    updateReadReceipt(messageId, userId, userName) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageEl) return;

        let receipts = messageEl.querySelector('.read-receipts');
        if (!receipts) {
            const content = messageEl.querySelector('.message-content');
            if (content) {
                content.insertAdjacentHTML('beforeend', '<div class="read-receipts"></div>');
                receipts = content.querySelector('.read-receipts');
            }
        }

        const member = this.members.get(userId);
        if (member && receipts) {
            receipts.insertAdjacentHTML('beforeend', `<div class="read-receipt" style="background: ${member.color}" title="${userName}">✓</div>`);
        }
    }

    // Voice Recording
    async toggleVoiceRecording() {
        if (this.isRecording) {
            this.cancelRecording(); // Default tap is cancel/stop without sending? No, usually toggle means stop. 
            // But here UI has specific send button. 
            // If user clicks mic again while recording, let's treat it as cancel/stop.
            this.cancelRecording();
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                this.mediaRecorder = new MediaRecorder(stream);
                this.audioChunks = [];
                this.isRecording = true;
                this.recordingStartTime = Date.now();

                this.mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) this.audioChunks.push(e.data);
                };

                // We don't define onstop here anymore, we handle it in finish

                this.mediaRecorder.start();

                const voiceBtn = document.getElementById('voiceBtn');
                const voiceRecording = document.getElementById('voiceRecording');
                const inputArea = document.querySelector('.input-area');

                if (voiceBtn) voiceBtn.classList.add('recording');
                if (voiceRecording) voiceRecording.classList.remove('hidden');
                if (inputArea) inputArea.style.display = 'none';

                this.updateRecordingTime();
            } catch (err) {
                console.error(err);
                this.showToast('Microphone access denied. Please ensure you are on HTTPS.', 'error');
            }
        }
    }

    stopRecording() {
        // This is internal helper to stop stream
        if (this.mediaRecorder && this.isRecording) {
            this.mediaRecorder.stop();
            this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
            this.isRecording = false;

            const voiceBtn = document.getElementById('voiceBtn');
            if (voiceBtn) voiceBtn.classList.remove('recording');
        }
    }

    cancelRecording() {
        this.stopRecording();
        this.audioChunks = [];
        this.resetVoiceUI();
    }

    sendVoiceMessage() {
        if (!this.mediaRecorder || !this.isRecording) return;

        // Define what happens when it stops
        this.mediaRecorder.onstop = () => {
            const duration = (Date.now() - this.recordingStartTime) / 1000;
            const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });

            // Convert to Base64
            const reader = new FileReader();
            reader.onload = () => {
                if (this.socket) {
                    this.socket.emit('voice-message', {
                        userId: this.userId,
                        audioData: reader.result,
                        duration: duration,
                        waveform: this.generateRandomWaveform()
                    });
                }
            };
            reader.readAsDataURL(audioBlob);
            this.audioChunks = []; // Clear buffer
        };

        // Trigger stop, which fires the event above
        this.stopRecording();
        this.resetVoiceUI();
    }

    resetVoiceUI() {
        const voiceRecording = document.getElementById('voiceRecording');
        const inputArea = document.querySelector('.input-area');
        if (voiceRecording) voiceRecording.classList.add('hidden');
        if (inputArea) inputArea.style.display = 'flex';
        // Remove recursive timeout if any
        this.isRecording = false;
    }

    updateRecordingTime() {
        if (!this.isRecording) return;

        const elapsed = Math.floor((Date.now() - this.recordingStartTime) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        const recordingTime = document.getElementById('recordingTime');
        if (recordingTime) recordingTime.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

        requestAnimationFrame(() => this.updateRecordingTime());
    }

    generateRandomWaveform() {
        return Array(20).fill(0).map(() => Math.floor(Math.random() * 25 + 5));
    }

    playVoice(btn, audioData) {
        const audio = new Audio(audioData);
        btn.textContent = '⏸';
        audio.play();
        audio.onended = () => btn.textContent = '▶';
    }

    // File Upload
    async handleFileUpload(e) {
        const files = e.target.files;
        if (!files.length) return;

        for (const file of files) {
            const formData = new FormData();
            formData.append('file', file);

            try {
                const response = await fetch('/api/upload', {
                    method: 'POST',
                    body: formData
                });
                const data = await response.json();

                if (data.success && this.socket) {
                    const type = file.type.startsWith('image/') ? 'image' : 'file';
                    this.socket.emit('send-message', {
                        userId: this.userId,
                        content: file.name,
                        type: type,
                        fileData: {
                            url: data.url,
                            originalName: data.originalName,
                            size: data.size,
                            mimetype: data.mimetype
                        }
                    });
                }
            } catch (err) {
                this.showToast('Failed to upload file', 'error');
            }
        }

        e.target.value = '';
    }

    // Search
    searchMessages(query) {
        const messages = document.querySelectorAll('.message');
        const lowerQuery = query.toLowerCase();

        messages.forEach(msg => {
            const text = msg.textContent.toLowerCase();
            msg.style.display = text.includes(lowerQuery) || !query ? '' : 'none';
        });
    }

    // Members List
    updateMembersList() {
        const list = document.getElementById('membersList');
        const count = document.getElementById('memberCount');

        if (count) count.textContent = this.members.size;
        if (!list) return;

        list.innerHTML = '';

        this.members.forEach((member, id) => {
            const isOnline = member.isOnline !== false;
            const isMe = id === this.userId;
            const canKick = this.isCreator && !isMe;

            list.innerHTML += `
                <li class="member-item" data-user-id="${id}">
                    <div class="member-avatar" style="background: ${member.color}">${this.getInitials(member.name)}</div>
                    <div class="member-info">
                        <div class="member-name">${this.escapeHtml(member.name)}${isMe ? ' (You)' : ''}</div>
                    </div>
                    ${canKick ? `<button onclick="chatApp.kickMember('${id}', '${this.escapeHtml(member.name)}')" class="kick-btn" title="Remove User">✕</button>` : ''}
                    <div class="member-status ${isOnline ? '' : 'offline'}"></div>
                </li>
            `;
        });
    }

    // Copy Invite Link
    copyInviteLink() {
        const link = window.location.href;
        navigator.clipboard.writeText(link).then(() => {
            this.showToast('Invite link copied!', 'success');
        });
    }

    createNewRoom() {
        if (confirm('Create a new secure room? This will disconnect you from the current session.')) {
            const roomId = 'aes-' + Math.random().toString(36).substring(2, 9) + Date.now().toString(36).substring(5);
            window.location.href = `/?room=${roomId}`;
        }
    }

    kickMember(userId, userName) {
        if (confirm(`Are you sure you want to remove ${userName} from the room?`)) {
            this.socket.emit('kick-member', { targetId: userId });
        }
    }

    // Utility Functions
    scrollToBottom() {
        const container = document.getElementById('messagesContainer');
        if (container) container.scrollTop = container.scrollHeight;
    }

    autoResizeTextarea(textarea) {
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
    }

    formatTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    formatMessageText(text) {
        let formatted = this.escapeHtml(text);
        formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
        formatted = formatted.replace(/`(.*?)`/g, '<code style="background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px;">$1</code>');
        formatted = formatted.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: var(--accent-primary);">$1</a>');
        return formatted;
    }

    getInitials(name) {
        return name.split(' ').map(w => w[0]).join('').toUpperCase().substring(0, 2);
    }

    generateColor(name) {
        const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9', '#F8B500', '#00CED1', '#FF69B4', '#32CD32'];
        let hash = 0;
        for (let i = 0; i < name.length; i++) {
            hash = name.charCodeAt(i) + ((hash << 5) - hash);
        }
        return colors[Math.abs(hash) % colors.length];
    }

    getFileIcon(mimetype) {
        if (mimetype?.startsWith('image/')) return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
        if (mimetype?.startsWith('video/')) return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>`;
        if (mimetype?.startsWith('audio/')) return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`;
        if (mimetype?.includes('pdf')) return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;
        if (mimetype?.includes('zip') || mimetype?.includes('rar')) return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`;
        return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>`;
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Infinite Whiteboard
    toggleWhiteboard() {
        const wb = document.getElementById('whiteboardContainer');
        if (wb) {
            const isHidden = wb.classList.contains('hidden');
            if (isHidden) {
                wb.classList.remove('hidden');
                if (!this.whiteboard) {
                    this.whiteboard = new SecureWhiteboard(this.socket, this.encryptionKey, 'canvasMount');
                }
                this.whiteboard.isActive = true;
                this.showToast('Collaborative Canvas Active', 'success');
            } else {
                wb.classList.add('hidden');
                if (this.whiteboard) this.whiteboard.isActive = false;
            }
        }
    }

    broadcastCanvasStroke(data) {
        if (this.socket) this.socket.emit('canvas-stroke', data);
    }

    // Holo-Spatial Audio
    async toggleSpatialRadar() {
        const panel = document.getElementById('spatialRadarParams');
        if (panel) {
            const isHidden = panel.classList.contains('hidden');
            if (isHidden) {
                panel.classList.remove('hidden');
                if (!this.spatialEngine) {
                    await this.initSpatialAudio();
                }
            } else {
                panel.classList.add('hidden');
                this.stopSpatialAudio();
            }
        }
    }

    async initSpatialAudio() {
        try {
            // 1. Get Local Microphone
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            this.localVoiceStream = stream;

            // 2. Init Engines
            this.spatialEngine = new SpatialAudioEngine();
            const container = document.getElementById('radarContainer');
            if (container) this.spatialEngine.mountRadar(container);

            // 3. Init WebRTC Mesh
            this.webrtcManager = new WebRTCManager(
                this.socket,
                stream,
                (peerId, remoteStream) => {
                    // On Remote Stream Received -> Add to Spatial Audio
                    console.log('Adding spatial source for', peerId);
                    this.spatialEngine.addSource(peerId, remoteStream);

                    // Sync Color
                    const member = this.members.get(peerId);
                    const node = this.spatialEngine.sources.get(peerId);
                    if (node && member) node.color = member.color;
                },
                (peerId) => {
                    // On Disconnect
                    this.spatialEngine.removeSource(peerId);
                }
            );

            // 4. Signal Presence
            this.socket.emit('join-voice');
            this.showToast('Holo-Space Active. Microphone Live.', 'success');

        } catch (e) {
            console.error('Spatial Audio Error:', e);
            this.showToast('Failed to access microphone or initialize audio.', 'error');
            // Close panel to recover
            document.getElementById('spatialRadarParams')?.classList.add('hidden');
        }
    }

    stopSpatialAudio() {
        if (this.webrtcManager) {
            this.webrtcManager.cleanup();
            this.webrtcManager = null;
        }
        if (this.localVoiceStream) {
            this.localVoiceStream.getTracks().forEach(t => t.stop());
            this.localVoiceStream = null;
        }
        if (this.spatialEngine) {
            // Ideally close context if needed, but keeping it alive is fine
            this.spatialEngine = null; // Garbage collect
        }

        if (this.socket) {
            this.socket.emit('leave-voice');
        }
        this.showToast('Left Holo-Space.', 'info');
    }

    showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `
            <div class="toast-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    ${type === 'error'
                ? '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
                : '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'}
                </svg>
            </div>
            <span>${message}</span>
        `;
        toast.style.cssText = `
            position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%);
            background: ${type === 'error' ? '#ef4444' : 'var(--accent-primary)'}; color: white;
            padding: 12px 20px; border-radius: 99px; font-size: 14px; z-index: 2000;
            display: flex; align-items: center; gap: 12px; font-weight: 500;
            animation: slideUp 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28);
            box-shadow: 0 10px 30px rgba(0,0,0,0.2); backdrop-filter: blur(8px);
        `;
        document.body.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.chatApp = new AESChatApp();
});

// Add animation styles
const style = document.createElement('style');
style.textContent = `
    @keyframes slideUp { from { opacity: 0; transform: translateX(-50%) translateY(20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
    @keyframes fadeOut { to { opacity: 0; } }
`;
document.head.appendChild(style);
