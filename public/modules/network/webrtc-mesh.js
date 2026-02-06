/**
 * WebRTC Mesh Manager
 * Handles fully connected mesh network for multi-user voice
 */

export class WebRTCManager {
    constructor(socket, localStream, onRemoteStream, onPeerDisconnect) {
        this.socket = socket;
        this.localStream = localStream;
        this.onRemoteStream = onRemoteStream;
        this.onPeerDisconnect = onPeerDisconnect;
        this.peers = new Map(); // Map<userId, RTCPeerConnection>

        this.config = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        };

        this.initSocketEvents();
    }

    initSocketEvents() {
        // Someone joined voice - WE initiate call
        this.socket.on('user-joined-voice', async ({ userId }) => {
            if (userId === this.socket.id) return;
            console.log(`[WebRTC] User ${userId} joined, initiating...`);
            await this.createPeer(userId, true);
        });

        // Someone left voice - Cleanup
        this.socket.on('user-left-voice', ({ userId }) => {
            this.closePeer(userId);
        });

        // Signaling received
        this.socket.on('voice-signal', async ({ senderId, signal }) => {
            const peer = this.peers.get(senderId) || await this.createPeer(senderId, false);

            try {
                if (signal.sdp) {
                    await peer.setRemoteDescription(new RTCSessionDescription(signal.sdp));

                    if (signal.sdp.type === 'offer') {
                        const answer = await peer.createAnswer();
                        await peer.setLocalDescription(answer);
                        this.sendSignal(senderId, { sdp: peer.localDescription });
                    }
                } else if (signal.ice) {
                    await peer.addIceCandidate(new RTCIceCandidate(signal.ice));
                }
            } catch (err) {
                console.error('[WebRTC] Signal Error:', err);
            }
        });
    }

    async createPeer(targetId, initiator) {
        if (this.peers.has(targetId)) return this.peers.get(targetId);

        const peer = new RTCPeerConnection(this.config);
        this.peers.set(targetId, peer);

        // Add Local Tracks
        this.localStream.getTracks().forEach(track => {
            peer.addTrack(track, this.localStream);
        });

        // Handle ICE Candidates
        peer.onicecandidate = (event) => {
            if (event.candidate) {
                this.sendSignal(targetId, { ice: event.candidate });
            }
        };

        // Handle Incoming Stream
        peer.ontrack = (event) => {
            console.log(`[WebRTC] Received track from ${targetId}`);
            if (this.onRemoteStream) {
                this.onRemoteStream(targetId, event.streams[0]);
            }
        };

        peer.onconnectionstatechange = () => {
            console.log(`[WebRTC] Connection with ${targetId}: ${peer.connectionState}`);
            if (peer.connectionState === 'disconnected' || peer.connectionState === 'failed') {
                this.closePeer(targetId);
            }
        };

        // If initiator, create offer
        if (initiator) {
            try {
                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                this.sendSignal(targetId, { sdp: peer.localDescription });
            } catch (err) {
                console.error('[WebRTC] Offer Error:', err);
            }
        }

        return peer;
    }

    closePeer(userId) {
        const peer = this.peers.get(userId);
        if (peer) {
            peer.close();
            this.peers.delete(userId);
            if (this.onPeerDisconnect) this.onPeerDisconnect(userId);
        }
    }

    sendSignal(targetId, signal) {
        this.socket.emit('voice-signal', { targetId, signal });
    }

    cleanup() {
        this.peers.forEach(p => p.close());
        this.peers.clear();
        this.socket.off('user-joined-voice');
        this.socket.off('user-left-voice');
        this.socket.off('voice-signal');
    }
}
