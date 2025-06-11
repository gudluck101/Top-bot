const app = express(); const PORT = process.env.PORT || 3000;

app.use(express.json()); app.use(express.static('public'));

app.get('/bots', (req, res) => { const data = fs.readFileSync(path.join(__dirname, 'bot.json')); res.json(JSON.parse(data)); });

app.post('/bots', (req, res) => { fs.writeFileSync(path.join(__dirname, 'bot.json'), JSON.stringify(req.body, null, 2)); res.json({ success: true }); initBots(); });

app.listen(PORT, () => { console.log(✅ Server running on port ${PORT}); initBots(); });

