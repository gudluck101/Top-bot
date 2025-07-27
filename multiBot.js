const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Convert time to UTC ms
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      if (attempt > 1) await new Promise(res => setTimeout(res, 400));

      // Load fresh account + sequence each time
      const accountData = await server.loadAccount(bot.public);
      const account = new StellarSdk.Account(bot.public, accountData.sequence);

      const baseFeePi = parseFloat(bot.baseFeePi || "0.005");
      const baseFeeStroops = Math.floor(baseFeePi * 1e7);

      const txBuilder = new StellarSdk.TransactionBuilder(account, {
        fee: (baseFeeStroops * 2).toString(),
        networkPassphrase: 'Pi Network',
      });

      // Always attempt claim + send
      txBuilder.addOperation(StellarSdk.Operation.claimClaimableBalance({
        balanceId: bot.claimId,
      }));

      txBuilder.addOperation(StellarSdk.Operation.payment({
        destination: bot.destination,
        asset: StellarSdk.Asset.native(),
        amount: bot.amount,
      }));

      const tx = txBuilder.setTimeout(60).build();
      tx.sign(botKey);

      const result = await server.submitTransaction(tx);

      if (result?.successful && result?.hash) {
        console.log(`✅ [${bot.name}] TX Success (attempt ${attempt})! Hash: ${result.hash}`);
        break;
      } else {
        console.log(`❌ [${bot.name}] TX not successful (attempt ${attempt})`);
      }

    } catch (e) {
      console.log(`❌ [${bot.name}] Attempt ${attempt} failed.`);
      if (e?.response?.data?.extras?.result_codes) {
        console.log('🔍 result_codes:', e.response.data.extras.result_codes);
      } else if (e?.response?.data) {
        console.log('🔍 Horizon error:', e.response.data);
      } else if (e?.response) {
        console.log('🔍 Response error:', e.response);
      } else {
        console.log('🔍 Raw error:', e.message || e.toString());
      }
    }
  }

  console.log(`🔁 [${bot.name}] Completed 10 attempts.`);
}

// Ledger streaming trigger
function streamAndTrigger(bot) {
  const unlockTimeMs = getBotTimestamp(bot);
  const triggerTime = unlockTimeMs - 6000; // 6 seconds before unlock

  server.ledgers().cursor('now').stream({
    onmessage: async () => {
      const now = new Date();
      const nowMs = now.getUTCHours() * 3600000 +
                    now.getUTCMinutes() * 60000 +
                    now.getUTCSeconds() * 1000 +
                    now.getUTCMilliseconds();

      if (nowMs >= triggerTime && nowMs <= unlockTimeMs) {
        console.log(`📟 Ledger seen at ${now.toISOString()}. Submitting TX for ${bot.name}...`);
        await new Promise(res => setTimeout(res, 200)); // wait for ledger to be active
        await send(bot);
      }
    },
    onerror: (err) => {
      console.error(`🔴 Ledger stream error for ${bot.name}:`, err.message || err);
    }
  });
}

// Start monitoring ledgers for all bots
function watchBots() {
  for (const bot of bots) {
    console.log(`👀 Watching ${bot.name} for unlock...`);
    streamAndTrigger(bot);
  }
}

// Web UI to monitor status
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('🟢 Bot is watching ledger stream...');
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
  watchBots();
});
