const express = require('express');
const router = express.Router();
const statusMap = require('./multi-bot-runner');

router.get('/status', (req, res) => {
  res.json(statusMap);
});

module.exports = router;
