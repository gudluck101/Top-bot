const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

let bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

const app = express();
const PORT = process.env.PORT || 10000;

// Reload bots (for ON/OFF toggle)
function reloadBots() {
  bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
}

// Main bot logic with infinite retry, fresh sequence & re-build
async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);
  let attempt = 0;

  while (true) {
    reloadBots();
    const currentBot = bots.find(b => b.name === bot.name);

    if (!currentBot || !currentBot.on) {
      console.log(`🛑 [${bot.name}] Bot is OFF. Exiting.`);
      return;
    }

    attempt++;
    console.log(`🔄 [${bot.name}] Attempt ${attempt}...`);

    try {
      const accountData = await server.loadAccount(bot.public);
      const account = new StellarSdk.Account(bot.public, accountData.sequence);

      const baseFeePi = parseFloat(bot.baseFeePi || "0.005");
      const baseFeeStroops = Math.floor(baseFeePi * 1e7);

      const txBuilder = new StellarSdk.TransactionBuilder(account, {
        fee: (baseFeeStroops * 2).toString(),
        networkPassphrase: 'Pi Network',
      });

      // Always try claim + send
      txBuilder.addOperation(StellarSdk.Operation.claimClaimableBalance({
        balanceId: bot.claimId
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
        console.log(`✅ [${bot.name}] TX Success! Hash: ${result.hash}`);
        return; // stop retries
      } else {
        console.log(`❌ [${bot.name}] TX failed. No success response.`);
      }

    } catch (e) {
      console.log(`❌ [${bot.name}] Attempt ${attempt} failed.`);

      if (e?.response?.data?.extras?.result_codes) {
        console.log('🔍 result_codes:', e.response.data.extras.result_codes);
      } else if (e?.response?.data) {
        console.log('🔍 Horizon error:', e.response.data);
      } else {
        console.log('🔍 Error:', e.message || e.toString());
      }
    }

    await new Promise(res => setTimeout(res, 300)); // 1s between retries
  }
}

// Start all bots marked as "on"
function runActiveBots() {
  reloadBots();
  for (const bot of bots) {
    if (bot.on) {
      console.log(`🚀 Starting bot: ${bot.name}`);
      send(bot);
    } else {
      console.log(`⏸️ Skipping bot: ${bot.name} (OFF)`);
    }
  }
}

// Immediately run bots when script starts
runActiveBots();

// Web interface
app.get('/', (req, res) => {
  reloadBots();
  const active = bots.filter(b => b.on).map(b => b.name);
  res.send(`🟢 Running bots: ${active.join(', ') || 'None'}`);
});

app.get('/reload', (req, res) => {
  reloadBots();
  res.send('🔄 Reloaded bot.json');
});

app.listen(PORT, () => {
  console.log(`🌍 Web monitor at http://localhost:${PORT}`);
});
