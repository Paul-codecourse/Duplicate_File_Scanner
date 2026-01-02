const fs = require('fs').promises;
const { createReadStream, existsSync } = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { performance } = require('perf_hooks');

const INPUT_PATHS = process.argv[2];
const EXTENSIONS_INPUT = process.argv[3];

if (!INPUT_PATHS) {
    console.error("❌ Error: Path required.");
    process.exit(1);
}

const SCAN_PATHS = INPUT_PATHS.split(',').map(p => p.trim()).filter(p => existsSync(p));
const ALLOWED_EXTENSIONS = EXTENSIONS_INPUT ? new Set(EXTENSIONS_INPUT.split(',').map(e => `.${e.toLowerCase().trim()}`)) : null;
const hostname = os.hostname();
const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const JSON_FILE = `report_${hostname}_${timestamp}.json`;

const PARTIAL_SIZE = 16384;
const sizeMap = new Map();
let filesFoundCount = 0;
let skippedItems = [];

async function getFileHash(filePath, bytesToRead = null) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const options = bytesToRead ? { start: 0, end: bytesToRead - 1 } : {};
        const stream = createReadStream(filePath, options);
        stream.on('data', data => hash.update(data));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', err => reject(err));
    });
}

async function walk(dir) {
    try {
        const entries = await fs.readdir(dir);
        for (const entry of entries) {
            const fullPath = path.join(dir, entry);
            try {
                const stats = await fs.lstat(fullPath);
                if (stats.isSymbolicLink()) {
                    skippedItems.push({ path: fullPath, reason: "Symbolic Link Skipped" });
                    continue;
                }
                if (stats.isDirectory()) {
                    await walk(fullPath);
                } else {
                    const ext = path.extname(entry).toLowerCase();
                    if (ALLOWED_EXTENSIONS && !ALLOWED_EXTENSIONS.has(ext)) continue;
                    filesFoundCount++;
                    if (filesFoundCount % 100 === 0) process.stdout.write(`\r📂 Scanning... ${filesFoundCount} files`);
                    
                    const fileObj = { name: entry, path: fullPath, size: stats.size, created: stats.birthtime };
                    if (!sizeMap.has(stats.size)) sizeMap.set(stats.size, []);
                    sizeMap.get(stats.size).push(fileObj);
                }
            } catch (e) { skippedItems.push({ path: fullPath, reason: e.message }); }
        }
    } catch (e) { skippedItems.push({ path: dir, reason: e.message }); }
}

async function main() {
    const startTime = performance.now();
    console.log(`🚀 Audit Started on ${hostname}`);

    for (const p of SCAN_PATHS) await walk(p);
    process.stdout.write('\n');

    const potentialGroups = Array.from(sizeMap.values()).filter(g => g.length > 1);
    sizeMap.clear();

    // --- Processing Logic ---
    const partialHashMap = new Map();
    console.log(`🔍 Stage 1: Partial Hash (${potentialGroups.flat().length} candidates)`);
    for (const group of potentialGroups) {
        for (const file of group) {
            try {
                const pHash = await getFileHash(file.path, PARTIAL_SIZE);
                const key = `${file.size}-${pHash}`;
                if (!partialHashMap.has(key)) partialHashMap.set(key, []);
                partialHashMap.get(key).push(file);
            } catch (e) { skippedItems.push({ path: file.path, reason: `Partial Hash Fail: ${e.message}` }); }
        }
    }

    const finalCandidates = Array.from(partialHashMap.values()).filter(g => g.length > 1).flat();
    const finalDuplicates = new Map();
    console.log(`🧪 Stage 2: Full Verification (${finalCandidates.length} files)`);
    for (const file of finalCandidates) {
        try {
            const fHash = await getFileHash(file.path);
            if (!finalDuplicates.has(fHash)) finalDuplicates.set(fHash, []);
            finalDuplicates.get(fHash).push(file);
        } catch (e) { skippedItems.push({ path: file.path, reason: `Full Hash Fail: ${e.message}` }); }
    }

    // --- Construct JSON Structure ---
    const report = {
        metadata: {
            hostname,
            scanDate: new Date().toISOString(),
            targetPaths: SCAN_PATHS,
            durationSeconds: ((performance.now() - startTime) / 1000).toFixed(2)
        },
        summary: {
            totalFilesScanned: filesFoundCount,
            duplicateSets: 0,
            totalDuplicateFiles: 0,
            potentialSavingsBytes: 0
        },
        sets: [],
        errors: skippedItems
    };

    for (const [hash, files] of finalDuplicates) {
        if (files.length > 1) {
            report.summary.duplicateSets++;
            report.summary.totalDuplicateFiles += files.length;
            report.summary.potentialSavingsBytes += files[0].size * (files.length - 1);
            report.sets.push({
                hash: hash,
                size: files[0].size,
                fileCount: files.length,
                files: files
            });
        }
    }

    await fs.writeFile(JSON_FILE, JSON.stringify(report, null, 2));
    console.log(`\n✅ JSON Report Generated: ${JSON_FILE}`);
    console.log(`💾 Potential Savings: ${(report.summary.potentialSavingsBytes / (1024**3)).toFixed(2)} GB`);
}

main();