const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Convert bot unlock time to UTC milliseconds
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Send a single transaction using freshly loaded sequence
async function send(bot, attempt) {
  try {
    const botKey = StellarSdk.Keypair.fromSecret(bot.secret);
    const accountData = await server.loadAccount(bot.public);
    const account = new StellarSdk.Account(bot.public, accountData.sequence);

    const baseFeePi = parseFloat(bot.baseFeePi || "0.005");
    const baseFeeStroops = Math.floor(baseFeePi * 1e7);

    const txBuilder = new StellarSdk.TransactionBuilder(account, {
      fee: (baseFeeStroops * 2).toString(),
      networkPassphrase: 'Pi Network',
    });

    if (bot.claimId) {
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
      console.log(`✅ [${bot.name}] TX Success [Attempt ${attempt}] — Hash: ${result.hash}`);
    } else {
      console.log(`⚠️ [${bot.name}] TX not successful [Attempt ${attempt}]`);
    }
  } catch (e) {
    console.log(`❌ [${bot.name}] Submission failed [Attempt ${attempt}]`);
    if (e?.response?.data?.extras?.result_codes) {
      console.log('🔍 result_codes:', e.response.data.extras.result_codes);
    } else {
      console.log('🔍 Error:', e.message || e.toString());
    }
  }
}

// Monitor ledger and submit up to 5 retries
async function monitorLedgerAndSubmit(bot) {
  console.log(`⏳ Waiting for unlock time: ${bot.hour}:${bot.minute}:${bot.second} UTC`);
  const targetMs = getBotTimestamp(bot);
  let attempt = 0;

  server.ledgers().cursor('now').stream({
    onmessage: async (ledger) => {
      const now = new Date();
      const nowMs =
        now.getUTCHours() * 3600000 +
        now.getUTCMinutes() * 60000 +
        now.getUTCSeconds() * 1000 +
        now.getUTCMilliseconds();

      const diff = targetMs - nowMs; // how far we are from unlock time

      console.log(`📡 Ledger closed at ${now.toISOString()} | ⏱ Unlock in ${diff} ms`);

      if (diff <= 5000 && diff >= -3000 && attempt < 5) {
        attempt++;
        console.log(`🚀 [${bot.name}] Attempting TX #${attempt} (${diff}ms from unlock)`);
        await send(bot, attempt);
      }

      if (attempt >= 5) {
        console.log(`✅ [${bot.name}] Max attempts reached. Stopping retries.`);
      }
    }
  });
}

// Start watching the first bot
monitorLedgerAndSubmit(bots[0]);

// Optional Web UI
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send(`🟢 Watching ledger. Bot running. Up to 5 attempts max.`);
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
