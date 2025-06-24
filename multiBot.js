const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

// Load bots and fee-payer wallet
const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const feeWallet = JSON.parse(fs.readFileSync('fee-wallet.json', 'utf-8'));

const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

let executed = false;
let triggeredTimeMs = null;
const latestSequences = {};

// Stream latest sequence for each bot
for (let bot of bots) {
  server.accounts()
    .accountId(bot.public)
    .stream({
      onmessage: account => {
        latestSequences[bot.public] = account.sequence;
      },
      onerror: err => {
        console.error(`🔌 Stream error for ${bot.name}:`, err.message);
      }
    });
}

// Convert bot time to UTC ms
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Main transaction logic with fee bump and 10 attempts
async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);
  const feeKey = StellarSdk.Keypair.fromSecret(feeWallet.secret);

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const sequence = latestSequences[bot.public];
      if (!sequence) throw new Error('Missing sequence for ' + bot.name);

      const account = new StellarSdk.Account(bot.public, sequence);

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: (StellarSdk.BASE_FEE * 2).toString(), // 2 operations
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

      // ✅ Create fee bump transaction (fee payer pays 1 Pi = 10,000,000 stroops)
      const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
        feeKey, // fee source
        '10000000', // 1 Pi
        tx,
        'Pi Network'
      );

      feeBumpTx.sign(feeKey);

      const result = await server.submitTransaction(feeBumpTx);
      console.log(`✅ [${bot.name}] Success. TX Hash: ${result.hash}`);
    } catch (e) {
      const msg = e?.response?.data?.extras?.result_codes || e.message;
      console.log(`❌ [${bot.name}] Attempt ${attempt} failed: ${JSON.stringify(msg)}`);
    }
  }
}

// Run bots one by one
async function runBotsSequentially() {
  for (const bot of bots) {
    console.log(`🚀 Running ${bot.name}...`);
    await send(bot);
  }
}

// Loop: check every 100ms if it's time to run
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
    console.log(`⏰ Time matched for ${firstBot.name}. Running bots...`);
    triggeredTimeMs = nowMs;
    executed = true;
    runBotsSequentially();
  }

  if (nowMs < 1000) {
    executed = false;
    triggeredTimeMs = null;
    console.log("🔄 New UTC day: reset executed flag.");
  }
}, 100);

// Web monitor
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => {
  res.send(`🟢 Multi-bot status: Triggered = ${executed ? 'Yes' : 'No'}`);
});
app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
