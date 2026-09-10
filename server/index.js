require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { spawn } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const Simulation = require('./models/Simulation');

const app = express();
app.use(cors());
app.use(express.json());

// ── SESSION MIDDLEWARE ──────────────────────────────────────────────────────
app.use(session({
    secret: process.env.SESSION_SECRET || 'sih-shelter-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

// ── AUTH MIDDLEWARE (only guards the root / route) ──────────────────────────
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/login.html');
}

// ── AUTH ROUTES ─────────────────────────────────────────────────────────────
// Demo credentials (hardcoded – no database needed)
const DEMO_CREDENTIALS = [
    { email: 'engineer@ladakh.org', password: 'password123' }
];

app.post('/api/login', (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }
    const match = DEMO_CREDENTIALS.find(
        (c) => c.email === email.trim().toLowerCase() && c.password === password
    );
    if (!match) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }
    req.session.user = { email: match.email };
    return res.json({ success: true, message: 'Login successful.' });
});

app.get('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login.html');
    });
});

// ── PROTECTED ROOT ROUTE ────────────────────────────────────────────────────
// This MUST be registered before express.static so that GET / hits
// requireAuth before the static middleware can serve index.html directly.
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── STATIC FILES (served after the / guard; index:false prevents auto-serving
//    of index.html for GET / which would bypass auth)
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// 1. DATABASE CONNECTION
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('🟩 MongoDB Atlas Connected successfully'))
    .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// 2. MATERIAL LIBRARY API (If you have it)
// const materialLibrary = ...

// 3. SIMULATION & SAVE ROUTE
app.post('/api/simulate', (req, res) => {
    const payload = req.body;

    // Save simulation to MongoDB Atlas asynchronously
    const newSim = new Simulation(payload);
    newSim.save()
        .then(() => console.log("Simulation saved to database!"))
        .catch(err => console.error("Database Save Error:", err));

    // Spawn Python script for calculations
    // Smart OS detection: Uses 'python' on Windows, 'python3' on Render/Linux
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    
    // Spawn Python script for calculations
    const pyProcess = spawn(pythonCommand, [
        path.join(__dirname, '../engine/simulator.py'),
        JSON.stringify(payload)
    ]);

    let dataResult = '';
    let dataError = '';

    pyProcess.stdout.on('data', (chunk) => {
        dataResult += chunk.toString();
    });

    pyProcess.stderr.on('data', (chunk) => {
        dataError += chunk.toString();
    });

    pyProcess.on('close', (code) => {
        if (code !== 0) {
            console.error("Python Error:", dataError);
            return res.status(500).json({ error: "Simulation engine failed", details: dataError });
        }
        try {
            const parsed = JSON.parse(dataResult);
            res.json(parsed);
        } catch (error) {
            console.error("Parse/DB Error:", error);
            res.status(500).json({ status: "error", message: "Could not process or save output." });
        }
    });
});

// 4. HISTORY FETCH ROUTE (Fixed sorting to prevent crashes)
app.get('/api/history', async (req, res) => {
  try {
    const history = await Simulation.find().sort({ _id: -1 }).limit(10);
    res.json(history);
  } catch (error) {
    console.error("Database fetch error:", error);
    res.status(500).json({ error: 'Failed to fetch history from database' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Backend Simulation API running on http://localhost:${PORT}`);
});