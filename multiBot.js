const fs = require('fs');
const http = require('http');
const {
  Server,
  Keypair,
  TransactionBuilder,
  Operation
} = require('@stellar/stellar-sdk');

const server = new Server('https://api.mainnet.minepi.com');
const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const botStates = {};

bots.forEach(bot => {
  botStates[bot.name] = {
    prepared: false,
    done: false,
    claimables: [],
    claimTx: null,
    resetToday: false,
    retryCount: 0,
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
    const keypair = Keypair.fromSecret(bot.secret);
    const account = await server.loadAccount(bot.public);
    const balances = await server.claimableBalances().claimant(bot.public).call();

    state.claimables = balances.records.map(r => r.id);
    const fee = await server.fetchBaseFee();

    const txBuilder = new TransactionBuilder(account, {
      fee: fee.toString(),
      networkPassphrase: 'Pi Network',
    });

    for (const id of state.claimables) {
      txBuilder.addOperation(
        Operation.claimClaimableBalance({ balanceId: id })
      );
    }

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
    state.retryCount = 0;
  } catch (e) {
    const msg =
      e?.response?.data?.extras?.result_codes?.operations ||
      e?.response?.data?.extras?.result_codes?.transaction ||
      e.message;

    console.log(`❌ [${bot.name}] Claim failed: ${msg}`);
    logFailure(bot.name, msg);

    state.retryCount++;
    if (state.retryCount < 3) {
      console.log(`🔁 [${bot.name}] Retrying claim (attempt ${state.retryCount})...`);
      setTimeout(() => submitClaim(bot), 2000);
    } else {
      console.log(`⛔ [${bot.name}] Max retries reached.`);
      state.done = true;
    }
  }
}

// Claim scheduling
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

    // Daily reset at 00:00:00 Nigeria time
    if (!state.resetToday && h === 0 && m === 0 && s < 2) {
      Object.assign(state, {
        prepared: false,
        done: false,
        claimables: [],
        claimTx: null,
        resetToday: true,
        retryCount: 0,
      });
      console.log(`🔁 [${bot.name}] Daily reset.`);
      prepare(bot);
    }

    // Reset flag after 00:00
    if (h > 0 && state.resetToday) {
      state.resetToday = false;
    }

    // Prepare transaction if we're within 10 seconds before scheduled claim
    if (
      !state.prepared &&
      (h > bh || (h === bh && m > bm) || (h === bh && m === bm && s >= bs - 10))
    ) {
      prepare(bot);
    }

    // Claim when exact time matches (with ±150ms tolerance)
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

// Optional HTTP server
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('🟢 Pi Claim Bot is running.\n');
  })
  .listen(PORT, () => console.log(`🌐 HTTP server on port ${PORT}`));
