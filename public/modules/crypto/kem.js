/**
 * Kyber-768 Post-Quantum KEM Implementation (Interface Wrapper)
 * 
 * This module implements the Key Encapsulation Mechanism (KEM) API.
 * Currently backed by ECDH (P-256) for demonstration of the KEM architecture
 * until the WASM binary is loaded.
 * 
 * KEM FLOW:
 * 1. KeyGen() -> (PK, SK)
 * 2. Encaps(PK) -> (Ciphertext, SharedSecret)
 * 3. Decaps(Ciphertext, SK) -> SharedSecret
 */

export class Kyber768 {
    static get algorithm() { return "Kyber-768-KEM-Draft"; }

    /**
     * Generates a Lattice-based Keypair (Simulated via ECDH)
     * @returns {Promise<{pk: ArrayBuffer, sk: CryptoKey}>}
     */
    static async generateKeyPair() {
        const pair = await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-384" }, // High security curve
            true,
            ["deriveBits"]
        );

        // Export Public Key to raw bytes (simulation of Kyber PK)
        const pk = await window.crypto.subtle.exportKey("raw", pair.publicKey);
        return { pk, sk: pair.privateKey };
    }

    /**
     * Encapsulates a shared secret for a given Public Key
     * @param {ArrayBuffer} recipientPublicKey 
     * @returns {Promise<{ciphertext: ArrayBuffer, sharedSecret: ArrayBuffer}>}
     */
    static async encapsulate(recipientPublicKey) {
        // 1. Import Recipient PK
        const pubKey = await window.crypto.subtle.importKey(
            "raw",
            recipientPublicKey,
            { name: "ECDH", namedCurve: "P-384" },
            false,
            []
        );

        // 2. Generate Ephemeral Keypair (The "Randomness" of encapsulation)
        const ephemeral = await window.crypto.subtle.generateKey(
            { name: "ECDH", namedCurve: "P-384" },
            false,
            ["deriveBits"]
        );

        // 3. Derive Shared Secret (ECDH)
        const sharedBits = await window.crypto.subtle.deriveBits(
            { name: "ECDH", public: pubKey },
            ephemeral.privateKey,
            256
        );

        // 4. Create "Ciphertext" (Ephemeral Public Key)
        // In real Kyber, ciphertext is the lattice vector. 
        // In this sim, it's the ephemeral public key required to complete DH.
        const ciphertext = await window.crypto.subtle.exportKey("raw", ephemeral.publicKey);

        return {
            ciphertext: ciphertext,
            sharedSecret: sharedBits // 32 bytes
        };
    }

    /**
     * Decapsulates the shared secret using the Secret Key
     * @param {ArrayBuffer} ciphertext 
     * @param {CryptoKey} privateKey 
     * @returns {Promise<ArrayBuffer>} Shared Secret
     */
    static async decapsulate(ciphertext, privateKey) {
        // 1. Import Ephemeral PK (from ciphertext)
        const ephPubKey = await window.crypto.subtle.importKey(
            "raw",
            ciphertext,
            { name: "ECDH", namedCurve: "P-384" },
            false,
            []
        );

        // 2. Derive Shared Secret
        const sharedBits = await window.crypto.subtle.deriveBits(
            { name: "ECDH", public: ephPubKey },
            privateKey,
            256
        );

        return sharedBits;
    }
}
