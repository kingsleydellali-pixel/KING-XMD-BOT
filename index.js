const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ytdl = require('ytdl-core');
const yts = require('yt-search');
const qrcode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser
} = require('@whiskeysockets/baileys');
const { tiktokdl, instagramdl, facebookdl } = require('@bochilteam/scraper');
const settings = require('./settings');

const app = express();
const server = http.createServer(app);
const PORT = settings.PORT || 3000;

app.use(express.json());

// ================== GLOBAL STATE ==================
let sock = null;
let qrCode = '';
let pairingCode = '';
let isConnected = false;
let connectionStatus = 'disconnected';

// Session directory
const sessionDir = settings.SESSION_DIR || './session';
if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

// Stores for anti-delete & view-once
const messageStore = new Map();
const viewOnceStore = new Map();

// ================== HELPERS ==================
async function sendText(jid, text, quoted) {
  return await sock.sendMessage(jid, { text }, { quoted });
}

async function reactToMessage(jid, key, emoji) {
  await sock.sendMessage(jid, { react: { text: emoji, key } });
}

async function getGroupMetadata(jid) {
  return await sock.groupMetadata(jid);
}

async function isAdmin(jid, participant) {
  const metadata = await getGroupMetadata(jid);
  const admins = metadata.participants.filter(p => p.admin).map(p => p.id);
  return admins.includes(participant);
}

async function isBotAdmin(jid) {
  const metadata = await getGroupMetadata(jid);
  const botId = (sock.user.id.split(':')[0] || sock.user.id) + '@s.whatsapp.net';
  const botParticipant = metadata.participants.find(p => p.id === botId);
  return botParticipant && botParticipant.admin;
}

async function getParticipants(jid) {
  const metadata = await getGroupMetadata(jid);
  return metadata.participants;
}

// ================== EXPRESS DASHBOARD ==================
app.get('/', (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <title>WhatsApp Bot Dashboard</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      body { font-family: 'Segoe UI', sans-serif; background: #f0f2f5; margin: 0; padding: 20px; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
      .card { background: white; border-radius: 16px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); padding: 30px; max-width: 500px; width: 100%; text-align: center; }
      h1 { color: #075E54; margin-bottom: 10px; }
      .status { margin: 15px 0; padding: 10px; border-radius: 8px; font-weight: bold; }
      .connected { background: #d4edda; color: #155724; }
      .disconnected { background: #f8d7da; color: #721c24; }
      .connecting { background: #fff3cd; color: #856404; }
      .qr-section, .pair-section { margin-top: 20px; }
      input { width: 100%; padding: 10px; margin: 5px 0; border: 1px solid #ccc; border-radius: 6px; }
      button { background: #25D366; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 16px; }
      button:hover { background: #128C7E; }
      img { max-width: 250px; margin: 10px auto; display: block; }
      .hidden { display: none; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>🤖 WhatsApp Bot</h1>
      <div id="status" class="status disconnected">Disconnected</div>
      <div class="qr-section">
        <h3>Scan QR Code</h3>
        <div id="qr-container">
          <p>Waiting for QR code...</p>
        </div>
      </div>
      <div class="pair-section">
        <h3>Or Use Pairing Code</h3>
        <input type="text" id="phone" placeholder="Enter phone number with country code" />
        <button onclick="getPairingCode()">Get Pairing Code</button>
        <div id="pairing-result" class="hidden">
          <p>Pairing Code: <strong id="pairing-code"></strong></p>
        </div>
      </div>
    </div>
    <script>
      async function updateStatus() {
        const res = await fetch('/status');
        const data = await res.json();
        const statusEl = document.getElementById('status');
        statusEl.textContent = data.status;
        statusEl.className = 'status ' + (data.connected ? 'connected' : data.status === 'connecting' ? 'connecting' : 'disconnected');
        if (data.qr) {
          const qrRes = await fetch('/qr');
          const qrData = await qrRes.json();
          if (qrData.dataUrl) {
            document.getElementById('qr-container').innerHTML = '<img src="' + qrData.dataUrl + '" alt="QR Code">';
          }
        }
      }
      async function getPairingCode() {
        const phone = document.getElementById('phone').value.trim();
        if (!phone) return alert('Enter phone number');
        const res = await fetch('/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ number: phone })
        });
        const data = await res.json();
        if (data.code) {
          document.getElementById('pairing-result').classList.remove('hidden');
          document.getElementById('pairing-code').textContent = data.code;
        } else {
          alert('Error: ' + (data.error || 'Failed'));
        }
      }
      setInterval(updateStatus, 3000);
      updateStatus();
    </script>
  </body>
  </html>
  `);
});

app.get('/status', (req, res) => {
  res.json({
    connected: isConnected,
    status: connectionStatus,
    qr: qrCode ? true : false,
    pairingCode: pairingCode ? true : false
  });
});

app.get('/qr', async (req, res) => {
  if (!qrCode) return res.status(404).json({ error: 'QR code not available' });
  try {
    const dataUrl = await qrcode.toDataURL(qrCode);
    res.json({ dataUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/pair', async (req, res) => {
  const { number } = req.body;
  if (!number) return res.status(400).json({ error: 'Phone number required' });
  if (!sock) return res.status(500).json({ error: 'Bot not initialized' });
  try {
    const code = await sock.requestPairingCode(number.replace(/[^0-9]/g, ''));
    pairingCode = code;
    res.json({ code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ================== BOT INITIALIZATION ==================
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    printQRInTerminal: false, // handled by dashboard
    browser: Browsers.ubuntu('Chrome'),
    logger: pino({ level: 'silent' }),
    markOnlineOnConnect: true,
    syncFullHistory: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      qrCode = qr;
      console.log('QR Code received – scan or use pairing code');
    }
    if (connection === 'open') {
      isConnected = true;
      connectionStatus = 'connected';
      qrCode = '';
      pairingCode = '';
      console.log('✅ Bot connected!');
    } else if (connection === 'close') {
      isConnected = false;
      connectionStatus = 'disconnected';
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('Connection closed, restarting...');
        startBot();
      } else {
        console.log('Logged out – delete session folder and restart.');
      }
    } else if (connection === 'connecting') {
      connectionStatus = 'connecting';
    }
  });

  // ================== MESSAGE HANDLER ==================
  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      if (!msg.message) continue;

      // Store for anti-delete
      messageStore.set(msg.key.id, msg);

      // Auto view status updates
      if (settings.AUTO_STATUS && msg.key.remoteJid === 'status@broadcast') {
        await sock.readMessages([msg.key]);
      }

      // Auto react
      if (settings.AUTO_REACT && !msg.key.fromMe && msg.key.remoteJid !== 'status@broadcast') {
        const emojis = settings.AUTO_REACT_EMOJIS;
        const emoji = emojis[Math.floor(Math.random() * emojis.length)];
        await reactToMessage(msg.key.remoteJid, msg.key, emoji);
      }

      // Anti-link in groups
      if (settings.ANTI_LINK && msg.key.remoteJid.endsWith('@g.us') && !msg.key.fromMe) {
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        if (urlRegex.test(text)) {
          const sender = msg.key.participant || msg.key.remoteJid;
          if (!(await isAdmin(msg.key.remoteJid, sender)) && await isBotAdmin(msg.key.remoteJid)) {
            await sock.groupParticipantsUpdate(msg.key.remoteJid, [sender], 'remove');
            await sendText(msg.key.remoteJid, `🚫 Anti-Link: @${sender.split('@')[0]} removed for sharing a link.`, msg);
          }
        }
      }

      // Store view-once content
      if (msg.message.viewOnceMessage || msg.message.viewOnceMessageV2) {
        const inner = msg.message.viewOnceMessage?.message || msg.message.viewOnceMessageV2?.message;
        if (inner) {
          viewOnceStore.set(msg.key.id, inner);
        }
      }

      // Command handler
      const text = msg.message.conversation ||
                   msg.message.extendedTextMessage?.text ||
                   msg.message.imageMessage?.caption ||
                   msg.message.videoMessage?.caption || '';
      if (text.startsWith(settings.PREFIX)) {
        await handleCommand(msg, text);
      }
    }
  });

  // ================== ANTI-DELETE ==================
  sock.ev.on('messages.update', async (updates) => {
    for (const update of updates) {
      if (update.update?.message?.protocolMessage?.type === 'REVOKE') {
        const key = update.key;
        const stored = messageStore.get(key.id);
        if (stored && stored.message) {
          let contentText = 'Message content unavailable';
          if (stored.message.conversation) contentText = stored.message.conversation;
          else if (stored.message.extendedTextMessage) contentText = stored.message.extendedTextMessage.text;
          else if (stored.message.imageMessage) contentText = '📷 Image';
          else if (stored.message.videoMessage) contentText = '🎥 Video';
          else if (stored.message.audioMessage) contentText = '🎵 Audio';

          const jid = key.remoteJid;
          const mention = key.participant || key.remoteJid;
          await sock.sendMessage(jid, {
            text: `🚫 *Anti-Delete Detected*\n\nDeleted message from @${mention.split('@')[0]}:\n${contentText}`
          }, { mentions: [mention] });
        }
      }
    }
  });

  // ================== ANTI-CALL ==================
  sock.ev.on('call', async (call) => {
    if (settings.ANTI_CALL) {
      await sock.rejectCall(call.id, call.from);
      await sock.sendMessage(call.from, { text: '🚫 Calls are not allowed. Message me instead.' });
    }
  });

  server.listen(PORT, () => {
    console.log(`🌐 Dashboard running on http://localhost:${PORT}`);
  });
}

// ================== COMMAND HANDLER ==================
async function handleCommand(msg, text) {
  const jid = msg.key.remoteJid;
  const sender = msg.key.participant || msg.key.remoteJid;
  const isGroup = jid.endsWith('@g.us');
  const args = text.slice(settings.PREFIX.length).trim().split(/ +/);
  const cmd = args.shift().toLowerCase();
  const quoted = msg;
  const reply = (txt) => sendText(jid, txt, quoted);

  try {
    switch (cmd) {
      case 'ping':
        await reply('🏓 Pong! Bot is alive.');
        break;

      case 'help':
      case 'menu':
        await sendHelp(jid);
        break;

      // Downloader
      case 'yt':
        if (!args[0]) return reply('❌ Provide YouTube URL.');
        await downloadYouTube(msg, args[0], 'video');
        break;

      case 'song':
        if (!args[0]) return reply('❌ Provide YouTube URL or search query.');
        await downloadYouTube(msg, args[0], 'audio');
        break;

      case 'vid':
        if (!args.length) return reply('❌ Provide search query.');
        await searchAndDownloadYouTube(msg, args.join(' '), 'video');
        break;

      case 'yts':
        if (!args.length) return reply('❌ Provide search query.');
        await searchYouTube(msg, args.join(' '));
        break;

      case 'tt':
        if (!args[0]) return reply('❌ Provide TikTok URL.');
        await downloadTikTok(msg, args[0]);
        break;

      case 'ig':
        if (!args[0]) return reply('❌ Provide Instagram URL.');
        await downloadInstagram(msg, args[0]);
        break;

      case 'fb':
        if (!args[0]) return reply('❌ Provide Facebook URL.');
        await downloadFacebook(msg, args[0]);
        break;

      // Group Manager
      case 'tagall':
      case 'tag':
        await tagAll(msg);
        break;

      case 'kick':
      case 'remove':
        await groupAction(msg, args, 'remove');
        break;

      case 'add':
        await groupAction(msg, args, 'add');
        break;

      case 'promote':
        await groupAction(msg, args, 'promote');
        break;

      case 'demote':
        await groupAction(msg, args, 'demote');
        break;

      case 'mute':
        if (!isGroup) return reply('Group only command.');
        await sock.groupSettingUpdate(jid, 'announcement');
        await reply('🔇 Group muted (only admins can send).');
        break;

      case 'unmute':
        if (!isGroup) return reply('Group only command.');
        await sock.groupSettingUpdate(jid, 'not_announcement');
        await reply('🔊 Group unmuted.');
        break;

      case 'gcstatus':
        await gcStatus(msg);
        break;

      case 'groupinfo':
        await groupInfo(msg);
        break;

      case 'link':
        await groupLink(msg);
        break;

      case 'revoke':
        await revokeLink(msg);
        break;

      case 'vv':
        await viewOnce(msg);
        break;

      default:
        await reply(`❌ Unknown command. Use ${settings.PREFIX}help for list.`);
    }
  } catch (e) {
    console.error(e);
    await reply(`❌ Error: ${e.message}`);
  }
}

// ================== COMMAND IMPLEMENTATIONS ==================
async function sendHelp(jid) {
  const helpText = `
╭━━❰ *WHATSAPP BOT* ❱━━⬣
┃
┃ ⬡ *Downloader*
┃   ${settings.PREFIX}yt <url> - Download YouTube video
┃   ${settings.PREFIX}song <query> - Download YouTube audio
┃   ${settings.PREFIX}vid <query> - Search & download video
┃   ${settings.PREFIX}yts <query> - Search YouTube
┃   ${settings.PREFIX}tt <url> - TikTok no watermark
┃   ${settings.PREFIX}ig <url> - Instagram reel/video
┃   ${settings.PREFIX}fb <url> - Facebook video
┃
┃ ⬡ *Group Manager*
┃   ${settings.PREFIX}tagall - Tag all participants
┃   ${settings.PREFIX}kick @user - Remove member
┃   ${settings.PREFIX}add <number> - Add member
┃   ${settings.PREFIX}promote @user - Make admin
┃   ${settings.PREFIX}demote @user - Remove admin
┃   ${settings.PREFIX}mute / unmute
┃   ${settings.PREFIX}gcstatus - Group status
┃   ${settings.PREFIX}groupinfo - Group details
┃   ${settings.PREFIX}link - Get invite link
┃   ${settings.PREFIX}revoke - Revoke invite link
┃
┃ ⬡ *Protection*
┃   ${settings.PREFIX}vv - View a view-once message (reply)
┃
┃ ⬡ *Owner*
┃   ${settings.PREFIX}ping - Check bot status
╰━━━━━━━━━━━━━━━━⬣
`;
  await sendText(jid, helpText);
}

async function downloadYouTube(msg, urlOrQuery, type) {
  const jid = msg.key.remoteJid;
  try {
    // If it's a query, search first
    let url = urlOrQuery;
    if (!ytdl.validateURL(urlOrQuery)) {
      const res = await yts(urlOrQuery);
      if (!res.videos.length) return await sendText(jid, '❌ No results found.');
      url = res.videos[0].url;
    }

    if (type === 'video') {
      const stream = ytdl(url, { filter: format => format.hasVideo && format.hasAudio, quality: 'highest' });
      await sock.sendMessage(jid, { video: stream, caption: '📹 YouTube Video' });
    } else {
      const stream = ytdl(url, { filter: 'audioonly', quality: 'highestaudio' });
      await sock.sendMessage(jid, { audio: stream, mimetype: 'audio/mp4', ptt: false, caption: '🎵 YouTube Audio' });
    }
  } catch (e) {
    await sendText(jid, `❌ Download failed: ${e.message}`);
  }
}

async function searchAndDownloadYouTube(msg, query, type) {
  const jid = msg.key.remoteJid;
  try {
    const res = await yts(query);
    if (!res.videos.length) return await sendText(jid, '❌ No results found.');
    const url = res.videos[0].url;
    await downloadYouTube(msg, url, type);
  } catch (e) {
    await sendText(jid, `❌ Search/download failed: ${e.message}`);
  }
}

async function searchYouTube(msg, query) {
  const jid = msg.key.remoteJid;
  try {
    const res = await yts(query);
    if (!res.videos.length) return await sendText(jid, '❌ No results found.');
    const list = res.videos.slice(0, 10).map((v, i) => `${i + 1}. ${v.title} (${v.timestamp})`).join('\n');
    await sendText(jid, `🔍 *YouTube Search Results*\n\n${list}`);
  } catch (e) {
    await sendText(jid, `❌ Search failed: ${e.message}`);
  }
}

async function downloadTikTok(msg, url) {
  const jid = msg.key.remoteJid;
  try {
    const data = await tiktokdl(url);
    const videoUrl = data?.video?.noWatermark || data?.video?.watermark || data?.video?.nowm;
    if (!videoUrl) return await sendText(jid, '❌ Could not extract TikTok video.');
    await sock.sendMessage(jid, { video: { url: videoUrl }, caption: '🎵 TikTok Video' });
  } catch (e) {
    await sendText(jid, `❌ TikTok download failed: ${e.message}`);
  }
}

async function downloadInstagram(msg, url) {
  const jid = msg.key.remoteJid;
  try {
    const data = await instagramdl(url);
    const media = Array.isArray(data) ? data[0] : data;
    if (!media?.url) return await sendText(jid, '❌ Could not extract Instagram media.');
    if (media.type === 'image') {
      await sock.sendMessage(jid, { image: { url: media.url }, caption: '📸 Instagram Post' });
    } else {
      await sock.sendMessage(jid, { video: { url: media.url }, caption: '🎬 Instagram Reel' });
    }
  } catch (e) {
    await sendText(jid, `❌ Instagram download failed: ${e.message}`);
  }
}

async function downloadFacebook(msg, url) {
  const jid = msg.key.remoteJid;
  try {
    const data = await facebookdl(url);
    const media = Array.isArray(data) ? data[0] : data;
    if (!media?.url) return await sendText(jid, '❌ Could not extract Facebook video.');
    await sock.sendMessage(jid, { video: { url: media.url }, caption: '🎬 Facebook Video' });
  } catch (e) {
    await sendText(jid, `❌ Facebook download failed: ${e.message}`);
  }
}

async function tagAll(msg) {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith('@g.us')) return await sendText(jid, 'Group only command.');
  const participants = await getParticipants(jid);
  const mentions = participants.map(p => p.id);
  const text = msg.message.conversation?.replace(settings.PREFIX + 'tagall', '').trim() || '🔔 Attention everyone!';
  await sock.sendMessage(jid, { text, mentions });
}

async function groupAction(msg, args, action) {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith('@g.us')) return await sendText(jid, 'Group only command.');

  let target;
  if (action === 'add') {
    const number = args[0]?.replace(/[^0-9]/g, '');
    if (!number) return await sendText(jid, '❌ Provide phone number.');
    target = number + '@s.whatsapp.net';
  } else {
    const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (mentions.length > 0) target = mentions[0];
    else if (msg.message.extendedTextMessage?.contextInfo?.participant) {
      target = msg.message.extendedTextMessage.contextInfo.participant;
    } else {
      return await sendText(jid, '❌ Mention or reply to a user.');
    }
  }

  if (!target) return await sendText(jid, '❌ Target not found.');

  const actionMap = {
    remove: 'remove',
    add: 'add',
    promote: 'promote',
    demote: 'demote'
  };

  try {
    await sock.groupParticipantsUpdate(jid, [target], actionMap[action]);
    await sendText(jid, `✅ Action ${action} executed.`);
  } catch (e) {
    await sendText(jid, `❌ Failed: ${e.message}`);
  }
}

async function gcStatus(msg) {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith('@g.us')) return await sendText(jid, 'Group only command.');
  const metadata = await getGroupMetadata(jid);
  const participants = metadata.participants.length;
  const admins = metadata.participants.filter(p => p.admin).length;
  await sendText(jid, `📊 *Group Status*\n\n👥 Members: ${participants}\n🛡️ Admins: ${admins}\n🔒 Only Admins: ${metadata.announce ? 'Yes' : 'No'}`);
}

async function groupInfo(msg) {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith('@g.us')) return await sendText(jid, 'Group only command.');
  const metadata = await getGroupMetadata(jid);
  const owner = metadata.owner ? metadata.owner.split('@')[0] : 'Unknown';
  const creation = new Date(metadata.creation * 1000).toLocaleString();
  await sendText(jid, `ℹ️ *Group Info*\n\n📛 Subject: ${metadata.subject}\n📝 Description: ${metadata.desc || 'None'}\n👑 Owner: @${owner}\n📅 Created: ${creation}\n👥 Members: ${metadata.participants.length}`, { mentions: [metadata.owner] });
}

async function groupLink(msg) {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith('@g.us')) return await sendText(jid, 'Group only command.');
  try {
    const code = await sock.groupInviteCode(jid);
    await sendText(jid, `🔗 Invite Link:\nhttps://chat.whatsapp.com/${code}`);
  } catch (e) {
    await sendText(jid, `❌ Failed to get link: ${e.message}`);
  }
}

async function revokeLink(msg) {
  const jid = msg.key.remoteJid;
  if (!jid.endsWith('@g.us')) return await sendText(jid, 'Group only command.');
  try {
    await sock.groupRevokeInvite(jid);
    await sendText(jid, '✅ Invite link revoked.');
  } catch (e) {
    await sendText(jid, `❌ Failed to revoke link: ${e.message}`);
  }
}

async function viewOnce(msg) {
  const jid = msg.key.remoteJid;
  const quotedId = msg.message.extendedTextMessage?.contextInfo?.stanzaId;
  if (!quotedId) return await sendText(jid, '❌ Reply to a view-once message.');
  const content = viewOnceStore.get(quotedId);
  if (!content) return await sendText(jid, '❌ View-once content not found or already viewed.');

  if (content.imageMessage) {
    await sock.sendMessage(jid, { image: content.imageMessage });
  } else if (content.videoMessage) {
    await sock.sendMessage(jid, { video: content.videoMessage });
  } else if (content.audioMessage) {
    await sock.sendMessage(jid, { audio: content.audioMessage });
  } else if (content.conversation) {
    await sock.sendMessage(jid, { text: content.conversation });
  } else {
    await sendText(jid, '❌ Unsupported view-once content.');
  }
}

// ================== START ==================
startBot().catch(err => console.error('Fatal error:', err));
