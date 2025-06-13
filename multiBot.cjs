const fs = require('fs');
const path = require('path');
const express = require('express');
const StellarSdk = require('@stellar/stellar-sdk');
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// ✅ Adjust paths for Render (write logs to /tmp)
const BOT_FILE = path.join(__dirname, 'bot.json');
const SUCCESS_LOG = '/tmp/success.log';
const FAIL_LOG = '/tmp/fail.log';

const bots = JSON.parse(fs.readFileSync(BOT_FILE, 'utf-8'));

const botStates = {};

bots.forEach(bot => {
  botStates[bot.name] = {
    prepared: false,
    done: false,
    claimables: [],
    claimTx: null,
    resetToday: false,
  };
});

function logSuccess(botName, hash, count) {
  const log = `[${new Date().toISOString()}] ✅ [${botName}] Claimed ${count} | TX: ${hash}\n`;
  fs.appendFileSync(SUCCESS_LOG, log);
}

function logFailure(botName, reason) {
  const log = `[${new Date().toISOString()}] ❌ [${botName}] Claim failed: ${reason}\n`;
  fs.appendFileSync(FAIL_LOG, log);
}

async function prepare(bot) {
  const state = botStates[bot.name];
  try {
    const keypair = StellarSdk.Keypair.fromSecret(bot.secret);
    const account = await server.loadAccount(bot.public);
    const balances = await server.claimableBalances().claimant(bot.public).call();

    state.claimables = balances.records.map(r => r.id);
    const fee = await server.fetchBaseFee();

    const txBuilder = new StellarSdk.TransactionBuilder(account, {
      fee: fee.toString(),
      networkPassphrase: 'Pi Network',
    });

    for (const id of state.claimables) {
      txBuilder.addOperation(
        StellarSdk.Operation.claimClaimableBalance({ balanceId: id })
      );
    }

    state.claimTx = state.claimables.length > 0 ? txBuilder.setTimeout(60).build() : null;

    if (state.claimTx) {
      state.claimTx.sign(keypair);
      console.log(`🔐 [${bot.name}] Prepared TX for ${state.claimables.length} claimables.`);
    } else {
      console.log(`⚠️ [${bot.name}] No claimable balances found.`);
    }

    state.prepared = true;
  } catch (e) {
    console.log(`❌ [${bot.name}] Prepare failed: ${e.message}`);
    logFailure(bot.name, `Prepare failed: ${e.message}`);
  }
}

async function submitClaim(bot) {
  const state = botStates[bot.name];
  if (state.done || !state.claimTx) {
    console.log(`⚠️ [${bot.name}] No TX to submit.`);
    state.done = true;
    return;
  }

  try {
    const res = await server.submitTransaction(state.claimTx);
    console.log(`✅ [${bot.name}] Claimed ${state.claimables.length} | TX: ${res.hash}`);
    logSuccess(bot.name, res.hash, state.claimables.length);
  } catch (e) {
    const msg =
      e?.response?.data?.extras?.result_codes?.operations ||
      e?.response?.data?.extras?.result_codes?.transaction ||
      e.message;
    console.log(`❌ [${bot.name}] Claim failed: ${msg}`);
    logFailure(bot.name, msg);
  }

  state.done = true;
}

// ⏱️ Run the loop every second
setInterval(() => {
  const now = new Date();
  const h = (now.getUTCHours() + 1) % 24;
  const m = now.getUTCMinutes();
  const s = now.getUTCSeconds();

  bots.forEach(bot => {
    const bh = parseInt(bot.hour);
    const bm = parseInt(bot.minute);
    const bs = parseInt(bot.second);
    const state = botStates[bot.name];

    if (!state.resetToday && h === 0 && m === 0 && s < 2) {
      Object.assign(state, {
        prepared: false,
        done: false,
        claimables: [],
        claimTx: null,
        resetToday: true,
      });
      console.log(`🔁 [${bot.name}] Daily reset.`);
      prepare(bot);
    }

    if (h > 0 && state.resetToday) {
      state.resetToday = false;
    }

    if (
      !state.prepared &&
      (h > bh || (h === bh && m > bm) || (h === bh && m === bm && s >= bs - 10))
    ) {
      prepare(bot);
    }

    if (
      h === bh &&
      m === bm &&
      s === bs &&
      state.prepared &&
      !state.done
    ) {
      console.log(`🕓 [${bot.name}] Submitting claim.`);
      submitClaim(bot);
    }
  });
}, 1000);

// ✅ Express server for Render health check
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('🟢 Pi Claim Bot is running.\n');
});

app.listen(PORT, () => {
  console.log(`🌐 Listening on port ${PORT}`);
});
