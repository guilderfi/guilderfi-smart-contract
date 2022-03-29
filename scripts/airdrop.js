const fs = require("fs");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");
const { parse } = require("csv-parse/sync");

const TOKEN_NAME = "GuilderFi";
const WALLET_COLUMN = "wallet_address";
const TRANSFER_AMOUNT = BigNumber.from("1000000000000000000000"); // 1000 (18 decimals)

// read csv data
const inputCsvData = fs.readFileSync("./airdrop.csv", "utf-8");
const records = parse(inputCsvData, { columns: true });

async function doAirdrop() {
  const totalRecords = records.length;
  let totalValid = 0;
  let totalInvalid = 0;
  let totalTokens = BigNumber.from(0);

  // get contract
  const Token = await ethers.getContractFactory(TOKEN_NAME);
  const token = await Token.attach(process.env.CONTRACT_ADDRESS);

  for (let i = 0; i < totalRecords; i++) {
    const row = records[i];
    const walletAddress = row[WALLET_COLUMN];

    const isValidAddress = ethers.utils.isAddress(walletAddress);

    if (isValidAddress) {
      // do transfer
      totalValid++;
      totalTokens = totalTokens.add(TRANSFER_AMOUNT);
      console.log(`Transferring (${i + 1})...`);

      // Transfer air drop to account
      const transaction = await token.transfer(walletAddress, TRANSFER_AMOUNT);
      await transaction.wait();

      console.log(`(${i + 1}/${totalRecords}) |  Sent 400,000,000 tokens to: ${walletAddress}`);
    } else {
      totalInvalid++;
      console.log(`(${i + 1}/${totalRecords}) |  Invalid address: ${walletAddress}`);
    }
  }

  console.log(`---`);
  console.log(`${totalRecords} total records processed`);
  console.log(`${totalValid} valid records`);
  console.log(`${totalInvalid} invalid records`);
  console.log(`${totalTokens} tokens sent`);
}

doAirdrop();
