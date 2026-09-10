
const mongoose = require('mongoose');

const simulationSchema = new mongoose.Schema({
    // Flattened to match the frontend payload exactly
    geometry: {
        length: Number,
        width: Number,
        height: Number,
        wallThickness: Number
    },
    materials: {
        name: String, // Added this so the material name actually saves!
        k: Number,
        rho: Number,
        cp: Number
    },
    environment: {
        windSpeed: Number,
        highSnow: Boolean
    },
    location: {
        latitude: Number,
        longitude: Number
    },
    results: {
        type: Object,
        default: {}
    }
}, {
    timestamps: true, // Automatically creates 'createdAt' for the history sorting
    strict: false     // Acts as a fail-safe so Mongoose doesn't reject new variables
});

module.exports = mongoose.model('Simulation', simulationSchema);