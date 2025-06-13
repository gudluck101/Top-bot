const fs = require('fs');
const StellarSdk = require('stellar-sdk');

// Connect to Pi Network Horizon server
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Load bots config from bot.json
let bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
let statusMap = {};

// Track send status
bots.forEach(bot => {
  statusMap[bot.name] = false;
});

// Helper to parse target bot time
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Send function with no retries
async function send(bot) {
  try {
    const account = await server.loadAccount(bot.public);
    const fee = await server.fetchBaseFee();
    const keypair = StellarSdk.Keypair.fromSecret(bot.secret);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee,
      networkPassphrase: 'Pi Network',
    })
      .addOperation(StellarSdk.Operation.payment({
        destination: bot.destination,
        asset: StellarSdk.Asset.native(),
        amount: bot.amount,
      }))
      .setTimeout(60)
      .build();

    tx.sign(keypair);
    const res = await server.submitTransaction(tx);
    console.log(`✅ [${bot.name}] Sent ${bot.amount} Pi | TX: ${res.hash}`);
    statusMap[bot.name] = true;
  } catch (e) {
    const errorMsg = e?.response?.data?.extras?.result_codes?.operations || e.message;
    console.log(`❌ [${bot.name}] Failed: ${errorMsg}`);
    statusMap[bot.name] = true;
  }
}

// Check every 100ms for precision
setInterval(() => {
  const now = new Date();
  const nowTimeMs = now.getHours() * 3600000 + now.getMinutes() * 60000 + now.getSeconds() * 1000 + now.getMilliseconds();

  bots.forEach(bot => {
    const botTimeMs = getBotTimestamp(bot);
    const diff = Math.abs(nowTimeMs - botTimeMs);

    if (diff <= 200 && !statusMap[bot.name]) {  // within ±200ms
      console.log(`🕓 [${bot.name}] Time matched (${bot.hour}:${bot.minute}:${bot.second}.${bot.millisecond || '000'}), sending ${bot.amount} Pi...`);
      send(bot);
    }

    // Reset daily
    if (nowTimeMs < 1000) {
      statusMap[bot.name] = false;
    }
  });
}, 100);

console.log("🟢 Multi-bot is running...");
