/**
 * AES Chat - Encryption Module
 * Client-side AES-256 encryption for end-to-end secure messaging
 */

class AESEncryption {
    constructor() {
        this.algorithm = 'AES-GCM';
        this.keyLength = 256;
    }

    // Generate a random encryption key
    async generateKey() {
        const key = await crypto.subtle.generateKey(
            { name: this.algorithm, length: this.keyLength },
            true,
            ['encrypt', 'decrypt']
        );
        return key;
    }

    // Export key to base64 string for sharing
    async exportKey(key) {
        const exported = await crypto.subtle.exportKey('raw', key);
        return this.arrayBufferToBase64(exported);
    }

    // Import key from base64 string
    async importKey(keyString) {
        const keyBuffer = this.base64ToArrayBuffer(keyString);
        return await crypto.subtle.importKey(
            'raw',
            keyBuffer,
            { name: this.algorithm, length: this.keyLength },
            true,
            ['encrypt', 'decrypt']
        );
    }

    // Encrypt a message
    async encrypt(message, key) {
        const encoder = new TextEncoder();
        const data = encoder.encode(message);
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const encrypted = await crypto.subtle.encrypt(
            { name: this.algorithm, iv },
            key,
            data
        );

        // Combine IV and encrypted data
        const combined = new Uint8Array(iv.length + encrypted.byteLength);
        combined.set(iv);
        combined.set(new Uint8Array(encrypted), iv.length);

        return this.arrayBufferToBase64(combined);
    }

    // Decrypt a message
    async decrypt(encryptedData, key) {
        try {
            const combined = this.base64ToArrayBuffer(encryptedData);
            const iv = combined.slice(0, 12);
            const data = combined.slice(12);

            const decrypted = await crypto.subtle.decrypt(
                { name: this.algorithm, iv: new Uint8Array(iv) },
                key,
                data
            );

            const decoder = new TextDecoder();
            return decoder.decode(decrypted);
        } catch (error) {
            console.error('Decryption failed:', error);
            return '[Encrypted message - unable to decrypt]';
        }
    }

    // Generate room key from room ID (simplified for demo)
    async deriveRoomKey(roomId) {
        const encoder = new TextEncoder();
        const data = encoder.encode(roomId + '-aes-chat-secure-key');

        const hashBuffer = await crypto.subtle.digest('SHA-256', data);

        return await crypto.subtle.importKey(
            'raw',
            hashBuffer,
            { name: this.algorithm, length: this.keyLength },
            true,
            ['encrypt', 'decrypt']
        );
    }

    // Utility functions
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }

    // Hash a password/key for verification
    async hash(text) {
        const encoder = new TextEncoder();
        const data = encoder.encode(text);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return this.arrayBufferToBase64(hashBuffer);
    }
}

// Export singleton instance
window.AESEncryption = new AESEncryption();
