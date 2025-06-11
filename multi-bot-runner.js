const fs = require('fs');
const { Keypair, TransactionBuilder, Networks, Operation, Server } = require('stellar-sdk');

const botsFile = './bot.json';

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function startBot(bot) {
  const server = new Server('https://api.mainnet.minepi.com');
  const sourceKeypair = Keypair.fromSecret(bot.secret);
  const accountPublic = sourceKeypair.publicKey();

  while (true) {
    try {
      const account = await server.loadAccount(accountPublic);
      const balance = parseFloat(account.balances.find(b => b.asset_type === 'native')?.balance || '0');
      if (balance > 0.5) {
        const amountToSend = (balance - 0.5).toFixed(7);
        const tx = new TransactionBuilder(account, {
          fee: (await server.fetchBaseFee()).toString(),
          networkPassphrase: Networks.PUBLIC,
        })
        .addOperation(Operation.payment({
          destination: bot.receiver,
          asset: Operation.native(),
          amount: amountToSend
        }))
        .setTimeout(30)
        .build();

        tx.sign(sourceKeypair);
        const txResult = await server.submitTransaction(tx);
        console.log(`✅ Sent ${amountToSend} Pi from ${accountPublic}:`, txResult.hash);
      }
    } catch (err) {
      console.error(`❌ Error for ${bot.secret.slice(0, 5)}...:`, err.message);
    }

    await sleep(1000); // Check every 1000ms
  }
}

function initBots() {
  const bots = JSON.parse(fs.readFileSync(botsFile));
  bots.forEach(startBot);
}

module.exports = { initBots };
