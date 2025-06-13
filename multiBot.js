const fs = require('fs');
const http = require('http');
const StellarSdk = require('@stellar/stellar-sdk');

const server = new StellarSdk.Server('https://api.mainnet.minepi.com');
const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));

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
  fs.appendFileSync('success.log', log);
}

function logFailure(botName, reason) {
  const log = `[${new Date().toISOString()}] ❌ [${botName}] Claim failed: ${reason}\n`;
  fs.appendFileSync('fail.log', log);
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
      fee,
      networkPassphrase: 'Pi Network',
    });

    state.claimables.forEach(id => {
      txBuilder.addOperation(
        StellarSdk.Operation.claimClaimableBalance({ balanceId: id })
      );
    });

    state.claimTx = state.claimables.length > 0 ? txBuilder.setTimeout(60).build() : null;
    if (state.claimTx) {
      state.claimTx.sign(keypair);
      console.log(`🔐 [${bot.name}] Signed claim TX for ${state.claimables.length} claimables.`);
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
    console.log(`⚠️ [${bot.name}] No claim TX to submit.`);
    state.done = true;
    return;
  }

  try {
    const res = await server.submitTransaction(state.claimTx);
    console.log(`✅ [${bot.name}] Claimed ${state.claimables.length} | TX: ${res.hash}`);
    logSuccess(bot.name, res.hash, state.claimables.length);
    state.done = true;
  } catch (e) {
    const msg = e?.response?.data?.extras?.result_codes?.operations || e.message;
    console.log(`❌ [${bot.name}] Claim failed: ${msg}`);
    logFailure(bot.name, msg);
    state.done = true;
  }
}

// Time check loop
setInterval(() => {
  const now = new Date();
  const h = (now.getUTCHours() + 1) % 24; // Nigeria time (UTC+1)
  const m = now.getUTCMinutes();
  const s = now.getUTCSeconds();
  const ms = now.getUTCMilliseconds();

  bots.forEach(bot => {
    const bh = parseInt(bot.hour);
    const bm = parseInt(bot.minute);
    const bs = parseInt(bot.second);
    const bms = parseInt(bot.ms || 0);
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
      Math.abs(ms - bms) < 150 &&
      state.prepared &&
      !state.done
    ) {
      console.log(`🕓 [${bot.name}] Time matched. Submitting claim.`);
      submitClaim(bot);
    }
  });
}, 100);

console.log('🟢 Pi Claim-Only Bot is running…');

// Optional HTTP server
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('🟢 Pi Claim Bot is running.\n');
  })
  .listen(PORT, () => console.log(`🌐 HTTP server on port ${PORT}`));
