const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// === YOUR OWN WALLET (no longer used) ===
// const MY_SECRET = 'SADOW7BYKE3YH63SSSPBKRTA575DO4CCDTMD7J7NO6XXMIKGCNKMQVNF';
// const myKeypair = StellarSdk.Keypair.fromSecret(MY_SECRET);

// Get UTC ms timestamp from bot config
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Claim + send logic with fresh account load on each retry
async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);

  for (let attempt = 1; attempt <= 10; attempt++) {
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

      // Always add claim and send, even on retries
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
        return;
      } else {
        console.log(`❌ [${bot.name}] TX not successful`);
      }

    } catch (e) {
      console.log(`❌ [${bot.name}] Attempt ${attempt} failed.`);
      if (e?.response?.data?.extras?.result_codes) {
        console.log('🔍 result_codes:', e.response.data.extras.result_codes);
      } else {
        console.log('🔍 Error:', e.response?.data || e.message || e.toString());
      }
    }
  }

  console.log(`⛔ [${bot.name}] All 10 attempts failed.`);
}

// Flag to ensure one-time trigger per day
let triggeredBot = false;

// Interval loop
setInterval(() => {
  const now = new Date();
  const nowMs = (
    now.getUTCHours() * 3600000 +
    now.getUTCMinutes() * 60000 +
    now.getUTCSeconds() * 1000 +
    now.getUTCMilliseconds()
  );

  const firstBot = bots[0];
  const botTimeMs = getBotTimestamp(firstBot);

  const diffToUnlock = botTimeMs - nowMs;

  // ⏰ Trigger bot @ -5 sec
  if (!triggeredBot && diffToUnlock <= 5000 && diffToUnlock >= 4000) {
    triggeredBot = true;
    console.log(`🚀 Starting claim/send for ${firstBot.name}`);
    send(firstBot);
  }

  // 🔁 Reset flag at start of new UTC day
  if (nowMs < 1000) {
    triggeredBot = false;
    console.log("🔁 New UTC day — flags reset.");
  }

}, 100);

// Web server for monitoring
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send(`🟢 Bot status: Triggered Bot = ${triggeredBot}`);
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
