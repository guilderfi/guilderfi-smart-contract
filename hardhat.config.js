const path = require("path");
const { task } = require("hardhat/config");
const fs = require("fs");
const { merge } = require("sol-merger");
const { parse } = require("csv-parse/sync");

require("dotenv").config();
require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("hardhat-gas-reporter");
require("solidity-coverage");

const TOKEN_NAME = "GuilderFi";

// fetch accounts from csv file
const accounts = [];
const inputCsvData = fs.readFileSync("./accounts.csv", "utf-8");
const records = parse(inputCsvData, { columns: true });
for (let i = 0; i < records.length; i++) {
  const row = records[i];
  accounts.push({ privateKey: row.private_key, balance: row.balance });
}

task("accounts", "Prints the list of accounts", async (taskArgs, hre) => {
  const accounts = await hre.ethers.getSigners();
  for (const account of accounts) {
    console.log(account.address); // public key
  }
});

task("deploy", "Deploys the contract to the blockchain", async (taskArgs, hre) => {
  const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
  const token = await Token.deploy();

  console.log("Token deployed to contract address: ", token.address);
});

task("deploy-and-verify", "Deploys the contract to the blockchain", async (taskArgs, hre) => {
  const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
  const token = await Token.deploy();

  console.log("Token deployed to contract address: ", token.address);

  const lrfAddress = await token.getLrfAddress();
  const autoLiquidityAddress = await token.getAutoLiquidityAddress();
  const safeExitFundAddress = await token.getSafeExitFundAddress();
  const preSaleAddress = await token.getPreSaleAddress();

  await hre.run("verify:verify", { address: token.address, network: hre.network.name });
  await hre.run("verify:verify", { address: lrfAddress, network: hre.network.name });
  await hre.run("verify:verify", { address: autoLiquidityAddress, network: hre.network.name });
  await hre.run("verify:verify", { address: safeExitFundAddress, network: hre.network.name });
  await hre.run("verify:verify", { address: preSaleAddress, network: hre.network.name });
});

task("presale", "Run presale stuff", async (taskArgs, hre) => {
  const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
  const PreSale = await hre.ethers.getContractFactory("PreSale");

  const token = await Token.deploy();
  const preSaleAddress = await token.getPreSaleAddress();
  const preSale = PreSale.attach(preSaleAddress);

  console.log("Pre sale address is: ", preSaleAddress);
  console.log("Pre sale - public sale is open: ", await preSale.isPublicSaleOpen());
});

task("script", "Run a script, e.g. scripts/airdrop.js")
  .addParam("file", "Script to run")
  .setAction(async (taskArgs, hre) => {
    const script = require(taskArgs.file);
    await script.run(hre.ethers);
  });

task("merge", "Merge solidity contracts", async (taskArgs, hre) => {
  const outputFolder = "artifacts";
  const outputFile = "merged.sol";
  const outputFolderPath = path.join(__dirname, outputFolder);
  const outputFilePath = path.join(outputFolderPath, outputFile);

  // merge files
  let mergedCode = await merge(`./contracts/${TOKEN_NAME}.sol`, { removeComments: true });

  // add license header
  mergedCode = "// SPDX-License-Identifier: MIT\n\n" + mergedCode;

  fs.mkdirSync(outputFolderPath, { recursive: true });
  fs.writeFileSync(outputFilePath, mergedCode, "utf-8");

  console.log("File created: ", outputFilePath);
});

task("verify-all", "Verify all contracts on etherscan")
  .addParam("address", "Main GuilderFi contract address")
  .setAction(async (taskArgs, hre) => {
    const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
    const token = await Token.attach(taskArgs.address);

    const lrfAddress = await token.getLrfAddress();
    const autoLiquidityAddress = await token.getAutoLiquidityAddress();
    const safeExitFundAddress = await token.getSafeExitFundAddress();
    const preSaleAddress = await token.getPreSaleAddress();

    await hre.run("verify:verify", { address: token.address, network: hre.network.name });
    await hre.run("verify:verify", { address: lrfAddress, network: hre.network.name });
    await hre.run("verify:verify", { address: autoLiquidityAddress, network: hre.network.name });
    await hre.run("verify:verify", { address: safeExitFundAddress, network: hre.network.name });
    await hre.run("verify:verify", { address: preSaleAddress, network: hre.network.name });
  });

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.8.10",
  networks: {
    hardhat: {
      hostname: "127.0.0.1",
      port: "8545",
      chainId: 23,
      accounts,
      forking: {
        url: process.env.FORK_URL,
      },
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      gasPrice: 5000000000,
    },
    testnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    mainnet: {
      url: "https://bsc-dataseed.binance.org/",
      chainId: 56,
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
    ropsten: {
      url: process.env.ROPSTEN_URL || "",
      accounts: process.env.PRIVATE_KEY !== undefined ? [process.env.PRIVATE_KEY] : [],
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
};
