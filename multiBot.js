const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Convert scheduled time to Unix seconds (UTC)
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600 +
    parseInt(bot.minute) * 60 +
    parseInt(bot.second) +
    (parseInt(bot.millisecond || 0) / 1000)
  );
}

// Create and submit time-bounded transaction
async function sendWithTimeBounds(bot) {
  try {
    const botKey = StellarSdk.Keypair.fromSecret(bot.secret);
    const accountData = await server.loadAccount(bot.public);
    const account = new StellarSdk.Account(bot.public, accountData.sequence);

    const baseFeePi = parseFloat(bot.baseFeePi || "0.005");
    const baseFeeStroops = Math.floor(baseFeePi * 1e7);

    // Get bot's intended time in seconds (UTC)
    const botTimestamp = getBotTimestamp(bot);  // e.g. 36000 = 10:00:00
    const minTime = Math.floor(botTimestamp);
    const maxTime = minTime + 10; // 10-second valid window

    const txBuilder = new StellarSdk.TransactionBuilder(account, {
      fee: baseFeeStroops.toString(),
      networkPassphrase: 'Pi Network',
      timebounds: {
        minTime: minTime.toString(),
        maxTime: maxTime.toString(),
      }
    });

    // Add claim operation (optional)
    if (bot.claimId) {
      txBuilder.addOperation(StellarSdk.Operation.claimClaimableBalance({
        balanceId: bot.claimId
      }));
    }

    // Add payment operation
    txBuilder.addOperation(StellarSdk.Operation.payment({
      destination: bot.destination,
      asset: StellarSdk.Asset.native(),
      amount: bot.amount,
    }));

    const tx = txBuilder.build();
    tx.sign(botKey);

    console.log(`📤 [${bot.name}] Submitting TX with time bounds: ${minTime} - ${maxTime}`);
    const result = await server.submitTransaction(tx);

    if (result.successful && result.hash) {
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

// Submit all bots immediately
async function submitAll() {
  for (const bot of bots) {
    console.log(`🚀 Submitting for ${bot.name}...`);
    await sendWithTimeBounds(bot);
  }
}

// Run once at startup
submitAll();

// Web UI (optional)
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send(`🟢 Time-bound TXs submitted.`);
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
