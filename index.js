const express = require('express');
const cors = require('cors');
const { instagramGetUrl } = require('instagram-url-direct');
const instaPriyansh = require('priyansh-ig-downloader');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = 3000; // Changed to 3000 to avoid conflicts

app.use(cors());
app.use(express.json());

// DIAGNOSTIC LOGGING
console.log('--- Server Diagnostics ---');
console.log('Current Directory:', __dirname);
const publicPath = path.join(__dirname, 'public');
console.log('Public Folder Path:', publicPath);
const indexHtmlPath = path.join(publicPath, 'index.html');
console.log('Index HTML Path:', indexHtmlPath);

const fs = require('fs');
if (fs.existsSync(indexHtmlPath)) {
    console.log('SUCCESS: index.html exists');
} else {
    console.error('ERROR: index.html NOT FOUND at', indexHtmlPath);
}
console.log('--------------------------');

// Request Logging Middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    next();
});

app.use(express.static(publicPath));

// Serve the frontend explicitly
app.get('/', (req, res) => {
    console.log('Serving index.html for root request');
    res.sendFile(indexHtmlPath);
});

// Status check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Instagram Downloader API is running' });
});

// Helper function to extract media using multiple libraries
async function extractMedia(url) {
    let errors = [];

    // Method 1: instagram-url-direct (Good for Posts/Reels)
    try {
        console.log('Attempting Method 1 (instagram-url-direct)...');
        const data = await instagramGetUrl(url);
        if (data && data.media_details && data.media_details.length > 0) {
            console.log('Method 1 (detailed) Success');
            return data.media_details.map(m => ({
                url: m.url,
                type: m.type,
                thumbnail: m.thumbnail
            }));
        } else if (data && data.url_list && data.url_list.length > 0) {
            console.log('Method 1 (legacy) Success');
            return data.url_list.map(link => ({
                url: link,
                type: (link.includes('.mp4') || link.includes('.m4v') || link.includes('video')) ? 'video' : 'image'
            }));
        }
    } catch (e) {
        console.error('Method 1 failed:', e.message);
        errors.push(`Method 1: ${e.message}`);
    }

    // Method 2: priyansh-ig-downloader (Fallback)
    try {
        console.log('Attempting Method 2 (priyansh-ig-downloader)...');
        const data = await instaPriyansh(url);
        if (data) {
            const media = [];
            if (data.video) data.video.forEach(v => media.push({ type: 'video', url: v.video, thumbnail: v.thumbnail }));
            if (data.image) data.image.forEach(i => media.push({ type: 'image', url: i.image }));

            if (media.length > 0) {
                console.log('Method 2 Success');
                return media;
            }
        }
    } catch (e) {
        console.error('Method 2 failed:', e.message);
        errors.push(`Method 2: ${e.message}`);
    }

    throw new Error(`All extraction methods failed. ${errors.join(' | ')}`);
}

// API route to get Instagram media
app.post('/api/download', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        console.log(`Processing URL: ${url}`);
        const media = await extractMedia(url);

        res.json({
            success: true,
            media: media
        });
    } catch (error) {
        console.error('Extraction Error:', error);
        res.status(500).json({
            error: 'Failed to extract media. This can happen if the link is private, invalid, or if Instagram is blocking the request.',
            details: error.message
        });
    }
});

// Proxy endpoint to bypass CORS and referer checks
app.get('/api/proxy', async (req, res) => {
    const { url, dl } = req.query;
    if (!url) return res.status(400).send('URL is required');

    try {
        console.log(`Proxying: ${url.substring(0, 100)}... (Download: ${dl ? 'Yes' : 'No'})`);
        const response = await axios({
            method: 'get',
            url: url,
            responseType: 'stream',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
                'Referer': 'https://www.instagram.com/',
                'Origin': 'https://www.instagram.com'
            }
        });

        // Forward content headers
        if (response.headers['content-type']) {
            res.setHeader('Content-Type', response.headers['content-type']);
        }

        // Force download if dl parameter is present
        if (dl) {
            const ext = response.headers['content-type']?.includes('video') ? 'mp4' : 'jpg';
            res.setHeader('Content-Disposition', `attachment; filename="insta_media_${Date.now()}.${ext}"`);
        }

        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }

        // Handle stream errors
        response.data.on('error', (err) => {
            console.error('Stream Error:', err.message);
            res.end();
        });

        response.data.pipe(res);
    } catch (error) {
        console.error('Proxy Request Failed:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            res.status(error.response.status).send(`Failed to fetch media from Instagram (Status: ${error.response.status})`);
        } else {
            res.status(500).send(`Failed to connect to media server: ${error.message}`);
        }
    }
});

// Root handler for the /api route itself
app.get('/api', (req, res) => {
    res.json({ message: 'Welcome to the InstaSnap API. Use /api/download and /api/proxy' });
});


// Catch-all for diagnostics
app.use((req, res) => {
    console.error(`404 - Not Found: ${req.method} ${req.url}`);
    res.status(404).send(`Cannot ${req.method} ${req.path} (Diagnostic: Server is running on port ${PORT})`);
});

app.listen(PORT, () => {
    console.log(`\n>>> SUCCESS! Your server is running at http://localhost:${PORT}`);
    console.log('>>> Open that link in your browser to test.\n');
});
