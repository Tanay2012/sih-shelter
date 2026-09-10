require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcryptjs');
const { spawn } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const Simulation = require('./models/Simulation');
const User = require('./models/User');

const app = express();
app.use(cors());
app.use(express.json());

// Determine Mongo URI from environment variables with fallback
const mongoUrl = process.env.MONGO_URL || process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/sih-shelter';

// ── SESSION MIDDLEWARE ──────────────────────────────────────────────────────
app.use(session({
    secret: process.env.SESSION_SECRET || 'sih-shelter-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: mongoUrl,
        ttl: 8 * 60 * 60 // 8 hours
    }),
    cookie: { secure: false, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));

// ── AUTH MIDDLEWARE (guards protected routes like /dashboard) ────────────────
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/login.html');
}

// ── PUBLIC & PROTECTED PAGE ROUTES ──────────────────────────────────────────
// Unprotected Root Route: Serves the Project Overview Landing Page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'overview.html'));
});

// Auth Route Shortcut
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Protected Simulation Dashboard Route
app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── STATIC FILES (index: false prevents auto-serving index.html at /) ──────
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ── AUTH API ENDPOINTS ──────────────────────────────────────────────────────
const DEMO_CREDENTIALS = [
    { email: 'engineer@ladakh.org', password: 'password123' }
];

// POST /api/signup - Register new user in MongoDB
app.post('/api/signup', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required.' });
        }

        const cleanEmail = email.trim().toLowerCase();

        // Check if user already exists in MongoDB users collection
        const existingUser = await User.findOne({ email: cleanEmail });
        if (existingUser) {
            return res.status(400).json({ success: false, message: 'Email is already registered.' });
        }

        // Hash password with bcrypt
        const hashedPassword = await bcrypt.hash(password, 10);

        // Save new user
        const newUser = new User({
            email: cleanEmail,
            password: hashedPassword
        });
        await newUser.save();

        // Establish session on signup
        req.session.user = { id: newUser._id, email: newUser.email };
        return res.status(201).json({ success: true, message: 'Account created successfully.' });
    } catch (err) {
        console.error('Signup Error:', err);
        return res.status(500).json({ success: false, message: 'Server error during signup.' });
    }
});

// POST /api/login - Authenticate user against MongoDB
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required.' });
        }

        const cleanEmail = email.trim().toLowerCase();

        // Find user by email in MongoDB users collection
        const user = await User.findOne({ email: cleanEmail });
        if (user) {
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ success: false, message: 'Invalid email or password.' });
            }
            req.session.user = { id: user._id, email: user.email };
            return res.json({ success: true, message: 'Login successful.' });
        }

        // Fallback for demo credentials
        const match = DEMO_CREDENTIALS.find(
            (c) => c.email === cleanEmail && c.password === password
        );
        if (match) {
            req.session.user = { email: match.email };
            return res.json({ success: true, message: 'Login successful.' });
        }

        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    } catch (err) {
        console.error('Login Error:', err);
        return res.status(500).json({ success: false, message: 'Server error during login.' });
    }
});

// GET /api/logout - End session and redirect
app.get('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// ── DATABASE CONNECTION ─────────────────────────────────────────────────────
mongoose.connect(mongoUrl)
    .then(() => console.log('🟩 MongoDB Connected successfully'))
    .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// ── SIMULATION & SAVE ROUTE ─────────────────────────────────────────────────
app.post('/api/simulate', (req, res) => {
    const payload = req.body;

    // Save simulation to MongoDB Atlas asynchronously
    const newSim = new Simulation(payload);
    newSim.save()
        .then(() => console.log("Simulation saved to database!"))
        .catch(err => console.error("Database Save Error:", err));

    // Spawn Python script for calculations
    const pythonCommand = process.platform === 'win32' ? 'python' : 'python3';
    
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

// ── HISTORY FETCH ROUTE ─────────────────────────────────────────────────────
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