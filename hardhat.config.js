const path = require("path");
const { task } = require("hardhat/config");
const fs = require("fs");
const { merge } = require("sol-merger");

require("dotenv").config();
require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("hardhat-gas-reporter");
require("solidity-coverage");

const TOKEN_NAME = "GuilderFi";

// fetch accounts from text file (accounts.txt) (each line should be a private key)
const accounts = [];
fs.readFileSync("./accounts.txt", "utf-8")
  .split(/\r?\n/)
  .forEach(function (line) {
    accounts.push({ privateKey: line, balance: "100000000000000000000" });
  });

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

task("open", "Open up for trade", async (taskArgs, hre) => {
  const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
  const token = await Token.attach(process.env.CONTRACT_ADDRESS);
  await token.openTrade();

  console.log("Token open up for trade: ", token.address);
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

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.8.4",
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
