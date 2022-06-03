const fs = require("fs");
const { parse } = require("csv-parse/sync");
const { ether } = require("./utils");

const getAccounts = () => {
  const { ACCOUNTS_CSV_PATH, DEPLOYER_PRIVATE_KEY, TREASURY_PRIVATE_KEY } = process.env;

  const accounts = [];
  if (ACCOUNTS_CSV_PATH) {
    // read list of accounts from csv file
    const inputCsvData = fs.readFileSync(ACCOUNTS_CSV_PATH, "utf-8");
    const records = parse(inputCsvData, { columns: true });
    for (let i = 0; i < records.length; i++) {
      const row = records[i];
      accounts.push({ privateKey: row.private_key, balance: row.balance });
    }
  } else {
    accounts.push({ privateKey: DEPLOYER_PRIVATE_KEY, balance: ether(1000000).toString() });
    accounts.push({ privateKey: TREASURY_PRIVATE_KEY, balance: ether(1000000).toString() });
  }

  return accounts;
};

module.exports = { getAccounts };
