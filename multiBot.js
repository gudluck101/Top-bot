const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

let executed = false;
let preparedTxs = {};

// Helper: convert target time to ms
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Prepare and sign all transactions
async function prepareTransactions() {
  console.log("⏳ Preparing all transactions...");
  for (let bot of bots) {
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
      preparedTxs[bot.name] = tx;
      console.log(`🧾 [${bot.name}] Prepared and signed.`);
    } catch (e) {
      console.error(`❌ Failed to prepare [${bot.name}]: ${e.message}`);
    }
  }
  console.log("✅ All transactions ready.");
}

// Submit prepared transaction
async function submit(bot) {
  try {
    const tx = preparedTxs[bot.name];
    if (!tx) {
      console.error(`❌ [${bot.name}] Transaction not prepared.`);
      return;
    }

    const res = await server.submitTransaction(tx);
    console.log(`✅ [${bot.name}] Sent ${bot.amount} Pi | TX: ${res.hash}`);
  } catch (e) {
    const errorMsg = e?.response?.data?.extras?.result_codes?.operations || e.message;
    console.log(`❌ [${bot.name}] Failed: ${errorMsg}`);
  }
}

// Sequentially submit all bots
async function submitAll() {
  for (let bot of bots) {
    console.log(`🚀 Sending [${bot.name}]...`);
    await submit(bot);
    await new Promise(res => setTimeout(res, 0)); // 0s gap
  }
}

// Check time match
setInterval(() => {
  if (executed) return;

  const now = new Date();
  const nowMs = now.getHours() * 3600000 + now.getMinutes() * 60000 + now.getSeconds() * 1000 + now.getMilliseconds();

  const firstBot = bots[0];
  const triggerMs = getBotTimestamp(firstBot);
  const diff = Math.abs(nowMs - triggerMs);

  if (diff <= 200) {
    console.log(`⏰ Triggered by [${firstBot.name}] at ${now.toISOString()}`);
    executed = true;
    submitAll();
  }

  // Reset at 00:00:00
  if (nowMs < 1000) {
    executed = false;
    console.log("🔄 New day, system reset.");
    prepareTransactions(); // Re-prepare for the new day
  }
}, 100);

// Startup
prepareTransactions();

// Web server
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (_, res) => {
  res.send(`🟢 Multi-bot running. Executed today? ${executed ? '✅' : '❌'}`);
});

app.listen(PORT, () => {
  console.log(`🌐 Web server on port ${PORT}`);
});
