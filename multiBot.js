const fs = require('fs');
const http = require('http');
const StellarSdk = require('stellar-sdk');

// Connect to Pi Network Horizon server
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Load bot config
let bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));

// Config
const retryLimit = 20;
const retryDelay = 2000; // 2 seconds

let botStates = {}; // botName => { prepared, retries, done, txData }

bots.forEach(bot => {
  botStates[bot.name] = {
    prepared: false,
    retries: 0,
    done: false,
    txData: null
  };
});

// Pre-prepare transaction data
async function prepare(bot) {
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
    botStates[bot.name].txData = tx;
    botStates[bot.name].prepared = true;
    console.log(`🛠️ [${bot.name}] Transaction prepared.`);
  } catch (e) {
    console.log(`⚠️ [${bot.name}] Failed to prepare: ${e.message}`);
    setTimeout(() => prepare(bot), 5000); // Retry preparation every 5s
  }
}

// Submit transaction with retries
async function sendWithRetry(bot) {
  const botState = botStates[bot.name];

  if (botState.done || botState.retries >= retryLimit) return;

  try {
    const res = await server.submitTransaction(botState.txData);
    console.log(`✅ [${bot.name}] Sent ${bot.amount} Pi | TX: ${res.hash}`);
    botState.done = true;
  } catch (e) {
    const errorMsg = e?.response?.data?.extras?.result_codes?.operations || e.message;
    botState.retries++;
    console.log(`❌ [${bot.name}] Attempt ${botState.retries}: ${errorMsg}`);
    if (botState.retries < retryLimit) {
      setTimeout(() => sendWithRetry(bot), retryDelay);
    } else {
      console.log(`🛑 [${bot.name}] Gave up after ${retryLimit} retries.`);
      botState.done = true;
    }
  }
}

// Check every 100ms
setInterval(() => {
  const now = new Date();
  const [h, m, s, ms] = [now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()];

  bots.forEach(bot => {
    const [bh, bm, bs, bms] = [parseInt(bot.hour), parseInt(bot.minute), parseInt(bot.second), parseInt(bot.ms || 0)];
    const botState = botStates[bot.name];

    // Daily reset
    if (h === 0 && m === 0 && s === 0 && ms < 100) {
      botState.retries = 0;
      botState.done = false;
      botState.prepared = false;
      botState.txData = null;
      console.log(`🔁 [${bot.name}] Reset state.`);
      prepare(bot);
    }

    // Prepare a few seconds early
    if (!botState.prepared && (
      h > bh || (h === bh && m > bm) || (h === bh && m === bm && s >= bs - 5)
    )) {
      prepare(bot);
    }

    // Time match
    if (
      h === bh &&
      m === bm &&
      s === bs &&
      Math.abs(ms - bms) < 100 &&
      botState.prepared &&
      !botState.done
    ) {
      console.log(`🕓 [${bot.name}] Time matched. Sending now...`);
      sendWithRetry(bot);
    }
  });
}, 100); // 100ms check

console.log("🟢 Multi-bot scheduler is running...");

// Minimal HTTP server
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('🟢 Pi Multi-bot is running.\n');
}).listen(PORT, () => {
  console.log(`🌐 HTTP server listening on port ${PORT}`);
});
