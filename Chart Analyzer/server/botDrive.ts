import "./loadLocalEnv"
import { DRIVE_FOLDER, DRIVE_NEVER_UPLOAD, DRIVE_PULL_BEFORE_SCAN } from "./drivePack"

console.log("Grok Bot runs on THIS machine. Never Yurei's PC. Never G:\\Grok Trading on Yurei's Drive Desktop.")
console.log("")
console.log(`Pull from Google Drive MCP folder ${DRIVE_FOLDER}/ into this GitHub clone (same relative paths), then npm run scan -- --wait-minutes 0:`)
for (const row of DRIVE_PULL_BEFORE_SCAN) console.log(`  ${row}`)
console.log("")
console.log("After a successful scan, upload the paths printed by npm run scan (and *_bot-drive.json) back to that same Drive folder.")
console.log("Never upload:")
for (const row of DRIVE_NEVER_UPLOAD) console.log(`  ${row}`)
console.log("")
console.log("Phone Grok reads Drive, not this disk.")
