const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const feeWallet = JSON.parse(fs.readFileSync('fee-wallet.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

let executed = false;

// Get UTC timestamp in ms
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Send transaction using fee bump
async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);
  const feeKey = StellarSdk.Keypair.fromSecret(feeWallet.secret);

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      if (attempt > 1) await new Promise(res => setTimeout(res, 400));

      const botAccountData = await server.loadAccount(bot.public);
      const botAccount = new StellarSdk.Account(bot.public, botAccountData.sequence);

      const baseFeePi = parseFloat(feeWallet.baseFeePi || "0.00005");
      const baseFeeStroops = Math.floor(baseFeePi * 1e7); // Pi → stroops

      // Build inner transaction from bot
      const innerTx = new StellarSdk.TransactionBuilder(botAccount, {
        fee: (baseFeeStroops * 2).toString(),
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

      innerTx.sign(botKey); // Bot signs its part

      // Wrap with fee bump transaction paid by feeWallet
      const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
        feeKey, // fee payer
        baseFeeStroops.toString(), // per operation fee
        innerTx,
        'Pi Network'
      );

      const result = await server.submitTransaction(feeBumpTx);

      if (result?.successful && result?.hash) {
        console.log(`✅ [${bot.name}] TX Success! Hash: ${result.hash}`);
        return;
      } else {
        throw new Error('TX not successful');
      }

    } catch (e) {
      console.log(`❌ [${bot.name}] Attempt ${attempt} failed.`);
      if (e?.response?.data?.extras?.result_codes) {
        console.log('🔍 result_codes:', e.response.data.extras.result_codes);
      } else if (e?.response?.data) {
        console.log('🔍 Horizon error:', e.response.data);
      } else {
        console.log('🔍 Raw error:', e.message || e.toString());
      }
    }
  }

  console.log(`⛔ [${bot.name}] All 10 attempts failed.`);
}

// Run all bots one-by-one
async function runBotsSequentially() {
  for (const bot of bots) {
    console.log(`🚀 Running ${bot.name}...`);
    await send(bot);
  }
}

// Time trigger
setInterval(() => {
  const now = new Date();
  const nowMs =
    now.getUTCHours() * 3600000 +
    now.getUTCMinutes() * 60000 +
    now.getUTCSeconds() * 1000 +
    now.getUTCMilliseconds();

  const firstBot = bots[0];
  const botTimeMs = getBotTimestamp(firstBot);
  const diff = Math.abs(nowMs - botTimeMs);

  if (!executed && diff <= 200) {
    console.log(`⏰ Time matched for ${firstBot.name}. Starting...`);
    executed = true;
    runBotsSequentially();
  }

  if (nowMs < 1000) {
    executed = false;
    console.log("🔁 New UTC day — reset.");
  }
}, 100);

// Web interface
const app = express();
const PORT = process.env.PORT || 10000;
app.get('/', (req, res) => {
  res.send(`🟢 Bot status: Triggered = ${executed}`);
});
app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
