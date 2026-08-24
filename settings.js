module.exports = {
  // Bot prefix (e.g., .yt, .help)
  PREFIX: process.env.PREFIX || '.',

  // Owner WhatsApp number (with country code, no '+')
  OWNER_NUMBER: process.env.OWNER_NUMBER || '',

  // Bot image URL (used for profile picture or reply thumbnails)
  BOT_IMAGE_URL: process.env.BOT_IMAGE_URL || '',

  // Session directory for Baileys authentication
  SESSION_DIR: process.env.SESSION_DIR || './session',

  // Web dashboard port
  PORT: process.env.PORT || 3000,

  // Protection toggles
  ANTI_DELETE: process.env.ANTI_DELETE !== 'false',   // Recover deleted messages
  ANTI_LINK: process.env.ANTI_LINK !== 'false',       // Remove non‑admins sharing links
  ANTI_CALL: process.env.ANTI_CALL !== 'false',       // Reject incoming calls
  AUTO_STATUS: process.env.AUTO_STATUS !== 'false',   // Auto view status updates
  AUTO_REACT: process.env.AUTO_REACT !== 'false',     // Auto react to messages
  AUTO_REACT_EMOJIS: (process.env.AUTO_REACT_EMOJIS || '👍,❤️,😂,🔥,👀').split(',').map(e => e.trim()),
  ANTI_VIEWONCE: process.env.ANTI_VIEWONCE !== 'false' // Store view‑once content
};
