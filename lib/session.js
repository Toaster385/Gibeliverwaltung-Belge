// Sitzungen in SQLite (überleben Neustarts)
const session = require('express-session');
const { db } = require('./db');

const WOCHE = 7 * 24 * 60 * 60 * 1000;
const laufzeit = sess => sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + WOCHE;

class SQLiteStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired_at > ?').get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) {
    try { db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired_at) VALUES (?,?,?)').run(sid, JSON.stringify(sess), laufzeit(sess)); cb(null); }
    catch (e) { cb(e); }
  }
  destroy(sid, cb) {
    try { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); cb(null); } catch (e) { cb(e); }
  }
  touch(sid, sess, cb) {
    try { db.prepare('UPDATE sessions SET expired_at = ? WHERE sid = ?').run(laufzeit(sess), sid); if (cb) cb(null); }
    catch (e) { if (cb) cb(e); }
  }
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE expired_at <= ?').run(Date.now()), 3600000).unref();

module.exports = { SQLiteStore };
