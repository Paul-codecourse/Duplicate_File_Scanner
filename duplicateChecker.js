const fs = require('fs').promises;
const { existsSync, createReadStream } = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { performance } = require('perf_hooks');

const INPUT_PATHS = process.argv[2];
const EXTENSIONS_INPUT = process.argv[3]; 

if (!INPUT_PATHS) {
    console.error("❌ Error: Please provide at least one folder path.");
    process.exit(1);
}

const SCAN_PATHS = INPUT_PATHS.split(',').map(p => p.trim()).filter(p => existsSync(p));
const hostname = os.hostname();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const pathLabel = SCAN_PATHS.length > 1 ? `MultiDrive` : SCAN_PATHS[0].replace(/[^a-z0-9]/gi, '_').slice(-20);

const OUTPUT_FILE = `duplicates_${hostname}_${timestamp}_${pathLabel}.csv`;
const ERRORS_FILE = `skipped_${hostname}_${timestamp}_${pathLabel}.log`;
const ALLOWED_EXTENSIONS = EXTENSIONS_INPUT ? new Set(EXTENSIONS_INPUT.split(',').map(ext => `.${ext.toLowerCase().trim()}`)) : null;
const PARTIAL_SIZE = 16384;

/**
 * Helper to format seconds into a readable string
 */
function formatTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) return "Calculating...";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

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
                    fileList.push({ name: file, path: filePath, size: stat.size, created: stat.birthtime.toISOString() });
                    process.stdout.write(`\r📂 Scanning... ${fileList.length} files found`);
                }
            } catch (e) { skippedItems.push(`ACCESS DENIED: ${filePath}`); }
        }
    } catch (e) { skippedItems.push(`FOLDER DENIED: ${dir}`); }
    return { fileList, skippedItems };
}

async function findDuplicates() {
    const totalStart = performance.now();
    console.log(`🚀 Starting Multi-Path Scan on: ${hostname}`);
    
    let masterFileList = [];
    let masterSkippedList = [];

    for (const rootPath of SCAN_PATHS) {
        const { fileList, skippedItems } = await walk(rootPath);
        masterFileList = masterFileList.concat(fileList);
        masterSkippedList = masterSkippedList.concat(skippedItems);
    }
    process.stdout.write('\n');

    const sizeMap = new Map();
    masterFileList.forEach(f => {
        if (!sizeMap.has(f.size)) sizeMap.set(f.size, []);
        sizeMap.get(f.size).push(f);
    });

    const potentialMatches = Array.from(sizeMap.values()).filter(group => group.length > 1).flat();
    if (potentialMatches.length === 0) {
        console.log("✨ No potential duplicates found.");
        return;
    }

    // --- HASHING WITH TIME PREDICTION ---
    const processQueue = async (list, label) => {
        console.log(`\n${label} (${list.length} files)`);
        const results = new Map();
        const start = performance.now();

        for (let i = 0; i < list.length; i++) {
            const file = list[i];
            try {
                const hash = label.includes("Partial") 
                    ? await getFileHash(file.path, PARTIAL_SIZE) 
                    : await getFileHash(file.path);
                
                const key = label.includes("Partial") ? `${file.size}-${hash}` : hash;
                if (!results.has(key)) results.set(key, []);
                results.get(key).push(file);
            } catch (e) { masterSkippedList.push(`HASH ERROR: ${file.path}`); }

            // PREDICTOR LOGIC
            const now = performance.now();
            const elapsed = (now - start) / 1000;
            const rate = (i + 1) / elapsed; // files per second
            const remaining = list.length - (i + 1);
            const eta = remaining / rate;

            process.stdout.write(
                `\r   [${Math.floor(((i + 1) / list.length) * 100)}%] ` +
                `ETA: ${formatTime(eta)} | ` +
                `${i + 1}/${list.length} files`
            );
        }
        process.stdout.write('\n');
        return results;
    };

    const partialResults = await processQueue(potentialMatches, "🔍 Stage 1: Partial Hashing");
    
    const finalCandidates = Array.from(partialResults.values()).filter(g => g.length > 1).flat();
    const finalDuplicates = finalCandidates.length > 0 
        ? await processQueue(finalCandidates, "🧪 Stage 2: Full Content Verification")
        : new Map();

    // --- CSV Generation ---
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

    if (sets > 0) await fs.writeFile(OUTPUT_FILE, csvContent);
    if (masterSkippedList.length > 0) await fs.writeFile(ERRORS_FILE, masterSkippedList.join('\n'));

    const totalTime = (performance.now() - totalStart) / 1000;
    console.log(`\n✅ Done! Total Time: ${formatTime(totalTime)}`);
    console.log(`📄 Report: ${OUTPUT_FILE}`);
    if (masterSkippedList.length > 0) console.log(`⚠️  Skipped Log: ${ERRORS_FILE}`);
}

findDuplicates();
