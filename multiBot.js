const fs = require('fs');
const path = require('path');
const express = require('express');
const StellarSdk = require('@stellar/stellar-sdk');

const app = express();
const PORT = process.env.PORT || 3000;
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Load bots from bot.json
const bots = JSON.parse(fs.readFileSync(path.join(__dirname, 'bot.json'), 'utf-8'));

const botStates = {};

// Initialize bot states
bots.forEach(bot => {
  botStates[bot.name] = {
    prepared: false,
    done: false,
    claimables: [],
    tx: null,
    lastPrepareTime: null
  };
});

async function prepareTransaction(bot) {
  const state = botStates[bot.name];

  try {
    const keypair = StellarSdk.Keypair.fromSecret(bot.secret);
    const account = await server.loadAccount(bot.public);
    const balances = await server.claimableBalances().claimant(bot.public).call();

    const claimables = balances.records.map(r => r.id);
    state.claimables = claimables;

    if (claimables.length === 0) {
      console.log(`⚠️  [${bot.name}] No claimable balances.`);
      return;
    }

    const fee = await server.fetchBaseFee();
    const txBuilder = new StellarSdk.TransactionBuilder(account, {
      fee: fee.toString(),
      networkPassphrase: 'Pi Network'
    });

    claimables.forEach(id => {
      txBuilder.addOperation(StellarSdk.Operation.claimClaimableBalance({ balanceId: id }));
    });

    const tx = txBuilder.setTimeout(60).build();
    tx.sign(keypair);

    state.tx = tx;
    state.prepared = true;
    state.done = false;
    state.lastPrepareTime = new Date();

    console.log(`🔐 [${bot.name}] Prepared ${claimables.length} claimables.`);
  } catch (e) {
    console.error(`❌ [${bot.name}] Prepare failed: ${e.message}`);
  }
}

async function submitTransaction(bot) {
  const state = botStates[bot.name];

  if (!state.tx || state.done) return;

  try {
    const result = await server.submitTransaction(state.tx);
    console.log(`✅ [${bot.name}] Claimed ${state.claimables.length} | TX: ${result.hash}`);
  } catch (e) {
    const msg = e?.response?.data?.extras?.result_codes?.operations ||
      e?.response?.data?.extras?.result_codes?.transaction ||
      e.message;
    console.error(`❌ [${bot.name}] Claim failed: ${msg}`);
  }

  state.done = true;
  state.prepared = false;
  state.tx = null;
}

function getNigeriaTime() {
  const now = new Date();
  now.setUTCHours(now.getUTCHours() + 1); // Nigeria is UTC+1
  return now;
}

// Main interval loop
setInterval(() => {
  const now = getNigeriaTime();

  bots.forEach(bot => {
    const state = botStates[bot.name];

    const target = new Date(now);
    target.setHours(bot.hour, bot.minute, bot.second, bot.millisecond);

    const timeDiff = target - now;

    // ⏱ Prepare transaction ~15 sec ahead of time
    if (!state.prepared && timeDiff > 0 && timeDiff < 15000) {
      prepareTransaction(bot);
    }

    // 🚀 Submit transaction at exact time
    if (
      !state.done &&
      state.prepared &&
      now.getHours() === bot.hour &&
      now.getMinutes() === bot.minute &&
      now.getSeconds() === bot.second &&
      now.getMilliseconds() >= bot.millisecond
    ) {
      console.log(`🕒 [${bot.name}] Submitting transaction.`);
      submitTransaction(bot);
    }
  });
}, 500); // 0.5s loop for more accurate timing

// Health check route for Render
app.get('/', (_, res) => {
  res.send('🟢 Pi Claim Bot is running.');
});

app.listen(PORT, () => {
  console.log(`🌐 Listening on port ${PORT}`);
});
