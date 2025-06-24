const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

// Load bot and fee payer config
const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const feeWallet = JSON.parse(fs.readFileSync('fee-wallet.json', 'utf-8'));

const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

let executed = false;
let triggeredTimeMs = null;
const latestSequences = {};

// Live stream to update sequence number
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
        console.error(`🔌 Stream error for ${bot.name}:`, err.message);
      }
    });
}

// Bot trigger time in milliseconds
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Main transaction logic with fee bump and retry
async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);
  const feeKey = StellarSdk.Keypair.fromSecret(feeWallet.secret);

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const cached = latestSequences[bot.public];
      if (!cached) throw new Error(`Missing live sequence for ${bot.name}`);

      const account = new StellarSdk.Account(bot.public, cached.sequence);

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: (StellarSdk.BASE_FEE * 2).toString(), // 2 ops, fee will be bumped anyway
        networkPassphrase: 'Pi Network',
      })
        .addOperation(StellarSdk.Operation.claimClaimableBalance({ balanceId: bot.claimId }))
        .addOperation(StellarSdk.Operation.payment({
          destination: bot.destination,
          asset: StellarSdk.Asset.native(),
          amount: bot.amount,
        }))
        .setTimeout(60)
        .build();

      tx.sign(botKey);

      // Create fee bump with 1 Pi (10,000,000 stroops)
      const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
        feeKey,
        '10000000', // 1 Pi
        tx,
        StellarSdk.Networks.PUBLIC
      );

      feeBumpTx.sign(feeKey);

      const res = await server.submitTransaction(feeBumpTx);
      console.log(`✅ [${bot.name}] TX Successful with 1 Pi fee. Hash: ${res.hash}`);
    } catch (e) {
      const errorMsg = e?.response?.data?.extras?.result_codes || e.message;
      console.log(`❌ [${bot.name}] Attempt ${attempt} failed: ${JSON.stringify(errorMsg)}`);
    }
  }
}

// Sequential bot runner
async function runBotsSequentially() {
  for (let bot of bots) {
    console.log(`🚀 Running [${bot.name}]...`);
    await send(bot);
  }
}

// Timer to trigger at bot's set time
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

// Web monitor
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send(`🟢 Multi-bot status: Triggered = ${executed ? 'Yes' : 'No'}`);
});

app.listen(PORT, () => {
  console.log(`🌐 Express server running on port ${PORT}`);
});
