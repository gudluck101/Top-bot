const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const app = express();
const PORT = process.env.PORT || 3000;

const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Load bots config
const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const statusMap = {};
const signedTxs = [];

let alreadyTriggeredToday = false;

// Prepare transactions ahead of time
async function prepareTransactions() {
  const fee = await server.fetchBaseFee();

  for (const bot of bots) {
    try {
      const account = await server.loadAccount(bot.public);
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
      signedTxs.push({ name: bot.name, tx });
      statusMap[bot.name] = false;
      console.log(`🧾 [${bot.name}] Transaction prepared.`);
    } catch (e) {
      console.error(`❌ [${bot.name}] Failed to prepare transaction: ${e.message}`);
      signedTxs.push({ name: bot.name, tx: null });
      statusMap[bot.name] = true;
    }
  }
}

// Submit transactions in sequence
async function submitAll() {
  for (const signed of signedTxs) {
    const { name, tx } = signed;

    if (tx && !statusMap[name]) {
      try {
        const res = await server.submitTransaction(tx);
        console.log(`✅ [${name}] Submitted | TX: ${res.hash}`);
      } catch (e) {
        const errMsg = e?.response?.data?.extras?.result_codes?.operations || e.message;
        console.log(`❌ [${name}] Submission failed: ${errMsg}`);
      }

      statusMap[name] = true;
    }
  }
}

function checkTime() {
  const now = new Date();
  const [h, m, s] = [now.getHours(), now.getMinutes(), now.getSeconds()];

  const first = bots[0];
  if (
    parseInt(first.hour) === h &&
    parseInt(first.minute) === m &&
    parseInt(first.second) === s &&
    !alreadyTriggeredToday
  ) {
    console.log(`🕓 Time matched for [${first.name}] — submitting all transactions...`);
    alreadyTriggeredToday = true;
    submitAll();
  }

  if (h === 0 && m === 0 && s === 0) {
    alreadyTriggeredToday = false;
    Object.keys(statusMap).forEach(k => (statusMap[k] = false));
    console.log('🔁 Daily reset of statusMap done.');
  }
}

app.get('/', (req, res) => {
  res.send('🟢 Multi-bot is running. Bots: ' + Object.keys(statusMap).join(', '));
});

app.listen(PORT, async () => {
  console.log(`🌐 Server is listening on port ${PORT}`);
  console.log('⏳ Preparing transactions...');
  await prepareTransactions();
  console.log('✅ All transactions prepared.');
  setInterval(checkTime, 1000);
});
