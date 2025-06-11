const fs = require('fs');
const http = require('http');
const StellarSdk = require('stellar-sdk');

// Connect to Pi Network Horizon server
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Load bots config
let bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));

const retryLimit = 50;
let retryCounts = {};
let statusMap = {};

// Initialize counters
bots.forEach(bot => {
  retryCounts[bot.name] = 0;
  statusMap[bot.name] = false;
});

async function send(bot) {
  retryCounts[bot.name] += 1;

  try {
    const account = await server.loadAccount(bot.public);
    const fee = await server.fetchBaseFee();
    const keypair = StellarSdk.Keypair.fromSecret(bot.secret);

    const transaction = new StellarSdk.TransactionBuilder(account, {
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

    transaction.sign(keypair);
    const res = await server.submitTransaction(transaction);
    console.log(`✅ [${bot.name}] Sent ${bot.amount} Pi | TX: ${res.hash}`);
  } catch (e) {
    const errorMsg = e?.response?.data?.extras?.result_codes?.operations || e.message;
    console.log(`❌ [${bot.name}] Failed (Retry ${retryCounts[bot.name]}): ${errorMsg}`);
  }

  // Immediately retry if under limit
  if (retryCounts[bot.name] < retryLimit) {
    send(bot); // 🔁 No delay retry
  } else {
    console.log(`🛑 [${bot.name}] Retry limit (${retryLimit}) reached.`);
    statusMap[bot.name] = true;
  }
}

function checkTime() {
  const now = new Date();
  const [h, m, s] = [now.getHours(), now.getMinutes(), now.getSeconds()];

  bots.forEach(bot => {
    if (
      parseInt(bot.hour) === h &&
      parseInt(bot.minute) === m &&
      parseInt(bot.second) === s &&
      !statusMap[bot.name]
    ) {
      console.log(`🕓 [${bot.name}] Time matched! Starting up to ${retryLimit} retries...`);
      send(bot);
    }

    // Reset daily
    if (h === 0 && m === 0 && s === 0) {
      retryCounts[bot.name] = 0;
      statusMap[bot.name] = false;
    }
  });
}

// Run every second
setInterval(checkTime, 1000);
console.log("🟢 Multi-bot is running...");

// Minimal HTTP server for Render
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('🟢 Pi Multi-bot is running.\n');
}).listen(PORT, () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});
