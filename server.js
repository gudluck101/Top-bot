const express = require('express');
const fs = require('fs');
const path = require('path');
const { initBots } = require('./multi-bot-runner');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const botsFile = './bot.json';

app.get('/bots', (req, res) => {
  const bots = JSON.parse(fs.readFileSync(botsFile));
  res.json(bots);
});

app.post('/bots', (req, res) => {
  const bots = req.body;
  fs.writeFileSync(botsFile, JSON.stringify(bots, null, 2));
  res.json({ success: true });
  process.exit(1); // force restart to reinitialize bots
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  initBots();
});
