const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

let executed = false;
let triggeredTimeMs = null;
const latestSequences = {};

// Horizon live stream per bot
for (let bot of bots) {
  server.accounts()
    .accountId(bot.public)
    .stream({
      onmessage: account => {
        latestSequences[bot.public] = {
          sequence: account.sequence,
          updatedAt: new Date()
        };
      },
      onerror: err => {
        console.error(`🔌 Horizon stream error for ${bot.name}:`, err.message);
      }
    });
}

// Convert bot trigger time to UTC milliseconds
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Main transaction logic
async function send(bot) {
  const keypair = StellarSdk.Keypair.fromSecret(bot.secret);

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const cached = latestSequences[bot.public];
      if (!cached) throw new Error(`Missing live sequence for ${bot.name}`);

      const account = new StellarSdk.Account(bot.public, cached.sequence);

      const baseFeeStroops = Math.floor(parseFloat(bot.baseFeePi || "0.005") * 10000000);
      const totalFee = (baseFeeStroops * 2).toString(); // 2 operations

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: totalFee,
        networkPassphrase: 'Pi Network',
      })
        .addOperation(StellarSdk.Operation.claimClaimableBalance({
          balanceId: bot.claimId
        }))
        .addOperation(StellarSdk.Operation.payment({
          destination: bot.destination,
          asset: StellarSdk.Asset.native(),
          amount: bot.amount,
        }))
        .setTimeout(60)
        .build();

      tx.sign(keypair);
      const res = await server.submitTransaction(tx);
      console.log(`✅ [${bot.name}] Claimed + Sent ${bot.amount} Pi | TX: ${res.hash}`);
      return;
    } catch (e) {
      const errorMsg = e?.response?.data?.extras?.result_codes || e.message;
      console.log(`❌ [${bot.name}] Attempt ${attempt} failed: ${JSON.stringify(errorMsg)}`);
      if (attempt === 5) {
        console.log(`🛑 [${bot.name}] All 5 attempts failed.`);
      }
    }
  }
}

// Run all bots one after another
async function runBotsSequentially() {
  for (let bot of bots) {
    console.log(`🚀 Running [${bot.name}]...`);
    await send(bot);
  }
}

// Time-based trigger loop
setInterval(() => {
  if (executed) return;

  const now = new Date();
  const nowMs =
    now.getUTCHours() * 3600000 +
    now.getUTCMinutes() * 60000 +
    now.getUTCSeconds() * 1000 +
    now.getUTCMilliseconds();

  const firstBot = bots[0];
  const botTimeMs = getBotTimestamp(firstBot);
  const diff = Math.abs(nowMs - botTimeMs);

  if (diff <= 200) {
    console.log(`⏰ Time matched for [${firstBot.name}]. Executing bots...`);
    triggeredTimeMs = nowMs;
    executed = true;
    runBotsSequentially();
  }

  if (nowMs < 1000) {
    executed = false;
    triggeredTimeMs = null;
    console.log("🔄 New UTC day — reset executed flag.");
  }
}, 100);

// Simple web monitor
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`🟢 Multi-bot status: Triggered = ${executed ? 'Yes' : 'No'}`);
});

app.listen(PORT, () => {
  console.log(`🌐 Express server running on port ${PORT}`);
});
