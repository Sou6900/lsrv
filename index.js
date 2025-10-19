// index.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const DEFAULT_PORT = 8080; // Acode plugin eo ei port use korte hobe

// --- Middleware ---
app.use(cors());       // Allow requests from Acode preview
app.use(express.json()); // To parse { "directoryPath": "..." }

// --- State ---
let currentServePath = null;    // Stores the path Acode plugin sends
let staticMiddleware = null;    // Holds the actual express.static middleware

// --- Function to update the static serving middleware ---
function updateStaticServer(directoryPath) {
    if (!directoryPath) {
        console.log("No directory path provided. Static serving disabled.");
        staticMiddleware = (req, res, next) => {
            res.status(503).send("Server not configured. Send path via PATCH /setup.");
        };
        currentServePath = null;
        return false; // Indicate failure or no setup
    }

    try {
        const absolutePath = path.resolve(directoryPath); // Make path absolute
        // Check if directory exists and is accessible
        const stats = fs.statSync(absolutePath);
        if (!stats.isDirectory()) {
            console.error(`Error: Path is not a directory: ${absolutePath}`);
            staticMiddleware = (req, res, next) => {
                res.status(404).send(`Configured path is not a directory: ${directoryPath}`);
            };
            currentServePath = null;
            return false; // Indicate failure
        }

        console.log(`Setting up static server for: ${absolutePath}`);
        staticMiddleware = express.static(absolutePath, {
            dotfiles: 'ignore', // Ignore files like .git
            index: ['index.html', 'index.htm'] // Default files
        });
        currentServePath = absolutePath; // Store the successfully configured path
        return true; // Indicate success

    } catch (err) {
        console.error(`Error setting up static server for ${directoryPath}:`, err);
        staticMiddleware = (req, res, next) => {
            res.status(404).send(`Error accessing directory: ${directoryPath}. Check path and permissions.`);
        };
        currentServePath = null;
        return false; // Indicate failure
    }
}

// --- API Endpoint for Acode Plugin ---
app.patch('/setup', (req, res) => {
    const { directoryPath } = req.body;
    console.log("Received PATCH /setup with path:", directoryPath);

    if (!directoryPath) {
        return res.status(400).json({ error: 'directoryPath is required in body' });
    }

    const success = updateStaticServer(directoryPath);

    if (success) {
        res.status(200).json({ message: `Server now serving: ${currentServePath}` });
    } else {
        res.status(400).json({ error: `Failed to set directory: ${directoryPath}. Check logs.` });
    }
});

// --- Dynamic Middleware ---
// This middleware calls the *current* staticMiddleware handler
app.use((req, res, next) => {
    if (staticMiddleware) {
        staticMiddleware(req, res, next);
    } else {
        // Should be handled by initial updateStaticServer(null)
        next();
    }
});

// --- Basic 404 Handler (if static middleware doesn't find the file) ---
app.use((req, res) => {
    if (currentServePath) {
        res.status(404).send(`File not found in served directory: ${req.path}`);
    } else {
        // If not configured, the staticMiddleware handler should have already responded.
        // This is a fallback.
        res.status(404).send("Server not configured or file not found.");
    }
});

// --- Start Server ---
const server = app.listen(DEFAULT_PORT, '127.0.0.1', () => {
    console.log(`Node.js Live Server backend listening on http://127.0.0.1:${DEFAULT_PORT}`);
    console.log('Waiting for Acode plugin to configure via PATCH /setup...');
    // Initialize static middleware to the "not configured" state
    updateStaticServer(null);
});

// --- Error Handling (e.g., Port in use) ---
server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Error: Port ${DEFAULT_PORT} is already in use.`);
        // Note: Automatic port finding is more complex in Node than the Python example.
        // For now, it will just fail. You might need to kill the process using the port.
        process.exit(1); // Exit if port is busy
    } else {
        console.error('Server error:', error);
    }
});
