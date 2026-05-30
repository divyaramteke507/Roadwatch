# RoadWatch -- Citizen Infrastructure Reporting Portal

RoadWatch is a full-stack web application that enables Indian citizens to report infrastructure damage through a secure, AI-assisted workflow. The platform combines multi-factor biometric authentication with Google Gemini Vision AI to automatically classify and assess reported damage from uploaded photographs.

**Live Demo:** [https://roadwatch-eta.vercel.app](https://roadwatch-eta.vercel.app)

---

## Table of Contents

- [Features](#features)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Local Development Setup](#local-development-setup)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [Authentication Flow](#authentication-flow)
- [API Endpoints](#api-endpoints)
- [Security](#security)
- [License](#license)

---

## Features

- **Secure Citizen Authentication** -- Email OTP verification via Clerk, followed by mandatory camera-based biometric liveness detection
- **AI Damage Classification** -- Gemini Vision API automatically categorizes reported issues (potholes, waterlogging, bridge damage, etc.) and assigns severity levels from uploaded photographs
- **GIS Location Mapping** -- Leaflet-based interactive map with GPS auto-detection for precise geolocation of reported damage
- **Session Management** -- One-hour session timeout with automatic forced logout and route guarding across all pages
- **Accessibility Controls** -- Built-in font scaling and high-contrast mode toggle for inclusive access
- **Citizen Feedback System** -- Integrated feedback form with direct email delivery via EmailJS
- **Responsive Design** -- Fully optimized for mobile, tablet, and desktop viewports

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Authentication | Clerk (Email OTP) |
| Biometric Verification | MediaDevices API (Camera Liveness) |
| AI Vision | Google Gemini Flash API |
| Maps | Leaflet.js with OpenStreetMap |
| Backend (Local) | Node.js, Express.js |
| Backend (Production) | Vercel Serverless Functions |
| Database (Local) | SQLite3 via better-sqlite3 |
| Email Service | EmailJS |
| Deployment | Vercel |

---

## Project Structure

```
RoadWatch/
├── index.html              # Landing page
├── login.html              # Clerk email OTP authentication
├── face.html               # Camera biometric liveness verification
├── success.html            # Authentication success confirmation
├── main.html               # Citizen dashboard (report, profile, FAQs)
├── Ashok_Stambh.png        # National emblem asset
├── package.json            # Root dependencies
├── vercel.json             # Vercel routing and header configuration
├── api/
│   └── gemini-analyze.js   # Vercel serverless Gemini Vision proxy
└── server/
    ├── server.js           # Express backend for local development
    ├── package.json        # Server dependencies
    ├── .env                # Local environment variables (not committed)
    └── .env.example        # Environment variable template
```

---

## Prerequisites

- Node.js 18.x or later
- npm 9.x or later
- A Google AI Studio API key (for Gemini Vision)
- A Clerk account and publishable key (for authentication)

---

## Local Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/divyaramteke507/Roadwatch.git
   cd Roadwatch
   ```

2. **Install server dependencies**

   ```bash
   cd server
   npm install
   ```

3. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Edit `server/.env` and fill in the required values:

   ```env
   SECRET_KEY=your-secret-key
   PORT=3000
   GEMINI_API_KEY=your-google-ai-studio-key
   ```

4. **Start the development server**

   ```bash
   node server.js
   ```

5. **Open the application**

   Navigate to `http://localhost:3000` in your browser.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | Yes | Server-side secret for session management |
| `PORT` | No | Server port (defaults to 3000) |
| `GEMINI_API_KEY` | Yes | Google AI Studio API key for Gemini Vision |

For Vercel deployment, set `GEMINI_API_KEY` in the Vercel Dashboard under Settings > Environment Variables.

---

## Deployment

The application is configured for zero-config deployment on Vercel:

1. Connect your GitHub repository to Vercel
2. Set the `GEMINI_API_KEY` environment variable in the Vercel Dashboard
3. Deploy -- Vercel automatically serves static HTML files and routes API calls to the serverless function in `api/gemini-analyze.js`

The `vercel.json` configuration handles URL rewrites so that `/api/gemini/analyze` is routed to the serverless function.

---

## Authentication Flow

```
Login (Email OTP via Clerk)
    |
    v
Biometric Liveness Check (Camera)
    |
    v
Success Page (Session Initialized)
    |
    v
Dashboard (Route-Guarded, 1-Hour Timeout)
```

Each page enforces route guards. Users cannot skip steps or access the dashboard without completing the full authentication chain. Session data is stored in `sessionStorage` and expires after one hour.

---

## API Endpoints

### POST /api/gemini/analyze

Accepts a base64-encoded image and returns AI-generated damage classification.

**Request Body:**

```json
{
  "base64Image": "<base64-encoded-image-data>",
  "mimeType": "image/jpeg"
}
```

**Response:**

```json
{
  "success": true,
  "result": {
    "category": "Pothole",
    "severity": "High",
    "description": "A large pothole filled with water on an asphalt road surface.",
    "confidence": "94%"
  },
  "model": "v1beta/gemini-2.5-flash"
}
```

The endpoint uses a fallback model chain, trying multiple Gemini models in order of preference to ensure reliability.

---

## Security

- API keys are never exposed to the client. All Gemini API calls are proxied through the server
- Route guards prevent unauthorized page access
- Session timeout enforces re-authentication after one hour
- CORS headers and security headers (X-Content-Type-Options, X-Frame-Options) are configured via `vercel.json`
- The `.gitignore` is configured to exclude `.env`, `node_modules`, and other sensitive files

---

## License

This project is developed for educational and demonstration purposes.
