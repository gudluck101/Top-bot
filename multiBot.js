const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

// Start Express server
const app = express();
const PORT = process.env.PORT || 3000;

// Status route
app.get('/', (req, res) => {
  res.send('🟢 Multi-bot is running. Bots: ' + Object.keys(statusMap).join(', '));
});

app.listen(PORT, () => {
  console.log(`🌐 Server is listening on port ${PORT}`);
});

// Connect to Pi Network Horizon server
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Load bots config from bot.json
let bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
let statusMap = {};

// Initialize retry counters and status
bots.forEach(bot => {
  bot.retries = 0;
  statusMap[bot.name] = false;
});

async function send(bot, attempt = 1) {
  if (attempt > 20) {
    console.log(`❌ [${bot.name}] Max retries (20) reached.`);
    statusMap[bot.name] = true;
    return;
  }

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
    statusMap[bot.name] = true;
  } catch (e) {
    const errorMsg = e?.response?.data?.extras?.result_codes?.operations || e.message;
    console.log(`❌ [${bot.name}] Failed (Attempt ${attempt}): ${errorMsg}`);
    await send(bot, attempt + 1); // Retry immediately
  }
}

function checkTime() {
  const now = new Date();
  const [h, m, s] = [now.getHours(), now.getMinutes(), now.getSeconds()];

  const sendTasks = [];

  bots.forEach(bot => {
    if (
      parseInt(bot.hour) === h &&
      parseInt(bot.minute) === m &&
      parseInt(bot.second) === s &&
      !statusMap[bot.name]
    ) {
      console.log(`🕓 [${bot.name}] Time matched! Sending ${bot.amount} Pi...`);
      sendTasks.push(send(bot)); // Queue the send
    }

    // Reset status daily at 00:00:00
    if (h === 0 && m === 0 && s === 0) {
      statusMap[bot.name] = false;
    }
  });

  // Run all send operations concurrently
  if (sendTasks.length > 0) {
    Promise.all(sendTasks).catch(err => console.error('❌ Multi-send error:', err));
  }
}

// Check every second
setInterval(checkTime, 1000);
console.log("🟢 Multi-bot is running...");
