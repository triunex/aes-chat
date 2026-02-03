# AES Chat - Encrypted Chat Rooms

A premium, real-time encrypted chat application with end-to-end encryption, voice messages, file sharing, and more.

## Features

- **AES-256 Encryption** - Military-grade security
- **Shareable Room Links** - Invite anyone instantly
- **Voice Messages** - With waveform visualization
- **File & Image Sharing** - Up to 50MB
- **Disappearing Messages** - Auto-delete option
- **Message Reactions** - Express with emojis
- **Reply Threading** - Context-aware conversations
- **Dark/Light Mode** - Beautiful UI
- **Fully Responsive** - Works on all devices

## Quick Start (Local)

```bash
# Install dependencies
npm install

# Start server
npm start

# Open http://localhost:3000
```

## Deploy to Render.com (Free & Permanent)

### Step 1: Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/aes-chat.git
git push -u origin main
```

### Step 2: Deploy on Render

1. Go to [render.com](https://render.com) and sign up (free)
2. Click **"New +"** → **"Web Service"**
3. Connect your GitHub repository
4. Configure:
   - **Name**: `aes-chat` (or your preferred name)
   - **Region**: Choose nearest
   - **Branch**: `main`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
5. Click **"Create Web Service"**

Your app will be live at: `https://aes-chat.onrender.com`

### Step 3: Share with Friends

Copy any room link like:
```
https://aes-chat.onrender.com/room/abc123
```

Friends can join directly - no password needed!

## Alternative Deployment Options

### Railway.app
```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

### Fly.io
```bash
flyctl launch
flyctl deploy
```

## Environment Variables (Optional)

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |

## Tech Stack

- **Backend**: Node.js, Express, Socket.io
- **Frontend**: Vanilla JS, CSS3
- **Encryption**: Web Crypto API (AES-256-GCM)

## License

MIT
