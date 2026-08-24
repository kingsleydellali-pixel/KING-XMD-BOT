# 🤖 WhatsApp Multi-Device Bot

A professional WhatsApp bot built with **Baileys** featuring a **web dashboard**, **downloader tools**, **group management**, and **protection systems**. Designed for speed, efficiency, and reliability.

---

## ✨ Features

### 📥 Ultimate Downloader
| Command | Description |
|---------|-------------|
| `.yt <url>` | Download YouTube video |
| `.song <query>` | Download YouTube audio |
| `.vid <query>` | Search & download YouTube video |
| `.yts <query>` | Search YouTube |
| `.tt <url>` | TikTok no watermark |
| `.ig <url>` | Instagram reel/video |
| `.fb <url>` | Facebook video |

### 👑 Group Manager
| Command | Description |
|---------|-------------|
| `.tagall` / `.tag` | Tag all participants |
| `.kick @user` | Remove a member |
| `.add <number>` | Add a member |
| `.promote @user` | Make admin |
| `.demote @user` | Remove admin |
| `.mute` | Restrict group to admins |
| `.unmute` | Allow all members to send |
| `.gcstatus` | Group status summary |
| `.groupinfo` | Detailed group info |
| `.link` | Get invite link |
| `.revoke` | Revoke invite link |
| `.vv` | View a view-once message (reply) |

### 🛡️ Protection
- **Anti-Delete** – Detects and recovers deleted messages.
- **Anti-Link** – Removes non‑admins who share links.
- **Anti-Call** – Automatically rejects incoming calls.
- **Auto-Status** – Automatically views all status updates.
- **Auto-React** – Reacts to messages with random emojis.
- **Anti-ViewOnce** – Stores view-once content for later viewing.

### 🌐 Web Dashboard
- **Dynamic Pairing** – Enter your number to get a pairing code.
- **QR Code** – Scan the QR code directly from the dashboard.
- **Status Monitor** – Real-time connection status.

---

## 📦 Installation (Local)

1. **Clone & install**
   ```bash
   git clone https://github.com/kingsleydellali-pixel/KING-XMD-BOT.git
   cd KING-XMD-BOT
   npm install
   ```
   2. Configure environment
   ```bash
   cp env.example .env
   # Edit .env with your values
   ```
3. Run
   ```bash
   npm start
   ```
4. Open http://localhost:3000 in your browser to link the bot.

---

🚀 Deployment on Render

1. Fork / upload this repository to GitHub.
2. Go to Render.com → New + → Blueprint.
3. Select your repository and confirm the render.yaml blueprint.
4. Fill in required environment variables:
   · OWNER_NUMBER – your WhatsApp number with country code (no +).
   · BOT_IMAGE_URL – (optional) URL of bot image.
5. Important: Attach a Persistent Disk to the service (already in render.yaml). This stores your WhatsApp session, so you don’t need to re-scan the QR code every time.
6. Click Apply and wait for the build to finish.
7. Once deployed, open the provided onrender.com URL to access the dashboard and link your WhatsApp.

Note: The free Render plan may spin down after inactivity. The bot will restart automatically when a new request comes in, but messages sent while offline may be missed.

---
