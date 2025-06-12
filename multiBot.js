const fs = require('fs');
const http = require('http');
const StellarSdk = require('stellar-sdk');

// Connect to Pi Network Horizon server
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Load bot config
const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));

const retryLimit = 10;
const retryDelay = 1500; // 1.5 seconds

const botStates = {};

// Initialize state per bot
bots.forEach(bot => {
  botStates[bot.name] = {
    prepared: false,
    retries: 0,
    sendRetries: 0,
    done: false,
    claimables: [],
    claimTx: null,
    sendTx: null,
  };
});

async function prepare(bot) {
  const state = botStates[bot.name];
  try {
    const keypair = StellarSdk.Keypair.fromSecret(bot.secret);
    const account = await server.loadAccount(bot.public);
    const balances = await server
      .claimableBalances()
      .claimant(bot.public)
      .call();

    state.claimables = balances.records.map(r => r.id);
    const fee = await server.fetchBaseFee();
    const txBuilder = new StellarSdk.TransactionBuilder(account, {
      fee,
      networkPassphrase: 'Pi Network',
    });

    // Add claimable balance ops
    state.claimables.forEach(id => {
      txBuilder.addOperation(
        StellarSdk.Operation.claimClaimableBalance({ balanceId: id })
      );
    });

    state.claimTx = state.claimables.length > 0 ? txBuilder.setTimeout(60).build() : null;
    if (state.claimTx) state.claimTx.sign(keypair);

    // Build send TX from bot.json amount
    const sendBuilder = new StellarSdk.TransactionBuilder(account, {
      fee,
      networkPassphrase: 'Pi Network',
    });

    const amount = parseFloat(bot.amount);
    if (!bot.recipient || !amount || amount <= 0) {
      console.log(`⚠️ [${bot.name}] Invalid recipient or amount.`);
      return;
    }

    sendBuilder.addOperation(
      StellarSdk.Operation.payment({
        destination: bot.recipient,
        asset: StellarSdk.Asset.native(),
        amount: amount.toFixed(7),
      })
    );

    state.sendTx = sendBuilder.setTimeout(60).build();
    state.sendTx.sign(keypair);

    console.log(`🔐 [${bot.name}] sendTx signed for ${bot.amount} Pi to ${bot.recipient}`);
    state.prepared = true;
    console.log(`🛠️ [${bot.name}] Prepared TXs | Claim: ${state.claimables.length}, Send: ${bot.amount}`);
  } catch (e) {
    console.log(`❌ [${bot.name}] Prepare failed: ${e.message}`);
    setTimeout(() => prepare(bot), 5000);
  }
}

async function submitClaim(bot) {
  const state = botStates[bot.name];
  if (state.done || state.retries >= retryLimit) return;

  if (!state.claimTx) {
    console.log(`⚠️ [${bot.name}] No claim TX. Skipping claim.`);
    state.done = true;
    await sendCoins(bot); // ✅ Await here
    return;
  }

  try {
    const res = await server.submitTransaction(state.claimTx);
    console.log(`✅ [${bot.name}] Claimed claimables | TX: ${res.hash}`);
    state.done = true;
    await sendCoins(bot); // ✅ Await here
  } catch (e) {
    state.retries++;
    const msg = e?.response?.data?.extras?.result_codes?.operations || e.message;
    console.log(`❌ [${bot.name}] Claim retry ${state.retries}: ${msg}`);
    if (state.retries < retryLimit) {
      setTimeout(() => submitClaim(bot), retryDelay);
    } else {
      console.log(`🛑 [${bot.name}] Claim failed after ${retryLimit} retries.`);
      state.done = true;
      await sendCoins(bot); // ✅ Fallback to send even if claim fails
    }
  }
}

async function sendCoins(bot) {
  console.log(`🚀 [${bot.name}] Attempting to send coins...`);
  const state = botStates[bot.name];
  if (!state.sendTx || state.sendRetries >= retryLimit) {
    console.log(`⛔ [${bot.name}] No sendTx or retries exceeded.`);
    return;
  }

  try {
    const res = await server.submitTransaction(state.sendTx);
    console.log(`✅ [${bot.name}] Sent ${bot.amount} to ${bot.recipient} | TX: ${res.hash}`);
  } catch (e) {
    state.sendRetries++;
    const msg = e?.response?.data?.extras?.result_codes?.operations || e.message;
    console.log(`❌ [${bot.name}] Send retry ${state.sendRetries}: ${msg}`);
    if (state.sendRetries < retryLimit) {
      setTimeout(() => sendCoins(bot), retryDelay);
    } else {
      console.log(`🛑 [${bot.name}] Send failed after ${retryLimit} retries.`);
    }
  }
}

// Tick every 100ms to match time
setInterval(() => {
  const now = new Date();
  const [h, m, s, ms] = [now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds()];

  bots.forEach(bot => {
    const bh = parseInt(bot.hour);
    const bm = parseInt(bot.minute);
    const bs = parseInt(bot.second);
    const bms = parseInt(bot.ms || 0);
    const state = botStates[bot.name];

    // Reset at midnight
    if (h === 0 && m === 0 && s === 0 && ms < 100) {
      Object.assign(state, {
        prepared: false,
        done: false,
        retries: 0,
        sendRetries: 0,
        claimables: [],
        claimTx: null,
        sendTx: null,
      });
      console.log(`🔁 [${bot.name}] State reset.`);
      prepare(bot);
    }

    // Prepare if we're near target time
    if (
      !state.prepared &&
      (h > bh || (h === bh && m > bm) || (h === bh && m === bm && s >= bs - 10))
    ) {
      prepare(bot);
    }

    // Execute at exact time
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

console.log('🟢 Pi Multi‑Bot Claim & Send is running…');

// 🌐 HTTP Server (for uptime pings)
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('🟢 Pi Multi‑Bot is running.\n');
  })
  .listen(PORT, () => console.log(`🌐 HTTP server on port ${PORT}`));
