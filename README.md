# AES Chat
### High-Fidelity End-to-End Encrypted Real-Time Communication Platform

![Build Status](https://img.shields.io/badge/build-passing-brightgreen) ![Security](https://img.shields.io/badge/security-AES--256--GCM-blue) ![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## 1. Abstract

AES Chat is a secure, ephemeral-by-default, real-time messaging application engineered to prioritize user privacy and data sovereignty. Leveraging the **Web Crypto API**, the platform implements **AES-256-GCM** (Galois/Counter Mode) for authenticated encryption, ensuring that message payloads are opaque to the relay server. The architecture is designed to be zero-knowledge; the server acts solely as a message broker and persistence layer for encrypted blobs, possessing no capability to decrypt user communications.

The system features a hybrid persistence layer, utilizing **Google Firestore** for cloud deployment (Render) and local filesystem storage for development, ensuring robustness and data continuity across sessions.

---

## 2. System Architecture

The application follows a client-server topology where the server facilitates WebSocket connections (via Socket.io) but does not participate in the cryptographic handshake. Keys are derived deterministically client-side based on Room Entropy.

```mermaid
graph TD
    UserA[User A] <-->|WebSocket (Secure)| Server[Relay Server]
    UserB[User B] <-->|WebSocket (Secure)| Server
    
    subgraph "Server Plane (Untrusted)"
        Server -->|Read/Write Encrypted Blobs| Database[(Persistence Layer)]
        Database -.->|Cloud| Firestore[Google Firestore]
        Database -.->|Local| FS[Local JSON Storage]
    end

    subgraph "Client Plane (Trusted)"
        direction TB
        Input[Plaintext Input] --> CryptoEngine[Web Crypto API]
        CryptoEngine -->|AES-256-GCM| Encrypted[Ciphertext + IV]
        Encrypted --> Network[Network Layer]
    end
```

### 2.1 Technology Stack
*   **Runtime Environment**: Node.js (v18+)
*   **Transport Protocol**: WebSocket (Socket.io) with TCP reliability.
*   **Cryptography**: Native Browser Web Crypto API (SubtleCrypto).
*   **Persistence**: Google Firestore (Production) / JSON (Development).
*   **Frontend**: Vanilla JavaScript (ES6+), CSS3 Variables.

---

## 3. Cryptographic Implementation

The security model assumes the server is honest-but-curious. All confidentiality and integrity guarantees are enforced by the client.

### 3.1 Algorithm Specifications
*   **Primitive**: Advanced Encryption Standard (AES)
*   **Mode**: Galois/Counter Mode (GCM)
*   **Key Size**: 256-bit
*   **Initialization Vector (IV)**: 12-byte (96-bit) random nonce generated per message.

### 3.2 Key Derivation Function (KDF)
Room keys are derived using a deterministic hash of the Room ID.
*   **Input**: `RoomID + "-aes-chat-secure-key"`
*   **Algorithm**: SHA-256
*   **Output**: 256-bit raw key material imported as `AES-GCM` key.

### 3.3 Message Packet Structure
Each transmitted packet contains:
1.  **Ciphertext**: The encrypted message body.
2.  **IV**: The 12-byte nonce required for decryption (sent in plaintext, as it is public).
3.  **Metadata**: Sender ID, timestamp, and boolean flags (e.g., `isSystemMessage`).

---

## 4. Computational Security Analysis

The security of AES-256 relies on the computational infeasibility of exhaustive key search (brute-force attack).

### 4.1 Key Space
An AES-256 key has a length of 256 bits, resulting in a key space of:
$$2^{256} \approx 1.1579 \times 10^{77}$$

### 4.2 Brute Force Feasibility
To contextualize the magnitude of this number, consider a theoretical attack using the combined processing power of every supercomputer on Earth.

*   **Current Global Computing Power**: Approximately $10^{20}$ FLOPS (Floating Point Operations Per Second) (Optimistic estimation of all Top500 supercomputers combined).
*   **Operations per Key Check**: conservatively assume 1 FLOP per check (Theoretical lower bound; reality is much higher).

**Time to Exhaust Key Space ($T$):**
$$T = \frac{1.1579 \times 10^{77} \text{ keys}}{10^{20} \text{ keys/second}} = 1.1579 \times 10^{57} \text{ seconds}$$

Converting to years:
$$T_{years} = \frac{1.1579 \times 10^{57}}{3.1536 \times 10^7} \approx 3.67 \times 10^{49} \text{ years}$$

**Comparison**:
The age of the observable universe is estimated at $1.38 \times 10^{10}$ years.
Thus, breaking AES-256 would take approximately **$2.6 \times 10^{39}$ times the age of the universe**, assuming no thermodynamic constraints (Landauer's limit) which would make such computation physically impossible regardless of time.

> **Conclusion**: AES-256 is theoretically unbreakable against brute-force attacks using known physics.

---

## 5. Deployment

### 5.1 Local Development
1.  **Clone Repository**:
    ```bash
    git clone https://github.com/triunex/aes-chat.git
    cd aes-chat
    ```
2.  **Install Dependencies**:
    ```bash
    npm install
    ```
3.  **Start Server**:
    ```bash
    npm start
    ```
    *   The server will default to local JSON persistence in `data/rooms.json`.
    *   Access via `http://localhost:3000`.

### 5.2 Cloud Deployment (Render.com)
The application is optimized for Render.com's infrastructure.

1.  **Create Web Service**: Connect your GitHub repository.
2.  **Build Command**: `npm install`
3.  **Start Command**: `node server.js`
4.  **Environment Variables**:
    *   `FIREBASE_SERVICE_ACCOUNT`: (Optional) Paste the full JSON content of your Firebase Service Account to enable cloud persistence.
    *   `PORT`: (Optional) Defaults to 10000 on Render.

---

## 6. Features & Capabilities

*   **Zero-Knowledge Architecture**: Server cannot read messages.
*   **Volatile & Persistent Modes**: Hybrid storage handles both ephemeral sessions and long-term history.
*   **Admin Controls**: Room creators have sovereign capability to remove (kick) participants.
*   **Rich Media**: Support for encrypted file sharing, voice memos, and image transfer.
*   **Robust Networking**: Auto-reconnection logic with visual overlays and "Keep-Alive" heartbeat for free-tier hosting stability.

---

## 7. License
This project is licensed under the **MIT License**.

© 2026 AES Chat Project. Developed for secure communication research.
