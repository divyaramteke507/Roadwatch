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
    // GET /api/user/:email or /api/auth?action=getuser&email=xxx
    if (method === 'GET') {
      const email = req.query.email;
      const phone = req.query.phone;
      const identifier = email || phone;
      if (!identifier) return res.status(400).json({ error: 'Email or phone required' });
      
      let user = null;
      for (const [key, u] of Object.entries(users)) {
        if (u.email === identifier || key === identifier) {
          user = u;
          break;
        }
      }
      
      if (user) {
        return res.json({ 
          exists: true, 
          hasDescriptor: !!user.descriptor, 
          user: { 
            id: user.id, 
            firstName: user.firstName, 
            lastName: user.lastName, 
            email: user.email, 
            phone: user.phoneNumber 
          } 
        });
      }
      return res.json({ exists: false });
    }

    // POST actions
    if (method === 'POST') {
      const { 
        action, 
        firstName, 
        lastName, 
        email, 
        phoneNumber, 
        descriptor, 
        phone, 
        loginTime, 
        location,
        faceImage
      } = req.body || {};

      if (action === 'register') {
        if (!firstName || !lastName || !email || !phoneNumber) return res.status(400).json({ error: 'Missing fields' });
        
        // Check for duplicate email
        let emailExists = false;
        for (const [key, u] of Object.entries(users)) {
          if (u.email === email) {
            emailExists = true;
            break;
          }
        }
        if (emailExists) {
          return res.status(409).json({ error: 'EMAIL_EXISTS', message: 'Email already exists' });
        }
        
        // Check for duplicate phone
        if (users[phoneNumber]) {
          return res.status(409).json({ error: 'PHONE_EXISTS', message: 'Phone number already exists' });
        }
        
        users[phoneNumber] = {
          firstName,
          lastName,
          email,
          phoneNumber,
          createdAt: new Date().toISOString()
        };
        return res.json({ success: true });
      }

      if (action === 'face_register') {
        if (!email || !phoneNumber || !descriptor) return res.status(400).json({ error: 'Missing data' });
        
        // Duplicate face check
        for (const [ph, u] of Object.entries(users)) {
          if (u.email !== email && u.descriptor) {
            try {
              const existing = decrypt(u.descriptor);
              if (eucDist(descriptor, existing) < 0.5) {
                return res.status(409).json({ error: 'DUPLICATE_FACE', message: 'Face already registered with another account' });
              }
            } catch(e) {}
          }
        }
        
        users[phoneNumber] = users[phoneNumber] || {};
        users[phoneNumber].descriptor = encrypt(descriptor);
        users[phoneNumber].latestFaceImage = faceImage || null;
        users[phoneNumber].updatedAt = new Date().toISOString();
        return res.json({ success: true, message: 'Biometric identity registered' });
      }

      if (action === 'face_verify') {
        if (!email || !descriptor) return res.status(400).json({ error: 'Missing data' });
        
        let user = null;
        for (const [key, u] of Object.entries(users)) {
          if (u.email === email) {
            user = u;
            break;
          }
        }
        
        if (!user || !user.descriptor) return res.status(404).json({ error: 'No biometric record found' });
        
        const stored = decrypt(user.descriptor);
        const dist = eucDist(descriptor, stored);
        if (dist < 0.5) {
          // Update with new descriptor, face image, last login, and session history
          user.descriptor = encrypt(descriptor);
          user.latestFaceImage = faceImage || null;
          user.lastLogin = new Date().toISOString();
          user.sessionHistory = user.sessionHistory || [];
          user.sessionHistory.unshift({ timestamp: new Date().toISOString(), type: 'login' });
          if (user.sessionHistory.length > 10) user.sessionHistory = user.sessionHistory.slice(0, 10);
          user.updatedAt = new Date().toISOString();
          
          return res.json({ 
            success: true, 
            verified: true, 
            distance: dist, 
            user: { 
              firstName: user.firstName, 
              lastName: user.lastName, 
              email: user.email, 
              phone: user.phoneNumber 
            }, 
            loginTime: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) 
          });
        }
        return res.json({ success: false, verified: false, distance: dist, message: 'Face does not match' });
      }

      if (action === 'sms_alert') {
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
};
