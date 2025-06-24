const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

let executed = false;
const latestSequences = {};

// Live stream to get sequence number
for (let bot of bots) {
  server.accounts()
    .accountId(bot.public)
    .stream({
      onmessage: account => {
        latestSequences[bot.public] = account.sequence;
      },
      onerror: err => {
        console.error(`Stream error for ${bot.name}:`, err.message);
      }
    });
}

// Convert bot's UTC time to milliseconds
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
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const sequence = latestSequences[bot.public];
      if (!sequence) throw new Error('Missing sequence for ' + bot.name);

      const account = new StellarSdk.Account(bot.public, sequence);
      const baseFeePi = parseFloat(bot.baseFeePi || "0.005");
      const baseFeeStroops = Math.floor(baseFeePi * 10000000);
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

      tx.sign(botKey);
      const result = await server.submitTransaction(tx);

      console.log(`✅ [${bot.name}] TX Success: ${result.hash}`);
      return;
    } catch (e) {
      console.log(`❌ [${bot.name}] Attempt ${attempt} failed.`);
      if (e?.response?.data?.extras?.result_codes) {
        console.log('🔍 result_codes:', e.response.data.extras.result_codes);
      } else {
        console.log('🔍 Raw error:', e.message || e.toString());
      }
    }
  }
}

// Run all bots
async function runBotsSequentially() {
  for (const bot of bots) {
    console.log(`🚀 Running ${bot.name}...`);
    await send(bot);
  }
}

// Time-based trigger loop
setInterval(() => {
  const now = new Date();
  const nowMs =
    now.getUTCHours() * 3600000 +
    now.getUTCMinutes() * 60000 +
    now.getUTCSeconds() * 1000 +
    now.getUTCMilliseconds();

  const firstBot = bots[0];
  const botTimeMs = getBotTimestamp(firstBot);
  const diff = Math.abs(nowMs - botTimeMs);

  if (!executed && diff <= 200) {
    console.log(`⏰ Time matched for ${firstBot.name}. Starting...`);
    executed = true;
    runBotsSequentially();
  }

  // Reset once a day
  if (nowMs < 1000) {
    executed = false;
    console.log("🔁 New UTC day — reset.");
  }
}, 100);

// Web monitor
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => {
  res.send(`🟢 Bot status: Triggered = ${executed}`);
});
app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
