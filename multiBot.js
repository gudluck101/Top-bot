const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Convert bot time to Unix timestamp (in seconds)
function getUnlockUnix(bot) {
  const now = new Date();
  const date = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const hh = String(bot.hour).padStart(2, '0');
  const mm = String(bot.minute).padStart(2, '0');
  const ss = String(bot.second).padStart(2, '0');
  const fullTime = new Date(`${date}T${hh}:${mm}:${ss}Z`);
  return Math.floor(fullTime.getTime() / 1000);
}

// Build and submit 4 time-bound transactions
async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);
  const accountData = await server.loadAccount(bot.public);

  const baseFeePi = parseFloat(bot.baseFeePi || "0.005");
  const baseFeeStroops = Math.floor(baseFeePi * 1e7);

  const unlockUnix = getUnlockUnix(bot);
  const submitUnix = unlockUnix - 10; // Submit 10 seconds early
  const maxTime = unlockUnix + 60;    // 1-minute execution window

  const nowUnix = Math.floor(Date.now() / 1000);
  const delay = (submitUnix - nowUnix) * 1000;

  console.log(`⏳ Waiting ${Math.max(0, delay / 1000)}s to submit... (${bot.name})`);

  if (delay > 0) await new Promise(res => setTimeout(res, delay));

  for (let i = 0; i < 4; i++) {
    try {
      const sequence = BigInt(accountData.sequence) + BigInt(i + 1);
      const account = new StellarSdk.Account(bot.public, sequence.toString());

      const txBuilder = new StellarSdk.TransactionBuilder(account, {
        fee: (baseFeeStroops * 2).toString(),
        networkPassphrase: 'Pi Network',
        timebounds: {
          minTime: unlockUnix.toString(),
          maxTime: maxTime.toString()
        }
      });

      // Add operations: claim + send
      txBuilder.addOperation(StellarSdk.Operation.claimClaimableBalance({
        balanceId: bot.claimId
      }));
      txBuilder.addOperation(StellarSdk.Operation.payment({
        destination: bot.destination,
        asset: StellarSdk.Asset.native(),
        amount: bot.amount
      }));

      // NO .setTimeout() here
      const tx = txBuilder.build();
      tx.sign(botKey);

      const result = await server.submitTransaction(tx);
      if (result?.successful && result?.hash) {
        console.log(`✅ TX #${i + 1} SUCCESS (${bot.name}) — Hash: ${result.hash}`);
      } else {
        console.log(`⚠️ TX #${i + 1} submitted but not successful (${bot.name})`);
      }

    } catch (e) {
      console.log(`❌ TX #${i + 1} failed (${bot.name})`);
      if (e?.response?.data?.extras?.result_codes) {
        console.log('🔍 result_codes:', e.response.data.extras.result_codes);
      } else if (e?.response?.data) {
        console.log('🔍 Horizon error:', e.response.data);
      } else {
        console.log('🔍 Raw error:', e.message || e.toString());
      }
    }
  }
}

// Run all bots in sequence
async function runBots() {
  for (const bot of bots) {
    console.log(`🚀 Running bot: ${bot.name}`);
    await send(bot);
  }
}

// Express Web UI
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('🟢 Time-bounded bot is active.');
});

app.listen(PORT, () => {
  console.log(`🌍 Web server running at http://localhost:${PORT}`);
});

// Start execution
runBots();
