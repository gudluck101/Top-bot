const express = require('express');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
app.use(express.static('public'));
app.use(bodyParser.json());

const botsPath = path.join(__dirname, 'bots.json');
const statusRoute = require('./monitor-status');

app.use('/api', statusRoute);

app.post('/api/add-bot', (req, res) => {
  const bots = JSON.parse(fs.readFileSync(botsPath));
  bots.push(req.body);
  fs.writeFileSync(botsPath, JSON.stringify(bots, null, 2));
  res.send({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
