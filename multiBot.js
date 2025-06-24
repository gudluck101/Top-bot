const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

// Load bot list and fee wallet
const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const feeWallet = JSON.parse(fs.readFileSync('fee-wallet.json', 'utf-8'));

const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

let executed = false;
const latestSequences = {};

// Track sequence updates via stream
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

// Helper to convert bot time to UTC ms
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Main send logic
async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);
  const feeKey = StellarSdk.Keypair.fromSecret(feeWallet.secret);

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const sequence = latestSequences[bot.public];
      if (!sequence) throw new Error('Missing sequence');

      const account = new StellarSdk.Account(bot.public, sequence);

      const tx = new StellarSdk.TransactionBuilder(account, {
        fee: (StellarSdk.BASE_FEE * 2).toString(),
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

      const feeBumpTx = new StellarSdk.FeeBumpTransactionBuilder(tx, {
        feeSource: feeKey.publicKey(),
        baseFee: '10000000', // 1 Pi
        networkPassphrase: 'Pi Network'
      }).build();

      feeBumpTx.sign(feeKey);

      const result = await server.submitTransaction(feeBumpTx);
      console.log(`✅ [${bot.name}] Sent ${bot.amount} Pi. TX hash: ${result.hash}`);
    } catch (e) {
      const msg = e.response?.data?.extras?.result_codes || e.message;
      console.log(`❌ [${bot.name}] Attempt ${attempt} failed:`, msg);
    }
  }
}

// Run all bots one by one
async function runBotsSequentially() {
  for (let bot of bots) {
    console.log(`🚀 Executing ${bot.name}...`);
    await send(bot);
  }
}

// Timer loop to match time
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
    console.log(`⏰ Time matched for ${firstBot.name}.`);
    executed = true;
    runBotsSequentially();
  }

  if (nowMs < 1000) {
    executed = false;
    console.log("🕛 New UTC day — reset executed.");
  }
}, 100);

// Express web monitor
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => {
  res.send(`🟢 Triggered: ${executed}`);
});
app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
