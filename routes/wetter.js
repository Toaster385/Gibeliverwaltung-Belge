const { requireLogin } = require('../lib/auth');
const { holeWetter } = require('../lib/wetter');

module.exports = function (app) {
  app.get('/api/wetter', requireLogin, async (req, res) => {
    try { res.json(await holeWetter()); }
    catch (e) { res.status(502).json({ error: 'Das Wetter kann gerade nicht geladen werden.' }); }
  });
};
