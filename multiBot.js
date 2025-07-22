const fs = require('fs');
const express = require('express');
const StellarSdk = require('stellar-sdk');
const nodemailer = require('nodemailer');
require('dotenv').config();

const bots = JSON.parse(fs.readFileSync('bot.json', 'utf-8'));
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');

// Nodemailer setup
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

function sendEmail(to, subject, html) {
  return transporter.sendMail({
    from: `"Pi Bot" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
  });
}

// Convert time to UTC ms
function getBotTimestamp(bot) {
  return (
    parseInt(bot.hour) * 3600000 +
    parseInt(bot.minute) * 60000 +
    parseInt(bot.second) * 1000 +
    parseInt(bot.millisecond || 0)
  );
}

// Main bot logic
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
        fee: (baseFeeStroops * 2).toString(),
        networkPassphrase: 'Pi Network',
      });

      if (attempt === 1) {
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
        const message = `
          <h3>✅ ${bot.name} Transaction Successful</h3>
          <p><b>TX Hash:</b> ${result.hash}</p>
          <p><b>Amount:</b> ${bot.amount}</p>
          <p><b>To:</b> ${bot.destination}</p>
        `;
        await sendEmail(bot.email, `${bot.name} - TX SUCCESS ✅`, message);
        console.log(`✅ [${bot.name}] TX Success! Hash: ${result.hash}`);
        return; // Exit after success
      } else {
        console.log(`❌ [${bot.name}] TX not successful`);
      }

    } catch (e) {
      console.log(`❌ [${bot.name}] Attempt ${attempt} failed.`);

      let errorDetails = '';
      if (e?.response?.data?.extras?.result_codes) {
        errorDetails = JSON.stringify(e.response.data.extras.result_codes);
        console.log('🔍 result_codes:', e.response.data.extras.result_codes);
      } else if (e?.response?.data) {
        errorDetails = JSON.stringify(e.response.data);
        console.log('🔍 Horizon error:', e.response.data);
      } else if (e?.response) {
        errorDetails = JSON.stringify(e.response);
        console.log('🔍 Response error:', e.response);
      } else {
        errorDetails = e.message || e.toString();
        console.log('🔍 Raw error:', errorDetails);
      }

      // Send error email on last attempt
      if (attempt === 10) {
        const message = `
          <h3>⛔ ${bot.name} Transaction Failed</h3>
          <p><b>Error:</b> ${errorDetails}</p>
          <p><b>Destination:</b> ${bot.destination}</p>
        `;
        await sendEmail(bot.email, `${bot.name} - TX FAILED ❌`, message);
      }
    }
  }

  console.log(`⛔ [${bot.name}] All 10 attempts failed.`);
}

// Run all bots in order
async function runBotsSequentially() {
  for (const bot of bots) {
    console.log(`🚀 Running ${bot.name}...`);
    await send(bot);
  }
}

let executed = false;

// Time-based trigger every 100ms
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

// Express UI
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send(`🟢 Bot status: Triggered = ${executed}`);
});

app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
