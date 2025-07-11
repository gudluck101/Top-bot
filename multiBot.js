const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

const app = express();
const PORT = process.env.PORT || 10000;

let executed = {}; // Track which bots have completed

// Convert bot unlock time to UTC milliseconds
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Get current UTC time in ms
function getNowMs() {
  const now = new Date();
  return (
    now.getUTCHours() * 3600000 +
    now.getUTCMinutes() * 60000 +
    now.getUTCSeconds() * 1000 +
    now.getUTCMilliseconds()
  );
}

// Submit transaction logic
async function sendTx(bot) {
  try {
    const botKey = StellarSdk.Keypair.fromSecret(bot.secret);
    const accountData = await server.loadAccount(bot.public);
    const account = new StellarSdk.Account(bot.public, accountData.sequence);

    const baseFeeStroops = Math.floor(parseFloat(bot.baseFeePi || "0.005") * 1e7);

    const txBuilder = new StellarSdk.TransactionBuilder(account, {
      fee: (baseFeeStroops * 2).toString(),
      networkPassphrase: 'Pi Network',
    });

    if (!executed[bot.name]) {
      txBuilder.addOperation(StellarSdk.Operation.claimClaimableBalance({
        balanceId: bot.claimId,
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

    if (result?.successful) {
      console.log(`✅ [${bot.name}] TX Success! Hash: ${result.hash}`);
      executed[bot.name] = true;
    } else {
      console.log(`❌ [${bot.name}] TX failed`);
    }

  } catch (e) {
    const errCodes = e?.response?.data?.extras?.result_codes;
    if (errCodes?.transaction === 'tx_bad_seq') {
      console.log(`⏭️ [${bot.name}] Bad sequence – retry next ledger`);
      // Retry next ledger
    } else {
      console.log(`❌ [${bot.name}] Permanent error – skip for now`);
      executed[bot.name] = true;
    }

    if (e?.response?.data) {
      console.log('🔍 Horizon error detail:', e.response.data);
    } else {
      console.log('🔍 Raw error:', e.message || e.toString());
    }
  }
}

// Stream ledger and trigger bots
server.ledgers()
  .cursor('now')
  .stream({
    onmessage: async () => {
      const nowMs = getNowMs();

      for (const bot of bots) {
        const botTime = getBotTimestamp(bot);
        const diff = botTime - nowMs;

        if (!executed[bot.name] && diff >= 0 && diff <= 5000) {
          console.log(`⏳ [${bot.name}] Unlocking in ${diff}ms – trying transaction...`);
          await sendTx(bot);
        }
      }

      // Reset bots at new UTC day
      if (nowMs < 1000) {
        executed = {};
        console.log("🔁 New UTC day — bot states reset.");
      }
    },
    onerror: (err) => {
      console.log('⚠️ Ledger stream error:', err);
    }
  });

// Web UI to check status
app.get('/', (req, res) => {
  res.send(`🟢 Bot Status: ${JSON.stringify(executed)}`);
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
