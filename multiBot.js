const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

const sequences = {}; // Store latest sequence numbers
const executed = {};  // Track per-bot execution

const app = express();
const PORT = process.env.PORT || 10000;

// Get time of a bot in milliseconds
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Stream the sequence of each wallet
function streamSequence(bot) {
  server.accounts()
    .accountId(bot.public)
    .stream({
      onmessage: (account) => {
        sequences[bot.public] = account.sequence;
        console.log(`🔄 [${bot.name}] Sequence updated: ${account.sequence}`);
      },
      onerror: (error) => {
        console.error(`🚨 [${bot.name}] Stream error:`, error.message || error);
      }
    });
}

// Wait for next ledger before retrying
function waitForNextLedger(bot, callback) {
  const listener = server.ledgers().stream({
    onmessage: () => {
      console.log(`🔁 [${bot.name}] Retrying on next ledger...`);
      listener(); // stop stream
      callback();
    },
    onerror: (err) => {
      console.error(`❌ [${bot.name}] Ledger stream error:`, err.message || err);
      listener();
    }
  });
}

// Main bot logic with retry
async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);
  let retryCount = 0;

  const attemptTx = async () => {
    try {
      const sequence = sequences[bot.public];
      if (!sequence) throw new Error(`No sequence available for bot: ${bot.name}`);

      const account = new StellarSdk.Account(bot.public, sequence);
      const baseFeePi = parseFloat(bot.baseFeePi || "0.005");
      const baseFeeStroops = Math.floor(baseFeePi * 1e7);

      const txBuilder = new StellarSdk.TransactionBuilder(account, {
        fee: (baseFeeStroops * 2).toString(),
        networkPassphrase: 'Pi Network',
      });

      if (retryCount === 0 && bot.claimId) {
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
        console.log(`❌ [${bot.name}] TX not successful, retrying on next ledger...`);
        retryCount++;
      }

    } catch (e) {
      const resultCode = e?.response?.data?.extras?.result_codes?.transaction;

      if (resultCode === 'tx_bad_seq') {
        console.log(`⚠️ [${bot.name}] tx_bad_seq: refreshing sequence and retrying...`);
        try {
          const refreshed = await server.loadAccount(bot.public);
          sequences[bot.public] = refreshed.sequence;
          retryCount++;
          if (retryCount <= 3) {
            return attemptTx(); // Retry immediately with new sequence
          }
        } catch (refreshError) {
          console.log(`🚫 Failed to refresh sequence:`, refreshError.message);
        }
      } else {
        console.log(`❌ [${bot.name}] Attempt ${retryCount + 1} failed.`);
        if (e?.response?.data?.extras?.result_codes) {
          console.log('🔍 result_codes:', e.response.data.extras.result_codes);
        } else if (e?.response?.data) {
          console.log('🔍 Horizon error:', e.response.data);
        } else if (e?.response) {
          console.log('🔍 Response error:', e.response);
        } else {
          console.log('🔍 Raw error:', e.message || e.toString());
        }

        retryCount++;
        if (retryCount <= 3) {
          waitForNextLedger(bot, attemptTx); // Retry on next ledger
        }
      }
    }

    if (retryCount >= 3) {
      console.log(`⛔ [${bot.name}] Max retries reached.`);
    }
  };

  attemptTx();
}

// Trigger bot when ledger is near unlock time
function streamLedgerAndTrigger() {
  server.ledgers().stream({
    onmessage: (ledger) => {
      const now = new Date();
      const nowMs =
        now.getUTCHours() * 3600000 +
        now.getUTCMinutes() * 60000 +
        now.getUTCSeconds() * 1000 +
        now.getUTCMilliseconds();

      bots.forEach(bot => {
        const botTimeMs = getBotTimestamp(bot);
        const diff = botTimeMs - nowMs;

        if (!executed[bot.name] && diff >= 0 && diff <= 5000) {
          console.log(`🕒 Ledger matched within 5s window for ${bot.name}. Executing now...`);
          executed[bot.name] = true;
          send(bot);
        }
      });

      if (nowMs < 1000) {
        console.log("🔁 New UTC day — reset.");
        bots.forEach(bot => executed[bot.name] = false);
      }
    },
    onerror: (err) => {
      console.error('📛 Ledger stream error:', err.message || err);
    }
  });
}

// Start sequence streams for all bots
bots.forEach(bot => {
  streamSequence(bot);
  executed[bot.name] = false;
});

// Start ledger trigger
streamLedgerAndTrigger();

// Web status endpoints
app.get('/', (req, res) => {
  res.send(`🟢 Bot status: ${JSON.stringify(executed)}`);
});

app.get('/sequences', (req, res) => {
  const result = bots.map(bot => ({
    name: bot.name,
    public: bot.public,
    sequence: sequences[bot.public] || '⏳ Waiting...',
  }));
  res.json(result);
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
