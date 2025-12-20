const fs = require('fs').promises;
const { existsSync, createReadStream } = require('fs');
const path = require('path');
const crypto = require('crypto');

// 1. Grab and Validate the Scan Path
const SCAN_PATH = process.argv[2];

if (!SCAN_PATH) {
    console.error("❌ Error: Please provide a folder path.");
    console.log("Usage: node duplicateChecker.js <path_to_folder>");
    process.exit(1);
}

if (!existsSync(SCAN_PATH)) {
    console.error(`❌ Error: The path "${SCAN_PATH}" does not exist.`);
    process.exit(1);
}

// CONFIGURATION
const OUTPUT_FILE = 'duplicates_report.csv';
const PARTIAL_SIZE = 16384; // 16KB for the first-pass check

/**
 * Generates a hash for a file. 
 * Reads the whole file unless bytesToRead is specified.
 */
function getFileHash(filePath, bytesToRead = null) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const options = bytesToRead ? { start: 0, end: bytesToRead - 1 } : {};
        const stream = createReadStream(filePath, options);

        stream.on('data', (data) => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', (err) => reject(err));
    });
}

/**
 * Recursively explores folders to find all files.
 */
async function walk(dir, fileList = []) {
    try {
        const files = await fs.readdir(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            try {
                const stat = await fs.stat(filePath);
                if (stat.isDirectory()) {
                    await walk(filePath, fileList);
                } else {
                    fileList.push({
                        name: file,
                        path: filePath,
                        size: stat.size,
                        created: stat.birthtime.toISOString()
                    });
                }
            } catch (e) {
                console.warn(`⚠️ Skipping ${filePath}: Access Denied`);
            }
        }
    } catch (e) {
        console.warn(`⚠️ Cannot read directory ${dir}: Access Denied`);
    }
    return fileList;
}

/**
 * Main Logic: Size -> Partial Hash -> Full Hash
 */
async function findDuplicates() {
    console.log(`🚀 Starting scan on: ${path.resolve(SCAN_PATH)}`);
    const allFiles = await walk(SCAN_PATH);
    console.log(`total files found: ${allFiles.length}`);

    // STEP 1: Group by Size
    const sizeMap = new Map();
    allFiles.forEach(f => {
        if (!sizeMap.has(f.size)) sizeMap.set(f.size, []);
        sizeMap.get(f.size).push(f);
    });

    // STEP 2: Partial Hash (Check the first 16KB of size-matched files)
    console.log("🔍 Checking partial hashes for size matches...");
    const partialHashMap = new Map();
    for (const [size, files] of sizeMap) {
        if (files.length < 2) continue;
        for (const file of files) {
            try {
                const pHash = await getFileHash(file.path, PARTIAL_SIZE);
                const key = `${size}-${pHash}`;
                if (!partialHashMap.has(key)) partialHashMap.set(key, []);
                partialHashMap.get(key).push(file);
            } catch (e) { /* skip unreadable files */ }
        }
    }

    // STEP 3: Full Hash (Deep verification)
    console.log("🧪 Verifying full content for final candidates...");
    const finalDuplicates = new Map();
    for (const [key, files] of partialHashMap) {
        if (files.length < 2) continue;
        for (const file of files) {
            try {
                const fullHash = await getFileHash(file.path);
                if (!finalDuplicates.has(fullHash)) finalDuplicates.set(fullHash, []);
                finalDuplicates.get(fullHash).push(file);
            } catch (e) { /* skip */ }
        }
    }

    // STEP 4: Generate CSV
    let csvContent = "Filename,Date Created,Size (Bytes),Folder,Full Path\n";
    let duplicateSets = 0;

    for (const [hash, files] of finalDuplicates) {
        if (files.length > 1) {
            duplicateSets++;
            files.forEach(f => {
                const folder = path.dirname(f.path).replace(/"/g, '""');
                const safeName = f.name.replace(/"/g, '""');
                csvContent += `"${safeName}","${f.created}","${f.size}","${folder}","${f.path}"\n`;
            });
        }
    }

    if (duplicateSets > 0) {
        await fs.writeFile(OUTPUT_FILE, csvContent);
        console.log(`✅ Success! Found ${duplicateSets} sets of identical files.`);
        console.log(`📄 Report saved to: ${OUTPUT_FILE}`);
    } else {
        console.log("✨ No identical files found.");
    }
}

findDuplicates().catch(err => console.error("🛑 Critical Error:", err));
