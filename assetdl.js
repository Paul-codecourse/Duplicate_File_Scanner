const https = require('https');
const fs = require('fs');
const path = require('path');

const ASSETS_DIR = path.join(__dirname, 'assets');
const FILES = [
    {
        name: 'bootstrap.min.css',
        url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css'
    },
    {
        name: 'bootstrap.bundle.min.js',
        url: 'https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js'
    }
];

// Create assets directory if it doesn't exist
if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR);
    console.log('📁 Created /assets directory');
}

function downloadFile(file) {
    const filePath = path.join(ASSETS_DIR, file.name);
    const writeStream = fs.createWriteStream(filePath);

    https.get(file.url, (response) => {
        if (response.statusCode !== 200) {
            console.error(`❌ Failed to download ${file.name}: ${response.statusCode}`);
            return;
        }

        response.pipe(writeStream);

        writeStream.on('finish', () => {
            writeStream.close();
            console.log(`✅ Downloaded: ${file.name}`);
        });
    }).on('error', (err) => {
        console.error(`❌ Error downloading ${file.name}: ${err.message}`);
    });
}

console.log('🚀 Starting asset bundle creation...');
FILES.forEach(downloadFile);