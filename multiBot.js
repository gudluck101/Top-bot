const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Convert bot trigger time to UTC ms
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Submit transaction for 1 bot
async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);
  let attempts = 0;
  let lastErrorWasBadSeq = false;

  while (attempts < 10) {
    try {
      if (attempts > 0 && !lastErrorWasBadSeq) {
        console.log(`🔄 [${bot.name}] Waiting for next ledger...`);
        await waitForNextLedger();
      }

      const accountData = await server.loadAccount(bot.public);
      const account = new StellarSdk.Account(bot.public, accountData.sequence);

      const baseFeePi = parseFloat(bot.baseFeePi || "0.005");
      const baseFeeStroops = Math.floor(baseFeePi * 1e7);

      const txBuilder = new StellarSdk.TransactionBuilder(account, {
        fee: (baseFeeStroops * 2).toString(),
        networkPassphrase: 'Pi Network',
      });

      if (attempts === 0) {
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
      } else {
        console.log(`❌ [${bot.name}] TX failed (unknown reason)`);
      }

    } catch (e) {
      attempts++;
      lastErrorWasBadSeq = false;

      const errCodes = e?.response?.data?.extras?.result_codes || {};
      console.log(`❌ [${bot.name}] Attempt ${attempts} failed.`);

      if (Object.keys(errCodes).length > 0) {
        console.log('🔍 result_codes:', errCodes);
        if (errCodes.transaction === 'tx_bad_seq') {
          console.log('⚠️ Retrying immediately due to tx_bad_seq...');
          lastErrorWasBadSeq = true;
        }
      } else {
        console.log('🔍 Error:', e.message || e.toString());
      }
    }
  }

  console.log(`⛔ [${bot.name}] All 10 attempts failed.`);
}

// Wait until the next ledger opens
let lastLedger = 0;
async function waitForNextLedger() {
  while (true) {
    try {
      const ledger = await server.ledgers().order('desc').limit(1).call();
      const currentLedger = parseInt(ledger.records[0].sequence);
      if (currentLedger > lastLedger) {
        lastLedger = currentLedger;
        return;
      }
    } catch (e) {
      console.log("⚠️ Ledger check failed while waiting:", e.message || e.toString());
    }
    await new Promise(res => setTimeout(res, 1000));
  }
}

// Sequentially run bots
async function runBotsSequentially() {
  for (const bot of bots) {
    console.log(`🚀 Running ${bot.name}...`);
    await send(bot);
  }
}

// Time-triggered ledger watcher
let executed = false;

setInterval(async () => {
  try {
    const ledger = await server.ledgers().order('desc').limit(1).call();
    const currentLedger = parseInt(ledger.records[0].sequence);
    const now = new Date();
    const nowMs = now.getUTCHours() * 3600000 +
                  now.getUTCMinutes() * 60000 +
                  now.getUTCSeconds() * 1000 +
                  now.getUTCMilliseconds();

    const firstBot = bots[0];
    const botTimeMs = getBotTimestamp(firstBot);
    const diff = botTimeMs - nowMs;

    if (currentLedger > lastLedger) {
      lastLedger = currentLedger;
      if (!executed && diff >= 0 && diff <= 5000) {
        console.log(`⏰ Ledger ${currentLedger} matched unlock window for ${firstBot.name}. Executing...`);
        executed = true;
        await runBotsSequentially();
      }
    }

    if (nowMs < 1000) {
      executed = false;
      console.log("🔁 New UTC day — reset.");
    }
  } catch (e) {
    console.log("⚠️ Ledger polling error:", e.message || e.toString());
  }
}, 1000);

// Web UI to monitor
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send(`🟢 Bot status: Triggered = ${executed}`);
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
