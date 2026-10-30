const settings = {
  packname: process.env.BOT_PACKNAME || 'ZOXER BOT',
  author: process.env.BOT_AUTHOR || 'ZOXER TEAM',
  botName: process.env.BOT_NAME || "〔 𝗭𝗢𝗫𝗘𝗥  𝗕𝗢𝗧 〕",
  botOwner: process.env.BOT_OWNER || 'ZOXER TEAM',
  ownerNumber: process.env.OWNER_NUMBER || '923232391033', // Pakistan number format without + symbol
  ownerNumbers: (process.env.OWNER_NUMBERS || '923232391033,923292823218,923252025304,12224080949405').split(','), // Multiple owners array (comma separated, e.g., '923232391033,923232391034')
  giphyApiKey: process.env.GIPHY_API_KEY || 'qnl7ssQChTdPjsKta2Ax2LMaGXz303tq',
  commandMode: process.env.BOT_MODE || "public",
  maxStoreMessages: parseInt(process.env.MAX_STORE_MESSAGES || '20'),
  storeWriteInterval: parseInt(process.env.STORE_WRITE_INTERVAL || '10000'),
  description: "Professional WhatsApp bot for managing groups and automating tasks.",
  version: "1.0.0",
  logicUrl: process.env.LOGIC_URL || "", // Add your remote bin direct download link here
  updateZipUrl: "",
  channelLink: "https://whatsapp.com/channel/0029VbBRITODzgTGQhZSFT3P",
  newsletterJid: "120363404139113188@newsletter",
  connectionImagePath: process.env.CONNECTION_IMAGE_PATH || "./zoxer.jfif",
  newsletters: [
    '120363404139113188@newsletter'
  ],
  knightBotApiKey: process.env.KNIGHTBOT_API_KEY || 'knight',
  zoxerMediaApiUrl: process.env.ZOXER_MEDIA_API_URL || 'https://zoxer-media-api.sarukhmazari1.workers.dev',
  zoxerMediaApiKey: process.env.ZOXER_MEDIA_API_KEY || 'zoxer_e4b5054d63fc1ed506cdafc9be5c858410b5f17e97a8a5da'
};

module.exports = settings;
