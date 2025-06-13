const fs = require("fs");
const { Server, Keypair, TransactionBuilder, Networks, Operation } = require("@stellar/stellar-sdk");
const moment = require("moment-timezone");

const server = new Server("https://api.mainnet.minepi.com");

async function prepareTransaction(secret, targetAddress) {
  try {
    const sourceKeypair = Keypair.fromSecret(secret);
    const sourcePublicKey = sourceKeypair.publicKey();

    const account = await server.loadAccount(sourcePublicKey);
    const fee = await server.fetchBaseFee();

    const tx = new TransactionBuilder(account, {
      fee: fee.toString(),
      networkPassphrase: Networks.PI_MAINNET
    })
      .addOperation(Operation.claimClaimableBalance({ balanceId: "TODO_YOUR_BALANCE_ID" }))
      .setTimeout(180)
      .build();

    tx.sign(sourceKeypair);
    return tx;
  } catch (err) {
    console.error("❌ Error preparing transaction:", err.message);
    return null;
  }
}

function waitUntil(targetTime, callback) {
  const now = moment.tz("Africa/Lagos");
  const diff = targetTime.diff(now);
  if (diff <= 0) return callback();
  console.log(`⏳ Waiting ${diff}ms until ${targetTime.format("HH:mm:ss.SSS")}`);
  setTimeout(callback, diff);
}

async function runBot(botConfig) {
  const targetTime = moment.tz(botConfig.time, "Africa/Lagos");
  const transaction = await prepareTransaction(botConfig.secret, botConfig.target);

  if (!transaction) return;

  waitUntil(targetTime, async () => {
    try {
      const txResult = await server.submitTransaction(transaction);
      console.log(`✅ Transaction successful for ${botConfig.target}:`, txResult.hash);
    } catch (err) {
      console.error("❌ Transaction failed:", err.response?.data || err.message);
    }
  });
}

async function startBots() {
  const config = JSON.parse(fs.readFileSync("bot.json"));
  for (const bot of config) {
    runBot(bot);
  }
}

startBots();
