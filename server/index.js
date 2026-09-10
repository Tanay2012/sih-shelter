require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');
const Simulation = require('./models/Simulation');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

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
    const pyProcess = spawn('python', [
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