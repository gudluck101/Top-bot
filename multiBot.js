const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');
const nodemailer = require('nodemailer');

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// === Email Config ===
const EMAIL_CONFIG = {
  service: 'gmail',
  auth: {
    user: 'nwankwogoodluck156@gmail.com',
    pass: 'tomf caoh ivqt itpo'
  }
};

const transporter = nodemailer.createTransport(EMAIL_CONFIG);

function sendEmail(to, subject, message) {
  const mailOptions = {
    from: EMAIL_CONFIG.auth.user,
    to,
    subject,
    text: message
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      return console.error(`❌ Email error: ${error}`);
    }
    console.log(`📧 Email sent to ${to}: ${info.response}`);
  });
}

// === Time Conversion ===
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// === Main Bot Logic ===
async function send(bot) {
  const botKey = StellarSdk.Keypair.fromSecret(bot.secret);

  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      if (attempt > 1) await new Promise(res => setTimeout(res, 400));

      const accountData = await server.loadAccount(bot.public);
      const account = new StellarSdk.Account(bot.public, accountData.sequence);

      const baseFeePi = parseFloat(bot.baseFeePi || "0.005");
      const baseFeeStroops = Math.floor(baseFeePi * 1e7);

      const txBuilder = new StellarSdk.TransactionBuilder(account, {
        fee: (baseFeeStroops * 2).toString(), // 2 ops
        networkPassphrase: 'Pi Network',
      });

      if (attempt === 1 && bot.claimId) {
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

      let result;

      // === Use Fee Wallet If Provided ===
      if (bot.feePayerSecret) {
        const feePayer = StellarSdk.Keypair.fromSecret(bot.feePayerSecret);
        const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
          feePayer,
          (baseFeeStroops * 2).toString(),
          tx,
          'Pi Network'
        );
        feeBumpTx.sign(feePayer);
        result = await server.submitTransaction(feeBumpTx);
      } else {
        result = await server.submitTransaction(tx);
      }

      if (result?.successful && result?.hash) {
        console.log(`✅ [${bot.name}] TX Success! Hash: ${result.hash}`);

        if (bot.email) {
          sendEmail(
            bot.email,
            `✅ Transaction Successful: ${bot.name}`,
            `Transaction succeeded for ${bot.name}\n\nTX Hash:\n${result.hash}`
          );
        }
        return; // stop retries
      } else {
        console.log(`❌ [${bot.name}] TX not successful`);
      }

    } catch (e) {
      console.log(`❌ [${bot.name}] Attempt ${attempt} failed.`);

      let errorMsg = '';

      if (e?.response?.data?.extras?.result_codes) {
        console.log('🔍 result_codes:', e.response.data.extras.result_codes);
        errorMsg = JSON.stringify(e.response.data.extras.result_codes);
      } else if (e?.response?.data) {
        console.log('🔍 Horizon error:', e.response.data);
        errorMsg = JSON.stringify(e.response.data);
      } else if (e?.response) {
        console.log('🔍 Response error:', e.response);
        errorMsg = JSON.stringify(e.response);
      } else {
        errorMsg = e.message || e.toString();
        console.log('🔍 Raw error:', errorMsg);
      }

      // Send email on final failure
      if (attempt === 10 && bot.email) {
        sendEmail(
          bot.email,
          `❌ Transaction Failed: ${bot.name}`,
          `All attempts failed for ${bot.name}\n\nError:\n${errorMsg}`
        );
      }
    }
  }

  console.log(`⛔ [${bot.name}] All 10 attempts failed.`);
}

// === Run All Bots ===
async function runBotsSequentially() {
  for (const bot of bots) {
    console.log(`🚀 Running ${bot.name}...`);
    await send(bot);
  }
}

// === Timer Logic ===
let executed = false;

setInterval(() => {
  const now = new Date();
  const nowMs =
    now.getUTCHours() * 3600000 +
    now.getUTCMinutes() * 60000 +
    now.getUTCSeconds() * 1000 +
    now.getUTCMilliseconds();

  const firstBot = bots[0];
  const botTimeMs = getBotTimestamp(firstBot);
  const diff = Math.abs(nowMs - botTimeMs);

  if (!executed && diff <= 200) {
    console.log(`⏰ Time matched for ${firstBot.name}. Starting...`);
    executed = true;
    runBotsSequentially();
  }

  if (nowMs < 1000) {
    executed = false;
    console.log("🔁 New UTC day — reset.");
  }
}, 100);

// === Web UI ===
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send(`🟢 Bot status: Triggered = ${executed}`);
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
