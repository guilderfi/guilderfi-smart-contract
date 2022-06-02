const fs = require("fs");
const { parse } = require("csv-parse/sync");

const accounts = [];
const inputCsvData = fs.readFileSync("./accounts.csv", "utf-8");
const records = parse(inputCsvData, { columns: true });
for (let i = 0; i < records.length; i++) {
  const row = records[i];
  accounts.push({ privateKey: row.private_key, balance: row.balance });
}

module.exports = { accounts };
