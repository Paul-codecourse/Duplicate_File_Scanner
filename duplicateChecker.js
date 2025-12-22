const fs = require('fs').promises;
const { existsSync, createReadStream } = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const SCAN_PATH = process.argv[2];
const EXTENSIONS_INPUT = process.argv[3]; 

if (!SCAN_PATH) {
    console.error("❌ Error: Please provide a folder path.");
    console.log("Usage: node duplicateChecker.js <path> [extensions]");
    process.exit(1);
}

// Dynamic Filename Generation
const hostname = os.hostname();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const pathSlug = path.resolve(SCAN_PATH).replace(/[^a-z0-9]/gi, '_').slice(-30); 

const OUTPUT_FILE = `duplicates_${hostname}_${timestamp}_${pathSlug}.csv`;
const ERRORS_FILE = `skipped_${hostname}_${timestamp}_${pathSlug}.log`;

const ALLOWED_EXTENSIONS = EXTENSIONS_INPUT 
    ? new Set(EXTENSIONS_INPUT.split(',').map(ext => `.${ext.toLowerCase().trim()}`))
    : null;

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

// Counters for the Scan Phase
let filesFoundCount = 0;

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

                    filesFoundCount++;
                    // Update the terminal line without creating a new one
                    process.stdout.write(`\r📂 Scanning... Found ${filesFoundCount} files`);

                    fileList.push({
                        name: file,
                        path: filePath,
                        size: stat.size,
                        created: stat.birthtime.toISOString()
                    });
                }
            } catch (e) {
                skippedItems.push(`FILE ACCESS DENIED: ${filePath}`);
            }
        }
    } catch (e) {
        skippedItems.push(`FOLDER ACCESS DENIED: ${dir}`);
    }
    return { fileList, skippedItems };
}

async function findDuplicates() {
    console.log(`🚀 Starting Scan on ${hostname} at ${path.resolve(SCAN_PATH)}`);
    
    const { fileList, skippedItems } = await walk(SCAN_PATH);
    process.stdout.write('\n'); // Move to next line after scan completes

    // --- STEP 1: Filter by Size ---
    const sizeMap = new Map();
    fileList.forEach(f => {
        if (!sizeMap.has(f.size)) sizeMap.set(f.size, []);
        sizeMap.get(f.size).push(f);
    });

    const potentialMatches = Array.from(sizeMap.values()).filter(group => group.length > 1).flat();
    
    if (potentialMatches.length === 0) {
        console.log("✨ No potential duplicates based on file size.");
        return;
    }

    // --- STEP 2: Partial Hashing ---
    console.log(`🔍 Checking ${potentialMatches.length} candidates via Partial Hash...`);
    const partialHashMap = new Map();
    let pCount = 0;

    for (const file of potentialMatches) {
        pCount++;
        const percent = Math.floor((pCount / potentialMatches.length) * 100);
        process.stdout.write(`\r   Progress: ${percent}% (${pCount}/${potentialMatches.length})`);
        
        try {
            const pHash = await getFileHash(file.path, PARTIAL_SIZE);
            const key = `${file.size}-${pHash}`;
            if (!partialHashMap.has(key)) partialHashMap.set(key, []);
            partialHashMap.get(key).push(file);
        } catch (e) {
            skippedItems.push(`HASHING FAILED (Partial): ${file.path}`);
        }
    }
    process.stdout.write('\n');

    // --- STEP 3: Full Hashing ---
    const finalCandidates = Array.from(partialHashMap.values()).filter(group => group.length > 1).flat();
    
    const finalDuplicates = new Map();
    if (finalCandidates.length > 0) {
        console.log(`🧪 Verifying ${finalCandidates.length} identical candidates via Full Hash...`);
        let fCount = 0;

        for (const file of finalCandidates) {
            fCount++;
            const percent = Math.floor((fCount / finalCandidates.length) * 100);
            process.stdout.write(`\r   Progress: ${percent}% (${fCount}/${finalCandidates.length})`);

            try {
                const fullHash = await getFileHash(file.path);
                if (!finalDuplicates.has(fullHash)) finalDuplicates.set(fullHash, []);
                finalDuplicates.get(fullHash).push(file);
            } catch (e) {
                skippedItems.push(`HASHING FAILED (Full): ${file.path}`);
            }
        }
        process.stdout.write('\n');
    }

    // --- Output Generation ---
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
        console.log(`✅ Success: ${sets} duplicate sets found. Report: ${OUTPUT_FILE}`);
    } else {
        console.log("✨ Final verification complete: No bit-for-bit duplicates found.");
    }

    if (skippedItems.length > 0) {
        await fs.writeFile(ERRORS_FILE, skippedItems.join('\n'));
        console.log(`⚠️  ${skippedItems.length} items were skipped. Log: ${ERRORS_FILE}`);
    }
}

findDuplicates();