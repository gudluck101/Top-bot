const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Convert time to UTC ms
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Main bot logic
async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);

  for (let attempt = 1; attempt <= 200; attempt++) {
    try {
      if (attempt > 1) await new Promise(res => setTimeout(res, 400));

      const accountData = await server.loadAccount(bot.public);
      const account = new StellarSdk.Account(bot.public, accountData.sequence);

      const baseFeePi = parseFloat(bot.baseFeePi || "0.005");
      const baseFeeStroops = Math.floor(baseFeePi * 1e7);

      const txBuilder = new StellarSdk.TransactionBuilder(account, {
        fee: (baseFeeStroops * 2).toString(),
        networkPassphrase: 'Pi Network',
      });

        txBuilder.addOperation(StellarSdk.Operation.claimClaimableBalance({
          balanceId: bot.claimId
        }));

      txBuilder.addOperation(StellarSdk.Operation.payment({
        destination: bot.destination,
        asset: StellarSdk.Asset.native(),
        amount: bot.amount,
      }));

      const tx = txBuilder.setTimeout(60).build();
      tx.sign(botKey);

      const result = await server.submitTransaction(tx);

      if (result?.successful && result?.hash) {
  console.log(`✅ [${bot.name}] TX Success! Hash: ${result.hash}`);
  // Do NOT return here — keep going to retry all attempts
} else {
  console.log(`❌ [${bot.name}] TX not successful`);
}

    } catch (e) {
      console.log(`❌ [${bot.name}] Attempt ${attempt} failed.`);

      // Detailed Horizon error logging
      if (e?.response?.data?.extras?.result_codes) {
        console.log('🔍 result_codes:', e.response.data.extras.result_codes);
      } else if (e?.response?.data) {
        console.log('🔍 Horizon error:', e.response.data);
      } else if (e?.response) {
        console.log('🔍 Response error:', e.response);
      } else {
        console.log('🔍 Raw error:', e.message || e.toString());
      }
    }
  }

  console.log(`⛔ [${bot.name}] All 200 attempts failed.`);
}

// Run bots one-by-one
async function runBotsSequentially() {
  for (const bot of bots) {
    console.log(`🚀 Running ${bot.name}...`);
    await send(bot);
  }
}

let executed = false;

// Time-based trigger
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

  if (nowMs < 1000) {
    executed = false;
    console.log("🔁 New UTC day — reset.");
  }
}, 100);

// Web UI to monitor status
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send(`🟢 Bot status: Triggered = ${executed}`);
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
