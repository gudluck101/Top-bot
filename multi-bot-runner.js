require('dotenv').config();
const StellarSdk = require('stellar-sdk');
const fs = require('fs');
const path = require('path');
const botsPath = path.join(__dirname, 'bots.json');
const server = new StellarSdk.Server('https://api.mainnet.minepi.com');
const statusMap = {};

function loadBots() {
  return JSON.parse(fs.readFileSync(botsPath));
}

function startBot(bot) {
  const { name, public: pub, private: secret, receiver, amount, interval } = bot;
  const keypair = StellarSdk.Keypair.fromSecret(secret);
  const amountFloat = parseFloat(amount);

  const loop = async () => {
    try {
      const account = await server.loadAccount(pub);
      const balanceObj = account.balances.find(b => b.asset_type === 'native');
      const balance = parseFloat(balanceObj?.balance || '0');

      const ready = balance >= amountFloat;

      statusMap[name] = {
        name,
        balance,
        status: ready ? '🟢 Ready' : '⏳ Waiting',
        receiver,
        lastCheck: new Date().toISOString()
      };

      if (ready) {
        const tx = new StellarSdk.TransactionBuilder(account, {
          fee: await server.fetchBaseFee(),
          networkPassphrase: StellarSdk.Networks.PUBLIC,
        })
          .addOperation(StellarSdk.Operation.payment({
            destination: receiver,
            asset: StellarSdk.Asset.native(),
            amount: amount,
          }))
          .setTimeout(30)
          .build();

        tx.sign(keypair);
        const result = await server.submitTransaction(tx);
        statusMap[name].status = `✅ Sent ${amount} PI`;
        statusMap[name].txHash = result.hash;
      }
    } catch (err) {
      statusMap[name] = {
        name,
        status: `❌ Error: ${err.message}`,
        lastCheck: new Date().toISOString()
      };
    } finally {
      setTimeout(loop, interval);
    }
  };

  loop();
}

function initBots() {
  const bots = loadBots();
  bots.forEach(startBot);
}

initBots();
module.exports = statusMap;
