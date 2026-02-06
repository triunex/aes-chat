import { Kyber768 } from './kem.js';

/**
 * PQC Handshake Manager
 * Manages the transition from ECDH/PSK to Quantum-Resistant Key Exchange
 */
export class HandshakeManager {
    constructor(socket, app) {
        this.socket = socket;
        this.app = app;
        this.myKeyPair = null;
    }

    /**
     * Start the PQC Handshake flow
     * @returns {Promise<CryptoKey>} The shared AES-GCM Room Key
     */
    async initiateHandshake() {
        console.log('[PQC] Generating Kyber-768 Keypair...');
        this.myKeyPair = await Kyber768.generateKeyPair();

        return new Promise((resolve, reject) => {
            let completed = false;

            // 1. Listen for Handshake Response (someone giving us the key)
            const onComplete = async (data) => {
                if (completed) return;
                completed = true;

                console.log('[PQC] Received Encapsulated Key.');
                try {
                    // Decapsulate to get Shared Secret
                    const sharedSecret = await Kyber768.decapsulate(data.ciphertext, this.myKeyPair.sk);

                    // Use Shared Secret to Decrypt the actual Room Key
                    const roomKey = await this.decryptRoomKey(data.encryptedKey, sharedSecret);

                    this.cleanup();
                    resolve({ key: roomKey, isCreator: false });
                } catch (err) {
                    console.error('[PQC] Decapsulation Failed:', err);
                    reject(err);
                }
            };

            this.socket.on('handshake-complete', onComplete);

            // 2. Broadcast PK
            console.log('[PQC] Broadcasting Public Key...');
            this.socket.emit('handshake-init', { pk: this.myKeyPair.pk });

            // 3. Timeout - If no one answers, we are the Creator
            setTimeout(async () => {
                if (!completed) {
                    completed = true;
                    console.log('[PQC] No peers found. Becoming Room Creator.');
                    this.cleanup();

                    // Generate New Random Room Key
                    const roomKey = await window.crypto.subtle.generateKey(
                        { name: "AES-GCM", length: 256 },
                        true,
                        ["encrypt", "decrypt"]
                    );
                    resolve({ key: roomKey, isCreator: true });
                }
            }, 2000); // 2 seconds wait time
        });
    }

    /**
     * Responds to a new user asking for the key
     */
    async handleHandshakeRequest(data) {
        // Only respond if we have a key!
        if (!this.app.encryptionKey) return;

        console.log('[PQC] Serving Key to new peer:', data.senderId);

        try {
            // 1. Encapsulate (Generate Secret for this specific peer)
            const result = await Kyber768.encapsulate(data.pk);

            // 2. Encrypt our AES Room Key with this Secret
            const encryptedKey = await this.encryptRoomKey(this.app.encryptionKey, result.sharedSecret);

            // 3. Send back
            this.socket.emit('handshake-response', {
                targetId: data.senderId,
                ciphertext: result.ciphertext,
                encryptedKey: encryptedKey
            });
        } catch (err) {
            console.error('[PQC] Failed to serve key:', err);
        }
    }

    // Helper: Wrap AES Key with KEM Secret
    async encryptRoomKey(roomKey, sharedSecret) {
        // Import sharedSecret as AES-KW or AES-GCM key
        // KEM Secret is 32 bytes (256 bits)
        const kek = await window.crypto.subtle.importKey(
            "raw",
            sharedSecret,
            { name: "AES-GCM" },
            false,
            ["encrypt"]
        );

        // Export Room Key to raw bytes
        const roomKeyBytes = await window.crypto.subtle.exportKey("raw", roomKey);

        // Encrypt
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await window.crypto.subtle.encrypt(
            { name: "AES-GCM", iv: iv },
            kek,
            roomKeyBytes
        );

        return {
            iv: Array.from(iv),
            data: Array.from(new Uint8Array(encrypted))
        };
    }

    // Helper: Unwrap AES Key with KEM Secret
    async decryptRoomKey(encryptedData, sharedSecret) {
        const kek = await window.crypto.subtle.importKey(
            "raw",
            sharedSecret,
            { name: "AES-GCM" },
            false,
            ["decrypt"]
        );

        const decryptedBytes = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: new Uint8Array(encryptedData.iv) },
            kek,
            new Uint8Array(encryptedData.data)
        );

        // Import as AES Key
        return await window.crypto.subtle.importKey(
            "raw",
            decryptedBytes,
            { name: "AES-GCM" },
            true,
            ["encrypt", "decrypt"]
        );
    }

    cleanup() {
        this.socket.off('handshake-complete');
    }
}
