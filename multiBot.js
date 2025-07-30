const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

const executedMap = {}; // track submissions per bot

function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

async function submitTransaction(bot) {
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
      console.log(`✅ [${bot.name}] TX Success! Hash: ${result.hash}`);
      return true;
    } else {
      console.log(`❌ [${bot.name}] TX failed, retrying...`);
      return false;
    }

  } catch (e) {
    console.log(`❌ [${bot.name}] Error during submission.`);
    if (e?.response?.data?.extras?.result_codes) {
      console.log('🔍 result_codes:', e.response.data.extras.result_codes);
    } else {
      console.log('🔍 Error:', e.message || e.toString());
    }
    return false;
  }
}

function monitorAndSubmit(bot) {
  const targetMs = getBotTimestamp(bot);
  executedMap[bot.name] = false;

  server.ledgers().cursor('now').stream({
    onmessage: async (ledger) => {
      const now = new Date();
      const nowMs =
        now.getUTCHours() * 3600000 +
        now.getUTCMinutes() * 60000 +
        now.getUTCSeconds() * 1000 +
        now.getUTCMilliseconds();

      const diff = targetMs - nowMs;

      if (diff <= 10000 && diff >= -1000) {
        if (!executedMap[bot.name]) {
          console.log(`🚀 [${bot.name}] Submitting ~${diff}ms from unlock`);
          executedMap[bot.name] = true;
          let success = await submitTransaction(bot);

          // Retry loop
          while (!success) {
            console.log(`🔁 [${bot.name}] Retrying TX on next ledger...`);
            await new Promise(res => setTimeout(res, 2000)); // small delay
            success = await submitTransaction(bot);
          }
        }
      }

      // Reset at UTC midnight
      if (nowMs < 1000) {
        executedMap[bot.name] = false;
        console.log(`🔁 New UTC day. Resetting for [${bot.name}]`);
      }
    }
  });
}

// Start monitoring all bots
for (const bot of bots) {
  monitorAndSubmit(bot);
}

// Optional: Web UI
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('🟢 Claim bot active. Submissions tracked.');
});

app.listen(PORT, () => {
  console.log(`🌐 Web server running at http://localhost:${PORT}`);
});
