# AES Chat
### Quantum-Resistant, High-Fidelity Communication Platform

![Build Status](https://img.shields.io/badge/build-passing-brightgreen) ![Security](https://img.shields.io/badge/encryption-Kyber--768%20%2B%20AES--256-blueviolet) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

**AES Chat** is not just a messaging app; it is a **sovereign digital territory**. It combines military-grade encryption with next-generation spatial computing interfaces to create the most secure and immersive collaboration environment available on the web.

---

## 1. Abstract

In the era of surveillance capitalism and the looming threat of **Quantum Computing**, standard encryption is no longer insufficient. AES Chat implements **Crystals-Kyber-768**, the NIST-standard Post-Quantum Cryptographic (PQC) algorithm, to secure keys against future quantum attacks ("Harvest Now, Decrypt Later"). This is paired with a **Holo-Spatial Audio Engine** and an **Infinite Encrypted Canvas**, redefining what a "chat app" can do.

---

## 2. Revolutionary Features

### 🛡️ Post-Quantum Security (PQC)
Unlike Signal or WhatsApp which rely on classical Elliptic Curve Diffie-Hellman (ECDH), AES Chat uses a **Key Encapsulation Mechanism (KEM)** based on Module Lattices (Kyber).
*   **Quantum-Proof**: Mathematically resistant to Shor's Algorithm running on future quantum supercomputers.
*   **Ephemeral Keys**: Every session generates a new random 256-bit AES key, exchanged via Kyber. If a key is compromised later, past conversations remain secure (Perfect Forward Secrecy).
*   **Zero-Trust Server**: The relay server never sees the keys, messages, canvas strokes, or audio streams.

### 🎧 Holo-Spatial Voice
Experience the **"Cocktail Party Effect"** digitally.
*   **3D Radar UI**: Visualize participants as nodes in a 360° radar.
*   **Drag-to-Pan**: Physically drag user avatars to position their voice in your stereo field (Left, Right, Center, Far).
*   **Cognitive Clarity**: Distinguish multiple simultaneous speakers easily, reducing meeting fatigue.
*   **P2P Mesh**: Audio flows directly between users via WebRTC, bypassing the server entirely for maximum privacy/logic.

### ♾️ Infinite Encrypted Whiteboard
A shared "Mind Palace" for your most sensitive ideas.
*   **Infinite Canvas**: Pan and Zoom forever. No edges.
*   **E2EE Strokes**: Every line you draw is encrypted before it leaves your device. The server only relays encrypted binary blobs.
*   **Collaborative**: Real-time multi-user drawing with low latency.

---

## 3. Interface Design

![Secure Terminal Interface](screenshots/demo.png)
*Figure 1: The Command Center. A dark-mode, glassmorphism interface designed for focus. Features the Holo-Radar (top right) and encrypted message stream.*

### Key Controls
*   **Holo-Mode**: Click the `Activity/Pulse` icon in the header to open the Spatial Radar.
*   **Whiteboard**: Click the `Pen` icon to overlay the Infinite Canvas.
*   **New Session**: Click `New Secure Room` to generate a fresh cryptographic identity and room ID.

---

## 4. Technical Architecture

```mermaid
graph TD
    UserA[User A (Alice)]
    UserB[User B (Bob)]
    Server[Signaling Server]
    
    subgraph "Post-Quantum Handshake"
    UserA -- "1. Kyber-768 Public Key" --> Server
    Server -- "Relay PK" --> UserB
    UserB -- "2. Encapsulate(PK) -> Ciphertext" --> UserB
    UserB -- "3. Send Ciphertext" --> Server
    Server -- "Relay Ciphertext" --> UserA
    UserA -- "4. Decapsulate(Ciphertext) -> Shared Secret" --> UserA
    end
    
    subgraph "Encrypted Session"
    UserA <== "AES-256-GCM (WebRTC Audio)" ==> UserB
    UserA <== "AES-256-GCM (WebSocket Msg)" ==> UserB
    end
```

### Stack
*   **Core**: Vanilla JS (ES6 Modules) - Performance focused.
*   **Crypto**: `crystals-kyber` (WASM/JS) + WebCrypto API (AES-GCM-256).
*   **Network**: Socket.io (Signaling) + WebRTC (Mesh P2P).
*   **Audio**: Web Audio API (Spatial Panner Nodes).

---

## 5. Security Analysis

**Brute Force Resistance**:
$2^{256}$ combinations. Attempting to crack one key with the world's most powerful supercomputer (Frontier, ~1.1 ExaFLOPS) would take approximately **$3.67 \times 10^{49}$ years**.
*   *Universe Age*: ~$1.38 \times 10^{10}$ years.
*   **Conclusion**: Physically impossible to crack via brute force.

**Quantum Resistance**:
While a Quantum Computer (using Grover's Algo) essentially halves the bit-strength (256 -> 128 bits), AES-256 remains secure. The risk is the **Key Exchange**. By using **Kyber-768**, we secure the handshake itself against Quantum attacks, closing the loop.

---

## 6. Installation & Deployment

### Local Development
```bash
git clone https://github.com/triunex/aes-chat.git
cd aes-chat
npm install
npm run dev
```

### One-Click Deploy
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy)

---

## 7. License
MIT License. Free forever.
