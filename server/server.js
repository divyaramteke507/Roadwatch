require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const initSqlJs = require('sql.js');
const CryptoJS = require('crypto-js');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY || 'gov-india-ncap-secret-2026';
const DB_PATH = path.join(__dirname, 'citizens.db');

let db;

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone_number TEXT NOT NULL UNIQUE,
    face_descriptor TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  saveDB();
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// ─── MIDDLEWARE ───
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..')));

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100, message: { error: 'Too many requests.' } });
app.use('/api/', apiLimiter);

// ─── HELPERS ───
function encryptDescriptor(d) { return CryptoJS.AES.encrypt(JSON.stringify(d), SECRET_KEY).toString(); }
function decryptDescriptor(e) { return JSON.parse(CryptoJS.AES.decrypt(e, SECRET_KEY).toString(CryptoJS.enc.Utf8)); }
function euclideanDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Infinity;
  let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s);
}

// ─── ROUTES ───
app.get('/api/user/:phone', (req, res) => {
  try {
    const row = db.exec("SELECT id, first_name, last_name, phone_number, face_descriptor FROM users WHERE phone_number = ?", [req.params.phone]);
    if (row.length && row[0].values.length) {
      const v = row[0].values[0];
      res.json({ exists: true, hasDescriptor: !!v[4], user: { id: v[0], firstName: v[1], lastName: v[2], phone: v[3] } });
    } else {
      res.json({ exists: false });
    }
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.post('/api/user/register', (req, res) => {
  try {
    const { firstName, lastName, phoneNumber } = req.body;
    if (!firstName || !lastName || !phoneNumber) return res.status(400).json({ error: 'Missing fields' });
    const existing = db.exec("SELECT id FROM users WHERE phone_number = ?", [phoneNumber]);
    if (existing.length && existing[0].values.length) {
      db.run("UPDATE users SET first_name = ?, last_name = ?, updated_at = datetime('now') WHERE phone_number = ?", [firstName, lastName, phoneNumber]);
    } else {
      db.run("INSERT INTO users (first_name, last_name, phone_number) VALUES (?, ?, ?)", [firstName, lastName, phoneNumber]);
    }
    saveDB();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: 'Registration failed' }); }
});

app.post('/api/face/register', (req, res) => {
  try {
    const { phoneNumber, descriptor } = req.body;
    if (!phoneNumber || !descriptor) return res.status(400).json({ error: 'Missing data' });
    const allUsers = db.exec("SELECT phone_number, face_descriptor FROM users WHERE face_descriptor IS NOT NULL AND phone_number != ?", [phoneNumber]);
    if (allUsers.length && allUsers[0].values.length) {
      for (const row of allUsers[0].values) {
        try {
          const existing = decryptDescriptor(row[1]);
          if (euclideanDistance(descriptor, existing) < 0.5) {
            return res.status(409).json({ error: 'DUPLICATE_FACE', message: 'This biometric identity is already linked with another mobile number. Duplicate citizen biometric record detected.' });
          }
        } catch (e) { continue; }
      }
    }
    const encrypted = encryptDescriptor(descriptor);
    db.run("UPDATE users SET face_descriptor = ?, updated_at = datetime('now') WHERE phone_number = ?", [encrypted, phoneNumber]);
    saveDB();
    res.json({ success: true, message: 'Biometric identity registered successfully' });
  } catch (err) { res.status(500).json({ error: 'Face registration failed' }); }
});

app.post('/api/face/verify', (req, res) => {
  try {
    const { phoneNumber, descriptor } = req.body;
    if (!phoneNumber || !descriptor) return res.status(400).json({ error: 'Missing data' });
    const result = db.exec("SELECT first_name, last_name, phone_number, face_descriptor FROM users WHERE phone_number = ?", [phoneNumber]);
    if (!result.length || !result[0].values.length || !result[0].values[0][3]) return res.status(404).json({ error: 'No biometric record found' });
    const v = result[0].values[0];
    const stored = decryptDescriptor(v[3]);
    const dist = euclideanDistance(descriptor, stored);
    if (dist < 0.5) {
      res.json({ success: true, verified: true, distance: dist, user: { firstName: v[0], lastName: v[1], phone: v[2] }, loginTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) });
    } else {
      res.json({ success: false, verified: false, distance: dist, message: 'Biometric mismatch. Identity verification failed.' });
    }
  } catch (err) { res.status(500).json({ error: 'Verification failed' }); }
});

app.post('/api/sms/alert', (req, res) => {
  const { phoneNumber, loginTime, location } = req.body;
  console.log(`[SMS] To: ${phoneNumber} | Time: ${loginTime} | Location: ${location}`);
  res.json({ success: true });
});

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  Gov India Auth Server on http://localhost:${PORT}\n`);
  });
});
