const fs = require('fs').promises;
const { existsSync, createReadStream } = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

// 1. Grab Arguments
const INPUT_PATHS = process.argv[2]; // Accepts "C:\,D:\,E:\"
const EXTENSIONS_INPUT = process.argv[3]; 

if (!INPUT_PATHS) {
    console.error("❌ Error: Please provide at least one folder path.");
    console.log("Usage: node duplicateChecker.js C:\,D:\ [extensions]");
    process.exit(1);
}

// Convert input string into an array of validated paths
const SCAN_PATHS = INPUT_PATHS.split(',').map(p => p.trim()).filter(p => {
    if (existsSync(p)) return true;
    console.warn(`⚠️ Warning: Path does not exist and will be skipped: ${p}`);
    return false;
});

const hostname = os.hostname();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
// Create a label for the report based on the number of drives
const pathLabel = SCAN_PATHS.length > 1 ? `MultiDrive_${SCAN_PATHS.length}` : SCAN_PATHS[0].replace(/[^a-z0-9]/gi, '_').slice(-20);

const OUTPUT_FILE = `duplicates_${hostname}_${timestamp}_${pathLabel}.csv`;
const ERRORS_FILE = `skipped_${hostname}_${timestamp}_${pathLabel}.log`;

const ALLOWED_EXTENSIONS = EXTENSIONS_INPUT 
    ? new Set(EXTENSIONS_INPUT.split(',').map(ext => `.${ext.toLowerCase().trim()}`))
    : null;

const PARTIAL_SIZE = 16384; 
let filesFoundCount = 0;

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
                    process.stdout.write(`\r📂 Scanning... Found ${filesFoundCount} files total`);

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
    console.log(`🚀 Starting Multi-Path Scan on: ${hostname}`);
    SCAN_PATHS.forEach(p => console.log(`   - ${path.resolve(p)}`));

    let masterFileList = [];
    let masterSkippedList = [];

    // Loop through every drive/folder provided
    for (const rootPath of SCAN_PATHS) {
        const { fileList, skippedItems } = await walk(rootPath);
        masterFileList = masterFileList.concat(fileList);
        masterSkippedList = masterSkippedList.concat(skippedItems);
    }
    process.stdout.write('\n');

    // --- STEP 1: Filter by Size ---
    const sizeMap = new Map();
    masterFileList.forEach(f => {
        if (!sizeMap.has(f.size)) sizeMap.set(f.size, []);
        sizeMap.get(f.size).push(f);
    });

    const potentialMatches = Array.from(sizeMap.values()).filter(group => group.length > 1).flat();
    
    if (potentialMatches.length === 0) {
        console.log("✨ No potential duplicates across specified paths.");
        return;
    }

    // --- STEP 2: Partial Hashing ---
    console.log(`🔍 Checking ${potentialMatches.length} candidates via Partial Hash...`);
    const partialHashMap = new Map();
    let pCount = 0;
    for (const file of potentialMatches) {
        pCount++;
        process.stdout.write(`\r   Progress: ${Math.floor((pCount/potentialMatches.length)*100)}%`);
        try {
            const pHash = await getFileHash(file.path, PARTIAL_SIZE);
            const key = `${file.size}-${pHash}`;
            if (!partialHashMap.has(key)) partialHashMap.set(key, []);
            partialHashMap.get(key).push(file);
        } catch (e) {
            masterSkippedList.push(`HASHING FAILED (Partial): ${file.path}`);
        }
    }
    process.stdout.write('\n');

    // --- STEP 3: Full Hashing ---
    const finalCandidates = Array.from(partialHashMap.values()).filter(group => group.length > 1).flat();
    const finalDuplicates = new Map();
    if (finalCandidates.length > 0) {
        console.log(`🧪 Verifying ${finalCandidates.length} final candidates...`);
        let fCount = 0;
        for (const file of finalCandidates) {
            fCount++;
            process.stdout.write(`\r   Progress: ${Math.floor((fCount/finalCandidates.length)*100)}%`);
            try {
                const fullHash = await getFileHash(file.path);
                if (!finalDuplicates.has(fullHash)) finalDuplicates.set(fullHash, []);
                finalDuplicates.get(fullHash).push(file);
            } catch (e) {
                masterSkippedList.push(`HASHING FAILED (Full): ${file.path}`);
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
        console.log(`✅ Success: ${sets} sets found. Report: ${OUTPUT_FILE}`);
    } else {
        console.log("✨ Final verification complete: No duplicates found.");
    }

    if (masterSkippedList.length > 0) {
        await fs.writeFile(ERRORS_FILE, masterSkippedList.join('\n'));
        console.log(`⚠️  ${masterSkippedList.length} items skipped. Log: ${ERRORS_FILE}`);
    }
}

findDuplicates();