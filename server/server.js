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
    email TEXT NOT NULL UNIQUE,
    phone_number TEXT NOT NULL UNIQUE,
    face_descriptor TEXT,
    latest_face_image TEXT,
    last_login DATETIME,
    session_history TEXT,
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
app.get('/api/user/:email', (req, res) => {
  try {
    const row = db.exec("SELECT id, first_name, last_name, email, phone_number, face_descriptor FROM users WHERE email = ?", [req.params.email]);
    if (row.length && row[0].values.length) {
      const v = row[0].values[0];
      res.json({ exists: true, hasDescriptor: !!v[5], user: { id: v[0], firstName: v[1], lastName: v[2], email: v[3], phone: v[4] } });
    } else {
      res.json({ exists: false });
    }
  } catch (err) { res.status(500).json({ error: 'Database error' }); }
});

app.post('/api/user/register', (req, res) => {
  try {
    const { firstName, lastName, email, phoneNumber } = req.body;
    if (!firstName || !lastName || !email || !phoneNumber) return res.status(400).json({ error: 'Missing fields' });
    
    const existingEmail = db.exec("SELECT id FROM users WHERE email = ?", [email]);
    if (existingEmail.length && existingEmail[0].values.length) {
      // Update existing user's name and phone if needed
      db.run("UPDATE users SET first_name = ?, last_name = ?, phone_number = ?, updated_at = datetime('now') WHERE email = ?", [firstName, lastName, phoneNumber, email]);
      saveDB();
      return res.json({ success: true, exists: true });
    }
    
    const existingPhone = db.exec("SELECT id FROM users WHERE phone_number = ? AND email != ?", [phoneNumber, email]);
    if (existingPhone.length && existingPhone[0].values.length) {
      return res.status(409).json({ error: 'PHONE_EXISTS', message: 'Phone number already exists with another account' });
    }
    
    db.run("INSERT INTO users (first_name, last_name, email, phone_number) VALUES (?, ?, ?, ?)", [firstName, lastName, email, phoneNumber]);
    saveDB();
    res.json({ success: true, exists: false });
  } catch (err) { res.status(500).json({ error: 'Registration failed' }); }
});

app.post('/api/face/register', (req, res) => {
  try {
    const { email, phoneNumber, descriptor, faceImage, firstName, lastName } = req.body;
    if (!email || !descriptor) return res.status(400).json({ error: 'Missing data' });
    
    // Check for duplicate face across accounts
    const allUsers = db.exec("SELECT email, face_descriptor FROM users WHERE face_descriptor IS NOT NULL AND email != ?", [email]);
    if (allUsers.length && allUsers[0].values.length) {
      for (const row of allUsers[0].values) {
        try {
          const existing = decryptDescriptor(row[1]);
          if (euclideanDistance(descriptor, existing) < 0.5) {
            return res.status(409).json({ error: 'DUPLICATE_FACE', message: 'Face already registered with another account' });
          }
        } catch (e) { continue; }
      }
    }
    
    const encrypted = encryptDescriptor(descriptor);
    const existingUser = db.exec("SELECT id FROM users WHERE email = ?", [email]);
    
    if (existingUser.length && existingUser[0].values.length) {
      // Update existing user
      db.run("UPDATE users SET face_descriptor = ?, latest_face_image = ?, updated_at = datetime('now') WHERE email = ?", [encrypted, faceImage || null, email]);
    } else {
      // Insert new user if doesn't exist
      const finalFirstName = firstName || 'Citizen';
      const finalLastName = lastName || '';
      const finalPhone = phoneNumber || '0000000000';
      db.run("INSERT INTO users (first_name, last_name, email, phone_number, face_descriptor, latest_face_image) VALUES (?, ?, ?, ?, ?, ?)", [finalFirstName, finalLastName, email, finalPhone, encrypted, faceImage || null]);
    }
    
    saveDB();
    res.json({ success: true, message: 'Biometric identity registered successfully' });
  } catch (err) { 
    console.error('Face registration error:', err);
    res.status(500).json({ error: 'Face registration failed' }); 
  }
});

app.post('/api/face/verify', (req, res) => {
  try {
    const { email, descriptor, faceImage } = req.body;
    if (!email || !descriptor) return res.status(400).json({ error: 'Missing data' });
    const result = db.exec("SELECT id, first_name, last_name, email, phone_number, face_descriptor, session_history FROM users WHERE email = ?", [email]);
    if (!result.length || !result[0].values.length || !result[0].values[0][5]) return res.status(404).json({ error: 'No biometric record found' });
    const v = result[0].values[0];
    const stored = decryptDescriptor(v[5]);
    const dist = euclideanDistance(descriptor, stored);
    if (dist < 0.5) {
      const encrypted = encryptDescriptor(descriptor);
      const now = new Date().toISOString();
      let sessionHistory = [];
      if (v[6]) {
        try { sessionHistory = JSON.parse(v[6]); } catch (e) {}
      }
      sessionHistory.unshift({ timestamp: now, type: 'login' });
      if (sessionHistory.length > 10) sessionHistory = sessionHistory.slice(0, 10);
      db.run("UPDATE users SET face_descriptor = ?, latest_face_image = ?, last_login = datetime('now'), session_history = ?, updated_at = datetime('now') WHERE email = ?", [encrypted, faceImage || null, JSON.stringify(sessionHistory), email]);
      saveDB();
      res.json({ success: true, verified: true, distance: dist, user: { id: v[0], firstName: v[1], lastName: v[2], email: v[3], phone: v[4] }, loginTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) });
    } else {
      res.json({ success: false, verified: false, distance: dist, message: 'Face does not match' });
    }
  } catch (err) { res.status(500).json({ error: 'Verification failed' }); }
});

app.post('/api/sms/alert', (req, res) => {
  const { phoneNumber, loginTime, location } = req.body;
  console.log(`[SMS] To: ${phoneNumber} | Time: ${loginTime} | Location: ${location}`);
  res.json({ success: true });
});

app.all('/api/auth', (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  const method = req.method;
  try {
    if (method === 'GET') {
      const email = req.query.email;
      const phone = req.query.phone;
      const identifier = email || phone;
      if (!identifier) return res.status(400).json({ error: 'Email or phone required' });
      
      const row = db.exec("SELECT id, first_name, last_name, email, phone_number, face_descriptor FROM users WHERE email = ? OR phone_number = ?", [identifier, identifier]);
      if (row.length && row[0].values.length) {
        const v = row[0].values[0];
        return res.json({ 
          exists: true, 
          hasDescriptor: !!v[5], 
          user: { 
            id: v[0], 
            firstName: v[1], 
            lastName: v[2], 
            email: v[3], 
            phone: v[4] 
          } 
        });
      }
      return res.json({ exists: false });
    }

    if (method === 'POST') {
      const { 
        action, 
        firstName, 
        lastName, 
        email, 
        phoneNumber, 
        descriptor, 
        faceImage 
      } = req.body || {};

      if (action === 'register') {
        if (!firstName || !lastName || !email || !phoneNumber) return res.status(400).json({ error: 'Missing fields' });
        
        const existingEmail = db.exec("SELECT id FROM users WHERE email = ?", [email]);
        if (existingEmail.length && existingEmail[0].values.length) {
          db.run("UPDATE users SET first_name = ?, last_name = ?, phone_number = ?, updated_at = datetime('now') WHERE email = ?", [firstName, lastName, phoneNumber, email]);
          saveDB();
          return res.json({ success: true, exists: true });
        }
        
        const existingPhone = db.exec("SELECT id FROM users WHERE phone_number = ? AND email != ?", [phoneNumber, email]);
        if (existingPhone.length && existingPhone[0].values.length) {
          return res.status(409).json({ error: 'PHONE_EXISTS', message: 'Phone number already exists with another account' });
        }
        
        db.run("INSERT INTO users (first_name, last_name, email, phone_number) VALUES (?, ?, ?, ?)", [firstName, lastName, email, phoneNumber]);
        saveDB();
        return res.json({ success: true, exists: false });
      }

      if (action === 'face_register') {
        if (!email || !descriptor) return res.status(400).json({ error: 'Missing data' });
        
        const allUsers = db.exec("SELECT email, face_descriptor FROM users WHERE face_descriptor IS NOT NULL AND email != ?", [email]);
        if (allUsers.length && allUsers[0].values.length) {
          for (const row of allUsers[0].values) {
            try {
              const existing = decryptDescriptor(row[1]);
              if (euclideanDistance(descriptor, existing) < 0.5) {
                return res.status(409).json({ error: 'DUPLICATE_FACE', message: 'Face already registered with another account' });
              }
            } catch (e) { continue; }
          }
        }
        
        const encrypted = encryptDescriptor(descriptor);
        const existingUser = db.exec("SELECT id FROM users WHERE email = ?", [email]);
        
        if (existingUser.length && existingUser[0].values.length) {
          db.run("UPDATE users SET face_descriptor = ?, latest_face_image = ?, updated_at = datetime('now') WHERE email = ?", [encrypted, faceImage || null, email]);
        } else {
          const finalFirstName = firstName || 'Citizen';
          const finalLastName = lastName || '';
          const finalPhone = phoneNumber || '0000000000';
          db.run("INSERT INTO users (first_name, last_name, email, phone_number, face_descriptor, latest_face_image) VALUES (?, ?, ?, ?, ?, ?)", [finalFirstName, finalLastName, email, finalPhone, encrypted, faceImage || null]);
        }
        
        saveDB();
        return res.json({ success: true, message: 'Biometric identity registered' });
      }

      if (action === 'face_verify') {
        if (!email || !descriptor) return res.status(400).json({ error: 'Missing data' });
        const result = db.exec("SELECT id, first_name, last_name, email, phone_number, face_descriptor, session_history FROM users WHERE email = ?", [email]);
        if (!result.length || !result[0].values.length || !result[0].values[0][5]) return res.status(404).json({ error: 'No biometric record found' });
        const v = result[0].values[0];
        const stored = decryptDescriptor(v[5]);
        const dist = euclideanDistance(descriptor, stored);
        if (dist < 0.5) {
          const encrypted = encryptDescriptor(descriptor);
          let sessionHistory = [];
          if (v[6]) {
            try { sessionHistory = JSON.parse(v[6]); } catch (e) {}
          }
          sessionHistory.unshift({ timestamp: new Date().toISOString(), type: 'login' });
          if (sessionHistory.length > 10) sessionHistory = sessionHistory.slice(0, 10);
          db.run("UPDATE users SET face_descriptor = ?, latest_face_image = ?, last_login = datetime('now'), session_history = ?, updated_at = datetime('now') WHERE email = ?", [encrypted, faceImage || null, JSON.stringify(sessionHistory), email]);
          saveDB();
          return res.json({ 
            success: true, 
            verified: true, 
            distance: dist, 
            user: { id: v[0], firstName: v[1], lastName: v[2], email: v[3], phone: v[4] }, 
            loginTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) 
          });
        } else {
          return res.json({ success: false, verified: false, distance: dist, message: 'Face does not match' });
        }
      }

      if (action === 'sms_alert') {
        const { phone, loginTime, location } = req.body;
        console.log(`[SMS] To: ${phone} | Time: ${loginTime} | Location: ${location}`);
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch(err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  Gov India Auth Server on http://localhost:${PORT}\n`);
  });
});
