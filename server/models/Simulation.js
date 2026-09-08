// server/models/Simulation.js
const mongoose = require('mongoose');

const simulationSchema = new mongoose.Schema({
    runDate: { 
        type: Date, 
        default: Date.now 
    },
    inputs: {
        geometry: {
            length: Number,
            width: Number,
            height: Number,
            wallThickness: Number
        },
        materials: {
            k: Number,
            rho: Number,
            cp: Number
        },
        location: {
            latitude: Number,
            longitude: Number
        }
    },
    results: {
        timeSteps: [Number],
        ambientTemp: [Number],
        insideTemp: [Number],
        solarIrradiance: [Number],
        energySummary: {
            totalSolarKWh: Number,
            averageInsideTemp: Number
        }
    }
});

module.exports = mongoose.model('Simulation', simulationSchema);