const fs = require('fs').promises;
const { existsSync, createReadStream } = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCAN_PATH = process.argv[2];
const EXTENSIONS_INPUT = process.argv[3]; 

const ALLOWED_EXTENSIONS = EXTENSIONS_INPUT 
    ? new Set(EXTENSIONS_INPUT.split(',').map(ext => `.${ext.toLowerCase().trim()}`))
    : null;

if (!SCAN_PATH) {
    console.error("❌ Error: Please provide a folder path.");
    console.log("Usage: node duplicateChecker.js <path> [extensions]");
    process.exit(1);
}

const OUTPUT_FILE = 'duplicates_report.csv';
const ERRORS_FILE = 'skipped_items.log'; // NEW: The log file for skipped items
const PARTIAL_SIZE = 16384; 

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

// Updated walk function to track skipped items
async function walk(dir, fileList = [], skippedItems = []) {
    try {
        const files = await fs.readdir(dir);
        for (const file of files) {
            const filePath = path.join(dir, file);
            try {
                const stat = await fs.stat(filePath);
                if (stat.isDirectory()) {
                    await walk(filePath, fileList, skippedItems);
                } else {
                    const ext = path.extname(file).toLowerCase();
                    if (ALLOWED_EXTENSIONS && !ALLOWED_EXTENSIONS.has(ext)) continue;

                    fileList.push({
                        name: file,
                        path: filePath,
                        size: stat.size,
                        created: stat.birthtime.toISOString()
                    });
                }
            } catch (e) {
                // Log files we can't 'stat' (access)
                skippedItems.push(`FILE ACCESS DENIED: ${filePath}`);
            }
        }
    } catch (e) {
        // Log folders we can't 'readdir' (open)
        skippedItems.push(`FOLDER ACCESS DENIED: ${dir}`);
    }
    return { fileList, skippedItems };
}

async function findDuplicates() {
    console.log(`🚀 Scanning: ${path.resolve(SCAN_PATH)}`);
    
    // Capture both the files found and the items skipped
    const { fileList, skippedItems } = await walk(SCAN_PATH);
    
    // --- Processing Logic (Size -> Partial Hash -> Full Hash) ---
    const sizeMap = new Map();
    fileList.forEach(f => {
        if (!sizeMap.has(f.size)) sizeMap.set(f.size, []);
        sizeMap.get(f.size).push(f);
    });

    const partialHashMap = new Map();
    for (const [size, files] of sizeMap) {
        if (files.length < 2) continue;
        for (const file of files) {
            try {
                const pHash = await getFileHash(file.path, PARTIAL_SIZE);
                const key = `${size}-${pHash}`;
                if (!partialHashMap.has(key)) partialHashMap.set(key, []);
                partialHashMap.get(key).push(file);
            } catch (e) {
                skippedItems.push(`HASHING FAILED (Partial): ${file.path}`);
            }
        }
    }

    const finalDuplicates = new Map();
    for (const [key, files] of partialHashMap) {
        if (files.length < 2) continue;
        for (const file of files) {
            try {
                const fullHash = await getFileHash(file.path);
                if (!finalDuplicates.has(fullHash)) finalDuplicates.set(fullHash, []);
                finalDuplicates.get(fullHash).push(file);
            } catch (e) {
                skippedItems.push(`HASHING FAILED (Full): ${file.path}`);
            }
        }
    }

    // --- File Generation ---
   
    // 1. Save the Duplicate Report (CSV)
    let csvContent = "Filename,Date Created,Size (Bytes),Folder,Full Path\n";
    let sets = 0;
    for (const [hash, files] of finalDuplicates) {
        if (files.length > 1) {
            sets++;
            files.forEach(f => {
                const folder = path.dirname(f.path).replace(/"/g, '""');
                csvContent += `"${f.name.replace(/"/g, '""')}","${f.created}","${f.size}","${folder}","${f.path}"\n`;
            });
        }
    }

    if (sets > 0) {
        await fs.writeFile(OUTPUT_FILE, csvContent);
        console.log(`✅ Done! Duplicate report saved to ${OUTPUT_FILE}`);
    } else {
        console.log("✨ No identical files found.");
    }

    // 2. Save the Skipped Items Log (TXT)
    if (skippedItems.length > 0) {
        await fs.writeFile(ERRORS_FILE, skippedItems.join('\n'));
        console.log(`⚠️  Warning: ${skippedItems.length} items were skipped. See ${ERRORS_FILE} for details.`);
    }
}

findDuplicates();