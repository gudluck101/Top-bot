const express = require('express');
const bodyParser = require('body-parser');
const { exec } = require('child_process');
const app = express();
const port = 9000;

app.use(bodyParser.json());

app.post('/webhook', (req, res) => {
  exec('sh ./deploy.sh', (err, stdout, stderr) => {
    if (err) return res.status(500).send(err);
    res.send('Deployed!');
  });
});

app.listen(port, () => console.log(`Webhook listening on port ${port}`));
