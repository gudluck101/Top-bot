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

// Send transaction once with no retry
async function send(bot) {
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
    } else {
      console.log(`❌ [${bot.name}] TX not successful`);
    }

  } catch (e) {
    console.log(`❌ [${bot.name}] Submission failed.`);
    if (e?.response?.data?.extras?.result_codes) {
      console.log('🔍 result_codes:', e.response.data.extras.result_codes);
    } else {
      console.log('🔍 Error:', e.message || e.toString());
    }
  }
}

let executed = false;

// Monitor ledger and submit 5 seconds before unlock
async function monitorLedgerAndSubmit(bot) {
  console.log(`⏳ Waiting for unlock time: ${bot.hour}:${bot.minute}:${bot.second} UTC`);
  const targetMs = getBotTimestamp(bot);

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

      if (!executed && diff <= 5000 && diff >= 0) {
        console.log(`🚀 [${bot.name}] Submitting TX ${diff}ms before unlock...`);
        executed = true;
        await send(bot);
      }

      if (nowMs < 1000) {
        executed = false;
        console.log("🔁 New UTC day — reset.");
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
  res.send(`🟢 Watching ledger. Triggered: ${executed}`);
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
