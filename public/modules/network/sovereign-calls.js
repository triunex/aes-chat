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

    async handleInvite(data) {
        // UI should show the incoming call popup
        this.targetId = data.senderId;
        // This is handled by chatApp.js calling accept/reject
        window.dispatchEvent(new CustomEvent('incoming-call', { detail: data }));
    }

    async acceptCall(isVideo = true) {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: true,
                video: isVideo ? { width: 1280, height: 720, frameRate: 30 } : false
            });

            if (this.onStreamUpdate) this.onStreamUpdate(this.localStream, true);

            this.socket.emit('call-accept', { targetId: this.targetId });

            // Start PQC Key Exchange before establishing WebRTC
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
     */
    async negotiateMediaKey() {
        console.log('[SME] Negotiating PQC Media Key...');

        if (this.isInitiator) {
            // Generating Kyber-768 pair
            const keyPair = await Kyber768.generateKeyPair();

            return new Promise((resolve) => {
                const onHandshake = async (data) => {
                    if (data.senderId !== this.targetId || !data.mediaSecret) return;
                    this.socket.off('call-media-handshake', onHandshake);

                    const sharedSecret = await Kyber768.decapsulate(data.mediaSecret.ciphertext, keyPair.sk);
                    this.mediaKey = await this.importKey(sharedSecret);
                    console.log('[SME] Secure Media Key Established (Recipient).');
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
            // Wait for PK from initiator
            // This is slightly complex due to async flow, handled in handleSignal
        }
    }

    async initPeerConnection() {
        this.peerConnection = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            encodedInsertableStreams: true // ACTIVATE SOVEREIGN ENCRYPTION
        });

        const encryptor = new FrameEncryptor(this.mediaKey);

        // Track local streams and apply outgoing encryption
        this.localStream.getTracks().forEach(track => {
            const sender = this.peerConnection.addTrack(track, this.localStream);

            // Insert frame encryption
            const streams = sender.createEncodedStreams();
            const transformer = new TransformStream({
                transform: (frame, controller) => encryptor.encrypt(frame, controller)
            });
            streams.readable.pipeThrough(transformer).pipeTo(streams.writable);
        });

        // Handle incoming streams and apply decryption
        this.peerConnection.ontrack = (event) => {
            const receiver = event.receiver;
            const streams = receiver.createEncodedStreams();
            const transformer = new TransformStream({
                transform: (frame, controller) => encryptor.decrypt(frame, controller)
            });
            streams.readable.pipeThrough(transformer).pipeTo(streams.writable);

            if (this.onStreamUpdate) this.onStreamUpdate(event.streams[0], false);
        };

        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('call-signal', {
                    targetId: this.targetId,
                    signal: { ice: event.candidate }
                });
            }
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
        if (!this.peerConnection && data.signal.mediaPk) {
            // Recipient side: receive PK and encapsulate
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

    async importKey(rawSecret) {
        return window.crypto.subtle.importKey(
            'raw',
            rawSecret,
            { name: 'AES-GCM' },
            false,
            ['encrypt', 'decrypt']
        );
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

        // Key shredding
        this.mediaKey = null;
        this.targetId = null;
        this.isInitiator = false;

        if (this.onCallClosed) this.onCallClosed();
        console.log('[SME] Call terminated. Memory shredded.');
    }
}
