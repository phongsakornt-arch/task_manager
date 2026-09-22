const XLSX = require('xlsx')
const path = require('path')

const FILE = path.join(__dirname, '../old data/YEC Task Manager.xlsx')
const wb = XLSX.readFile(FILE)

console.log('=== SHEETS ===')
console.log(wb.SheetNames)

function firstRows(name, n = 3) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null })
  console.log(`\n=== ${name} (${rows.length} rows) — columns: ${Object.keys(rows[0] || {}).join(', ')} ===`)
  rows.slice(0, n).forEach(r => console.log(JSON.stringify(r)))
}

wb.SheetNames.forEach(n => firstRows(n, 3))
