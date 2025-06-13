const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

let executed = false; // Flag to run all bots once
let triggeredTimeMs = null;

// Helper to parse bot time
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Send function (no retry)
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
  } catch (e) {
    const errorMsg = e?.response?.data?.extras?.result_codes?.operations || e.message;
    console.log(`❌ [${bot.name}] Failed: ${errorMsg}`);
  }
}

// Run all bots sequentially
async function runBotsSequentially() {
  for (let bot of bots) {
    console.log(`🚀 Executing [${bot.name}]...`);
    await send(bot);
    await new Promise(res => setTimeout(res, 1000)); // 1s delay between each
  }
}

// Check every 100ms
setInterval(() => {
  if (executed) return;

  const now = new Date();
  const nowMs = now.getHours() * 3600000 + now.getMinutes() * 60000 + now.getSeconds() * 1000 + now.getMilliseconds();

  const firstBot = bots[0];
  const botTimeMs = getBotTimestamp(firstBot);
  const diff = Math.abs(nowMs - botTimeMs);

  if (diff <= 200) {
    console.log(`⏰ [${firstBot.name}] Time matched. Starting sequence...`);
    triggeredTimeMs = nowMs;
    executed = true;
    runBotsSequentially();
  }

  // Reset daily at 00:00:00
  if (nowMs < 1000) {
    executed = false;
    triggeredTimeMs = null;
    console.log("🔄 Resetting for new day.");
  }
}, 100);

// Start Express server for status check
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`🟢 Multi-bot active. Triggered: ${executed ? 'Yes' : 'No'}`);
});

app.listen(PORT, () => {
  console.log(`🌐 Server running on port ${PORT}`);
});
