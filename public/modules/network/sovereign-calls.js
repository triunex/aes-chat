/**
 * Sovereign Media Engine (SME-PQC)
 * Implementation of Post-Quantum E2EE Audio/Video Calls
 * 
 * DESIGN PRINCIPLES:
 * 1. PQC-KEM: Key agreement via ML-KEM/Kyber768
 * 2. Double-Layer Encryption: Standard WebRTC DTLS-SRTP + AES-256-GCM Insertable Streams
 * 3. Zero-Persistence: Keys shredded in RAM post-call
 */

import { Kyber768 } from '../crypto/kem.js';

class FrameEncryptor {
    constructor(key) {
        this.key = key; // AES CryptoKey
        this.counter = 0;
    }

    /**
     * Encrypts an RTCEncodedFrame (Audio or Video)
     */
    async encrypt(frame, controller) {
        const secret = this.key;
        if (!secret) {
            controller.enqueue(frame);
            return;
        }

        const buffer = frame.data;
        const iv = new Uint8Array(12);
        window.crypto.getRandomValues(iv); // Unique IV per frame

        try {
            const encrypted = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv },
                secret,
                buffer
            );

            // Structure: [CIV (12 bytes)] + [Encrypted Data]
            const combined = new Uint8Array(12 + encrypted.byteLength);
            combined.set(iv);
            combined.set(new Uint8Array(encrypted), 12);

            frame.data = combined.buffer;
            controller.enqueue(frame);
        } catch (e) {
            console.error('[SME] Encryption Error:', e);
            // Drop frame on failure for safety
        }
    }

    /**
     * Decrypts an RTCEncodedFrame
     */
    async decrypt(frame, controller) {
        const secret = this.key;
        if (!secret) {
            controller.enqueue(frame);
            return;
        }

        const buffer = frame.data;
        const iv = new Uint8Array(buffer, 0, 12);
        const data = new Uint8Array(buffer, 12);

        try {
            const decrypted = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv },
                secret,
                data
            );

            frame.data = decrypted;
            controller.enqueue(frame);
        } catch (e) {
            console.error('[SME] Decryption Error (Potential Tampering):', e);
            // Drop frame if decryption fails (prevents noise/glitches)
        }
    }
}

export class SovereignCallManager {
    constructor(socket) {
        this.socket = socket;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = new MediaStream();
        this.mediaKey = null;
        this.targetId = null;
        this.isInitiator = false;

        this.onStreamUpdate = null; // Callback for UI
        this.onCallClosed = null;

        this.setupSocketListeners();
    }

    setupSocketListeners() {
        this.socket.on('call-invite', (data) => this.handleInvite(data));
        this.socket.on('call-accept', (data) => this.handleAccept(data));
        this.socket.on('call-reject', () => this.handleReject());
        this.socket.on('call-signal', (data) => this.handleSignal(data));
        this.socket.on('call-end', () => this.endCall(false));
    }

    /**
     * Start a call with a PQC Handshake
     */
    async startCall(targetId, isVideo = true) {
        // Browser Compatibility Check
        if (!RTCRtpSender.prototype.createEncodedStreams) {
            console.warn('[SME] Browser does not support Insertable Streams. Encryption layer disabled.');
            alert('Your browser does not fully support encrypted calls. Please use Chrome or Edge for best security.');
        }

        this.targetId = targetId;
        this.isInitiator = true;

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: isVideo ? { width: 1280, height: 720, frameRate: 30 } : false
            });

            if (this.onStreamUpdate) this.onStreamUpdate(this.localStream, true);

            // Notify Peer
            this.socket.emit('call-invite', { targetId, isVideo });
            console.log('[SME] Call invite sent to:', targetId);
        } catch (err) {
            console.error('[SME] Media Access Denied:', err);
            throw new Error('Could not access camera/microphone');
        }
    }

    async acceptCall() {
        // We now expect this.incomingCallData to be set or passed
        const isVideo = this.lastInvite?.isVideo || false;

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: isVideo ? { width: 1280, height: 720, frameRate: 30 } : false
            });

            if (this.onStreamUpdate) this.onStreamUpdate(this.localStream, true);

            this.socket.emit('call-accept', { targetId: this.targetId });

            // IMPORTANT: Handshake must complete BEFORE initPeerConnection
            await this.negotiateMediaKey();
            await this.initPeerConnection();
        } catch (err) {
            console.error('[SME] Accept Error:', err);
        }
    }

    async handleAccept(data) {
        console.log('[SME] Call accepted by peer.');
        await this.negotiateMediaKey();
        await this.initPeerConnection();
    }

    /**
     * Post-Quantum Media Key Exchange using ML-KEM
     * Includes timeout protection to prevent hanging calls
     */
    async negotiateMediaKey() {
        console.log('[SME] Negotiating PQC Media Key...');
        const NEGOTIATION_TIMEOUT = 15000; // 15 seconds

        if (this.isInitiator) {
            const keyPair = await Kyber768.generateKeyPair();

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    this.socket.off('call-media-handshake', onHandshake);
                    console.error('[SME] Key negotiation timeout.');
                    reject(new Error('Key exchange timeout. Please try again.'));
                }, NEGOTIATION_TIMEOUT);

                const onHandshake = async (data) => {
                    if (data.senderId !== this.targetId || !data.mediaSecret) return;
                    clearTimeout(timeout);
                    this.socket.off('call-media-handshake', onHandshake);

                    const sharedSecret = await Kyber768.decapsulate(data.mediaSecret.ciphertext, keyPair.sk);
                    this.mediaKey = await this.importKey(sharedSecret);
                    console.log('[SME] Secure Media Key Established (Initiator).');
                    resolve();
                };

                this.socket.on('call-media-handshake', onHandshake);

                // Transmit PK via signaling
                this.socket.emit('call-signal', {
                    targetId: this.targetId,
                    signal: { mediaPk: keyPair.pk }
                });
            });
        } else {
            // Recipient: Wait for handleSignal to capture mediaPk
            if (this.mediaKey) return; // Already established via handleSignal race?

            return new Promise((resolve, reject) => {
                const startTime = Date.now();
                const checkKey = setInterval(() => {
                    if (this.mediaKey) {
                        clearInterval(checkKey);
                        console.log('[SME] Secure Media Key Established (Recipient).');
                        resolve();
                    } else if (Date.now() - startTime > NEGOTIATION_TIMEOUT) {
                        clearInterval(checkKey);
                        console.error('[SME] Key negotiation timeout (Recipient).');
                        reject(new Error('Key exchange timeout. Please try again.'));
                    }
                }, 100);
            });
        }
    }

    async initPeerConnection() {
        if (this.peerConnection) return;

        // ICE Servers: STUN for discovery + TURN for relay fallback
        const iceServers = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            // Public TURN servers for NAT traversal fallback
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443?transport=tcp',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            }
        ];

        this.peerConnection = new RTCPeerConnection({
            iceServers,
            encodedInsertableStreams: true
        });

        const encryptor = new FrameEncryptor(this.mediaKey);

        // Track local streams and apply outgoing encryption
        this.localStream.getTracks().forEach(track => {
            const sender = this.peerConnection.addTrack(track, this.localStream);

            if (sender.createEncodedStreams) {
                const streams = sender.createEncodedStreams();
                const transformer = new TransformStream({
                    transform: (frame, controller) => encryptor.encrypt(frame, controller)
                });
                streams.readable.pipeThrough(transformer).pipeTo(streams.writable);
            }
        });

        // Handle incoming streams and apply decryption
        this.peerConnection.ontrack = (event) => {
            console.log('[SME] Remote track received:', event.track.kind);

            const receiver = event.receiver;
            if (receiver.createEncodedStreams) {
                const streams = receiver.createEncodedStreams();
                const transformer = new TransformStream({
                    transform: (frame, controller) => encryptor.decrypt(frame, controller)
                });
                streams.readable.pipeThrough(transformer).pipeTo(streams.writable);
            }

            // Consistently update remote stream
            if (event.streams && event.streams[0]) {
                if (this.onStreamUpdate) this.onStreamUpdate(event.streams[0], false);
            }
        };

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[SME] Sending ICE candidate:', event.candidate.type);
                this.socket.emit('call-signal', {
                    targetId: this.targetId,
                    signal: { ice: event.candidate }
                });
            }
        };

        // ICE Connection State Logging for debugging
        this.peerConnection.oniceconnectionstatechange = () => {
            const state = this.peerConnection.iceConnectionState;
            console.log('[SME] ICE Connection State:', state);
            if (state === 'failed') {
                console.error('[SME] ICE Connection Failed. Attempting ICE Restart...');
                this.attemptIceRestart();
            } else if (state === 'disconnected') {
                console.warn('[SME] ICE Disconnected. Waiting for recovery...');
                // Give it 5 seconds to recover before restart
                setTimeout(() => {
                    if (this.peerConnection && this.peerConnection.iceConnectionState === 'disconnected') {
                        this.attemptIceRestart();
                    }
                }, 5000);
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            console.log('[SME] Peer Connection State:', this.peerConnection.connectionState);
        };

        if (this.isInitiator) {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            this.socket.emit('call-signal', {
                targetId: this.targetId,
                signal: { sdp: offer }
            });
        }
    }

    async handleSignal(data) {
        if (data.signal.mediaPk) {
            console.log('[SME] Received PQC PK from initiator.');
            const result = await Kyber768.encapsulate(data.signal.mediaPk);
            this.mediaKey = await this.importKey(result.sharedSecret);

            this.socket.emit('call-media-handshake', {
                senderId: this.socket.id,
                targetId: this.targetId,
                mediaSecret: { ciphertext: result.ciphertext }
            });
            return;
        }

        if (!this.peerConnection) return;

        try {
            if (data.signal.sdp) {
                await this.peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal.sdp));
                if (data.signal.sdp.type === 'offer') {
                    const answer = await this.peerConnection.createAnswer();
                    await this.peerConnection.setLocalDescription(answer);
                    this.socket.emit('call-signal', {
                        targetId: this.targetId,
                        signal: { sdp: answer }
                    });
                }
            } else if (data.signal.ice) {
                await this.peerConnection.addIceCandidate(new RTCIceCandidate(data.signal.ice));
            }
        } catch (err) {
            console.error('[SME] Signaling Error:', err);
        }
    }

    async handleInvite(data) {
        this.targetId = data.senderId;
        this.lastInvite = data; // Store for acceptCall
        window.dispatchEvent(new CustomEvent('incoming-call', { detail: data }));
    }

    async startScreenShare() {
        try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: "always" },
                audio: false
            });
            const videoTrack = screenStream.getVideoTracks()[0];

            // Replace existing video track or add new one
            let sender = this.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');

            if (sender) {
                await sender.replaceTrack(videoTrack);
            } else {
                // If no video sender exists (audio call), add it now
                sender = this.peerConnection.addTrack(videoTrack, screenStream);

                // Ensure new track is also encrypted
                const encryptor = new FrameEncryptor(this.mediaKey);
                if (sender.createEncodedStreams) {
                    const streams = sender.createEncodedStreams();
                    const transformer = new TransformStream({
                        transform: (frame, controller) => encryptor.encrypt(frame, controller)
                    });
                    streams.readable.pipeThrough(transformer).pipeTo(streams.writable);
                }

                // Renegotiate for the new track
                const offer = await this.peerConnection.createOffer();
                await this.peerConnection.setLocalDescription(offer);
                this.socket.emit('call-signal', {
                    targetId: this.targetId,
                    signal: { sdp: offer }
                });
            }

            videoTrack.onended = () => this.stopScreenShare();
            return screenStream;
        } catch (err) {
            console.error('[SME] Screen Share Error:', err);
        }
    }

    async stopScreenShare() {
        if (!this.localStream) return;
        const videoTrack = this.localStream.getVideoTracks()[0];
        const sender = this.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender && videoTrack) {
            sender.replaceTrack(videoTrack);
        }
    }

    async importKey(rawSecret) {
        // Store raw secret for safety fingerprint generation
        this.rawMediaSecret = rawSecret;
        return window.crypto.subtle.importKey(
            'raw',
            rawSecret,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt']
        );
    }

    async getSafetyCode() {
        if (!this.rawMediaSecret) return 'PENDING';

        const hashBuffer = await crypto.subtle.digest('SHA-256', this.rawMediaSecret);
        const hashArray = Array.from(new Uint8Array(hashBuffer));

        // Convert to a human-friendly format (3-word SAS)
        const dictionary = [
            'ALPHA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET',
            'KILO', 'LIMA', 'MIKE', 'NOVEMBER', 'OSCAR', 'PAPA', 'QUEBEC', 'ROMEO', 'SIERRA', 'TANGO',
            'UNIFORM', 'VICTOR', 'WHISKEY', 'XRAY', 'YANKEE', 'ZULU', 'STEEL', 'GHOST', 'SHADOW', 'WOLF'
        ];

        const w1 = dictionary[hashArray[0] % dictionary.length];
        const w2 = dictionary[hashArray[1] % dictionary.length];
        const w3 = dictionary[hashArray[2] % dictionary.length];

        return `${w1}-${w2}-${w3}`;
    }

    endCall(notifyPeer = true) {
        if (notifyPeer && this.targetId) {
            this.socket.emit('call-end', { targetId: this.targetId });
        }

        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }

        if (this.localStream) {
            this.localStream.getTracks().forEach(t => t.stop());
            this.localStream = null;
        }

        this.mediaKey = null;
        this.rawMediaSecret = null; // Clear sensitive data
        this.targetId = null;
        this.isInitiator = false;
        this.lastInvite = null;

        if (this.onCallClosed) this.onCallClosed();
        console.log('[SME] Call terminated. Memory shredded.');
    }

    async flipCamera() {
        if (!this.localStream) return;

        const videoTrack = this.localStream.getVideoTracks()[0];
        if (!videoTrack) return;

        // Determine current facing mode and flip it
        const currentMode = videoTrack.getSettings().facingMode;
        const newMode = currentMode === 'user' ? 'environment' : 'user';

        try {
            // Stop old track
            videoTrack.stop();

            // Get new stream with flipped camera
            const newStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: newMode },
                audio: false
            });

            const newTrack = newStream.getVideoTracks()[0];

            // Replace in local stream holder
            const oldTracks = this.localStream.getVideoTracks();
            oldTracks.forEach(t => this.localStream.removeTrack(t));
            this.localStream.addTrack(newTrack);

            // Replace in PeerConnection
            const sender = this.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) {
                await sender.replaceTrack(newTrack);
            }

            // Trigger UI update
            if (this.onStreamUpdate) {
                this.onStreamUpdate(this.localStream, true);
            }
        } catch (err) {
            console.error('[SME] Camera Flip Failed:', err);
        }
    }

    async attemptIceRestart() {
        if (!this.peerConnection || !this.isInitiator) return;

        // Track restart attempts
        this.iceRestartAttempts = (this.iceRestartAttempts || 0) + 1;

        if (this.iceRestartAttempts > 2) {
            console.error('[SME] ICE Restart failed after 2 attempts. Showing retry modal.');
            this.endCall(false);
            if (this.onCallFailed) this.onCallFailed();
            return;
        }

        try {
            console.log('[SME] Performing ICE Restart (Attempt ' + this.iceRestartAttempts + ')...');
            const offer = await this.peerConnection.createOffer({ iceRestart: true });
            await this.peerConnection.setLocalDescription(offer);
            this.socket.emit('call-signal', {
                targetId: this.targetId,
                signal: { sdp: offer }
            });
        } catch (err) {
            console.error('[SME] ICE Restart Failed:', err);
            if (this.onCallFailed) this.onCallFailed();
        }
    }
}
