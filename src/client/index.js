// src/client/index.js
const express = require('express');
const path = require('path');

const app = express();

// Serve static files from current directory
app.use(express.static(__dirname));

const PORT = 8000;
app.listen(PORT, () => {
    console.log(`Client server running on http://localhost:${PORT}`);
});