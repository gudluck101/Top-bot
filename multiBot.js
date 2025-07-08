const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

const sequences = {}; // Stores latest sequence numbers
const executed = {};  // Tracks whether each bot has executed

const app = express();
const PORT = process.env.PORT || 10000;

// Get bot unlock time in UTC milliseconds
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Fetch and update account sequence
async function refreshAccountSequence(bot) {
  try {
    const account = await server.loadAccount(bot.public);
    sequences[bot.public] = account.sequence;
    console.log(`📥 [${bot.name}] Polled sequence: ${account.sequence}`);
  } catch (err) {
    console.error(`⚠️ [${bot.name}] Failed to poll sequence:`, err.message);
  }
}

// Main bot transaction with retry logic
async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);
  let retryCount = 0;

  const attemptTx = async () => {
    try {
      const sequence = sequences[bot.public];
      if (!sequence) throw new Error('No sequence available');

      const account = new StellarSdk.Account(bot.public, sequence);
      const baseFee = Math.floor((parseFloat(bot.baseFeePi || "0.005")) * 1e7);

      const txBuilder = new StellarSdk.TransactionBuilder(account, {
        fee: (baseFee * 2).toString(),
        networkPassphrase: 'Pi Network',
      });

      if (retryCount === 0 && bot.claimId) {
        txBuilder.addOperation(StellarSdk.Operation.claimClaimableBalance({
          balanceId: bot.claimId
        }));
      }

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
      }

      throw new Error('TX failed without exception');

    } catch (e) {
      const resultCode = e?.response?.data?.extras?.result_codes?.transaction;

      if (resultCode === 'tx_bad_seq') {
        console.log(`⚠️ [${bot.name}] tx_bad_seq → refreshing & retrying...`);
        await refreshAccountSequence(bot);
        retryCount++;
        if (retryCount <= 3) return attemptTx();
      } else {
        console.log(`❌ [${bot.name}] TX Error:`, e.message || e.toString());
        if (retryCount < 3) {
          retryCount++;
          setTimeout(() => attemptTx(), 1500); // Retry after next ledger
        }
      }
    }

    if (retryCount >= 3) {
      console.log(`⛔ [${bot.name}] Max retries reached.`);
    }
  };

  attemptTx();
}

// Check if it's time to trigger bots
setInterval(() => {
  const now = new Date();
  const nowMs =
    now.getUTCHours() * 3600000 +
    now.getUTCMinutes() * 60000 +
    now.getUTCSeconds() * 1000 +
    now.getUTCMilliseconds();

  bots.forEach(bot => {
    const botTimeMs = getBotTimestamp(bot);
    const diff = botTimeMs - nowMs;

    if (!executed[bot.name] && diff >= 0 && diff <= 5000) {
      console.log(`⏰ [${bot.name}] Unlock time matched. Executing...`);
      executed[bot.name] = true;
      send(bot);
    }
  });

  if (nowMs < 1000) {
    bots.forEach(bot => executed[bot.name] = false);
    console.log('🔄 New UTC day — reset executed flags');
  }
}, 1000); // Every second

// Poll sequences every second
setInterval(() => {
  bots.forEach(bot => refreshAccountSequence(bot));
}, 1000);

// Initial setup
bots.forEach(bot => {
  executed[bot.name] = false;
  refreshAccountSequence(bot);
});

// Web status
app.get('/', (req, res) => {
  res.send(`🟢 Bot status: ${JSON.stringify(executed)}`);
});

app.get('/sequences', (req, res) => {
  const result = bots.map(bot => ({
    name: bot.name,
    public: bot.public,
    sequence: sequences[bot.public] || '⏳ Waiting...',
  }));
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
