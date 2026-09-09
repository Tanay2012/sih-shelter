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

app.get('/', (req, res) => {
    res.send('SIH Shelter Simulation API is successfully running! 🚀');
});
// ==========================================
// 1. DATABASE CONNECTION
// ==========================================
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB Atlas Connected successfully'))
    .catch((err) => console.error('❌ MongoDB Connection Error:', err));

// ==========================================
// 2. MATERIAL LIBRARY API
// ==========================================
const materialLibrary = {
    "adobe_mud": { name: "Adobe / Mud Brick", k: 0.60, rho: 1700, cp: 840 },
    "aerogel_puf": { name: "Aerogel / PUF Panel", k: 0.024, rho: 35, cp: 1400 },
    "concrete": { name: "Dense Concrete", k: 1.40, rho: 2400, cp: 840 },
    "rammed_earth": { name: "Rammed Earth", k: 1.25, rho: 1500, cp: 900 },
    "pcm_paraffin": { name: "Phase Change Material", k: 0.20, rho: 800, cp: 2100 }
};

app.get('/api/materials', (req, res) => {
    res.json({ status: "success", data: materialLibrary });
});

// ==========================================
// 3. GET SIMULATION HISTORY API
// ==========================================
app.get('/api/history', async (req, res) => {
    try {
        // Fetch the 10 most recent simulations, sorted by newest first
        const history = await Simulation.find().sort({ runDate: -1 }).limit(10);
        res.json({ status: "success", data: history });
    } catch (error) {
        res.status(500).json({ status: "error", message: "Failed to fetch history" });
    }
});

// ==========================================
// 4. MAIN SIMULATION API
// ==========================================
app.post('/api/simulate', (req, res) => {
    const { geometry, materials, location } = req.body;

    if (!geometry || !materials || !location) {
        return res.status(400).json({ status: "error", message: "Missing required data." });
    }

    const inputParams = JSON.stringify(req.body);
    const pythonScript = path.join(__dirname, '../engine/simulator.py');
    const pyProcess = spawn('python', [pythonScript, inputParams]);

    let outputData = '';
    let errorData = '';

    pyProcess.stdout.on('data', (data) => { outputData += data.toString(); });
    pyProcess.stderr.on('data', (data) => { errorData += data.toString(); });

    pyProcess.on('close', async (code) => {
        if (code !== 0) {
            console.error("Python Error:", errorData);
            return res.status(500).json({ status: "error", message: "Simulation failed." });
        }
        
        try {
            const finalResult = JSON.parse(outputData);
            
            // --- NEW: SAVE TO DATABASE ---
            const newSimulation = new Simulation({
                inputs: { geometry, materials, location },
                results: {
                    timeSteps: finalResult.timeSteps,
                    ambientTemp: finalResult.ambientTemp,
                    insideTemp: finalResult.insideTemp,
                    solarIrradiance: finalResult.solarIrradiance,
                    energySummary: finalResult.energySummary
                }
            });
            await newSimulation.save();
            console.log("💾 Simulation saved to database!");
            
            // Send the response back to the frontend
            res.json(finalResult);
        } catch (error) {
            console.error("Parse/DB Error:", error);
            res.status(500).json({ status: "error", message: "Could not process or save output." });
        }
    });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Backend Simulation API running on http://localhost:${PORT}`);
});