const CryptoJS = require('crypto-js');
const SECRET = process.env.SECRET_KEY || 'gov-india-ncap-secret-2026';

// In-memory store (resets per cold start — use Firestore/Vercel KV for persistence)
// For production, connect to Firebase Firestore
let users = {};

function encrypt(d) { return CryptoJS.AES.encrypt(JSON.stringify(d), SECRET).toString(); }
function decrypt(e) { return JSON.parse(CryptoJS.AES.decrypt(e, SECRET).toString(CryptoJS.enc.Utf8)); }
function eucDist(a, b) { if (!a||!b||a.length!==b.length) return Infinity; let s=0; for(let i=0;i<a.length;i++) s+=(a[i]-b[i])**2; return Math.sqrt(s); }

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.url.replace('/api/auth', '').split('?')[0];
  const method = req.method;

  try {
    // GET /api/auth?action=getuser&phone=xxx
    if (method === 'GET') {
      const phone = req.query.phone;
      if (!phone) return res.status(400).json({ error: 'Phone required' });
      const user = users[phone];
      if (user) {
        return res.json({ exists: true, hasDescriptor: !!user.descriptor, user: { firstName: user.firstName, lastName: user.lastName, phone } });
      }
      return res.json({ exists: false });
    }

    // POST actions
    if (method === 'POST') {
      const { action, firstName, lastName, phoneNumber, descriptor, phone, loginTime, location } = req.body || {};

      if (action === 'register') {
        if (!firstName || !lastName || !phoneNumber) return res.status(400).json({ error: 'Missing fields' });
        if (!users[phoneNumber]) users[phoneNumber] = {};
        users[phoneNumber].firstName = firstName;
        users[phoneNumber].lastName = lastName;
        return res.json({ success: true });
      }

      if (action === 'face_register') {
        if (!phoneNumber || !descriptor) return res.status(400).json({ error: 'Missing data' });
        // Duplicate check
        for (const [ph, u] of Object.entries(users)) {
          if (ph !== phoneNumber && u.descriptor) {
            try {
              const existing = decrypt(u.descriptor);
              if (eucDist(descriptor, existing) < 0.5) {
                return res.status(409).json({ error: 'DUPLICATE_FACE', message: 'This biometric identity is already linked with another mobile number.' });
              }
            } catch(e) {}
          }
        }
        users[phoneNumber] = users[phoneNumber] || {};
        users[phoneNumber].descriptor = encrypt(descriptor);
        return res.json({ success: true, message: 'Biometric identity registered' });
      }

      if (action === 'face_verify') {
        if (!phoneNumber || !descriptor) return res.status(400).json({ error: 'Missing data' });
        const user = users[phoneNumber];
        if (!user || !user.descriptor) return res.status(404).json({ error: 'No biometric record found' });
        const stored = decrypt(user.descriptor);
        const dist = eucDist(descriptor, stored);
        if (dist < 0.5) {
          return res.json({ success: true, verified: true, distance: dist, user: { firstName: user.firstName, lastName: user.lastName, phone: phoneNumber }, loginTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) });
        }
        return res.json({ success: false, verified: false, distance: dist, message: 'Biometric mismatch.' });
      }

      if (action === 'sms_alert') {
        console.log(`[SMS] To: ${phone} | Time: ${loginTime} | Location: ${location}`);
        return res.json({ success: true });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch(err) {
    res.status(500).json({ error: 'Server error' });
  }
};
