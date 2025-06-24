const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

let executed = false;
const latestSequences = {};

// Stream live sequence numbers
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

// Convert daily UTC time to ms
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Send transaction for a single bot
async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      if (attempt > 1) await new Promise(res => setTimeout(res, 400)); // short retry delay

      // Always fetch the latest sequence
      let sequence = latestSequences[bot.public];
      if (!sequence) {
        const account = await server.loadAccount(bot.public);
        sequence = account.sequence;
        latestSequences[bot.public] = sequence;
      }

      const account = new StellarSdk.Account(bot.public, sequence);
      const baseFeePi = parseFloat(bot.baseFeePi || "0.005");
      const baseFeeStroops = Math.floor(baseFeePi * 1e7);

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: (baseFeeStroops * 2).toString(),
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

      if (result?.successful && result?.hash) {
        console.log(`✅ [${bot.name}] TX Success! Hash: ${result.hash}`);
        return;
      } else {
        console.log(`⚠️ [${bot.name}] TX sent but may have failed:\n${JSON.stringify(result, null, 2)}`);
        throw new Error('TX not successful');
      }

    } catch (e) {
      console.log(`❌ [${bot.name}] Attempt ${attempt} failed.`);

      if (e?.response?.data?.extras?.result_codes) {
        console.log('🔍 result_codes:', e.response.data.extras.result_codes);
      } else if (e?.response?.data) {
        console.log('🔍 Horizon error:', e.response.data);
      } else {
        console.log('🔍 Raw error:', e.message || e.toString());
      }
    }
  }

  console.log(`❌ [${bot.name}] All 10 attempts failed.`);
}

// Run all bots sequentially
async function runBotsSequentially() {
  for (const bot of bots) {
    console.log(`🚀 Running ${bot.name}...`);
    await send(bot);
  }
}

// Check every 100ms for exact UTC time
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

// Web status
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => {
  res.send(`🟢 Bot status: Triggered = ${executed}`);
});
app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
