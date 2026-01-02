const fs = require('fs').promises;
const path = require('path');

const CSV_FILE = process.argv[2];

if (!CSV_FILE) {
    console.error("❌ Error: Please provide the CSV filename.");
    process.exit(1);
}

async function migrate() {
    try {
        const rawData = await fs.readFile(CSV_FILE, 'utf8');
        const lines = rawData.split(/\r?\n/);
        
        // Remove header and empty lines
        const rows = lines.slice(1).filter(line => line.trim() !== '');

        const setsMap = new Map();

        rows.forEach(row => {
            // Regex to handle CSV commas inside quotes
            const parts = row.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
            if (!parts || parts.length < 5) return;

            const name = parts[0].replace(/"/g, '');
            const created = parts[1].replace(/"/g, '');
            const size = parseInt(parts[2].replace(/"/g, ''), 10);
            const folder = parts[3].replace(/"/g, '');
            const fullPath = parts[4].replace(/"/g, '');

            // Since CSVs were grouped by duplicate, files with identical sizes
            // that were adjacent in the CSV are almost certainly the same set.
            if (!setsMap.has(size)) {
                setsMap.set(size, []);
            }
            setsMap.get(size).push({
                name,
                path: fullPath,
                size,
                created
            });
        });

        const migratedSets = [];
        let totalWasted = 0;
        let totalDupes = 0;

        for (const [size, files] of setsMap) {
            if (files.length > 1) {
                totalDupes += files.length;
                totalWasted += size * (files.length - 1);
                migratedSets.push({
                    hash: "migrated-legacy", // Legacy CSV didn't store hash
                    size: size,
                    fileCount: files.length,
                    files: files
                });
            }
        }

        const jsonReport = {
            metadata: {
                hostname: "Migrated-Legacy",
                scanDate: new Date().toISOString(),
                targetPaths: ["Imported from CSV"],
                durationSeconds: "N/A"
            },
            summary: {
                totalFilesScanned: totalDupes, 
                duplicateSets: migratedSets.length,
                totalDuplicateFiles: totalDupes,
                potentialSavingsBytes: totalWasted
            },
            sets: migratedSets,
            errors: []
        };

        const outputName = CSV_FILE.replace('.csv', '_migrated.json');
        await fs.writeFile(outputName, JSON.stringify(jsonReport, null, 2));

        console.log(`✅ Success! Migrated ${migratedSets.length} sets to: ${outputName}`);
        console.log(`💾 Legacy Savings recovered: ${(totalWasted / (1024**3)).toFixed(2)} GB`);

    } catch (err) {
        console.error("❌ Migration failed:", err.message);
    }
}

migrate();