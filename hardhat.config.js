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
require("hardhat-contract-sizer");

const {
  TESTNET_URL,
  TESTNET_CHAIN_ID,
  TESTNET_DEX_ROUTER_ADDRESS,
  MAINNET_URL,
  MAINNET_CHAIN_ID,
  PRIVATE_KEY,
  ETHERSCAN_API_KEY,
  REPORT_GAS,
} = process.env;
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

  // const deployer = (await hre.ethers.getSigners())[0];
  // console.log(await hre.ethers.provider.getBalance(deployer.address));
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

task("setup", "Set up")
  .addParam("address", "Main GuilderFi contract address")
  .setAction(async (taskArgs, hre) => {
    // get treasury signer
    const deployer = (await hre.ethers.getSigners())[0];
    const treasury = (await hre.ethers.getSigners())[1];

    const Token = await hre.ethers.getContractFactory(TOKEN_NAME);
    const SwapEngine = await hre.ethers.getContractFactory("SwapEngine");
    const AutoLiquidityEngine = await hre.ethers.getContractFactory("AutoLiquidityEngine");
    const LiquidityReliefFund = await hre.ethers.getContractFactory("LiquidityReliefFund");
    const SafeExitFund = await hre.ethers.getContractFactory("SafeExitFund");
    const PreSale = await hre.ethers.getContractFactory("PreSale");

    // get deployed token
    const token = await Token.attach(taskArgs.address);

    // create swap engine
    console.log("Deploying Swap Engine...");
    const swapEngine = await SwapEngine.connect(deployer).deploy(token.address);
    await token.connect(deployer).setSwapEngine(swapEngine.address);
    console.log(`Swap Engine deployed at: ${await token.getSwapEngineAddress()}`);

    // create auto liquidity engine
    console.log("Deploying Auto Liquidity Engine...");
    const autoLiquidityEngine = await AutoLiquidityEngine.connect(deployer).deploy(token.address);
    await token.connect(deployer).setAutoLiquidityEngine(autoLiquidityEngine.address);
    console.log(`Auto Liquidity Engine deployed at: ${await token.getAutoLiquidityAddress()}`);

    // create swap engine
    console.log("Deploying Liquidity Relief Fund...");
    const lrf = await LiquidityReliefFund.connect(deployer).deploy(token.address);
    await token.connect(deployer).setLrf(lrf.address);
    console.log(`LRF deployed at: ${await token.getLrfAddress()}`);

    // create swap engine
    console.log("Deploying Safe Exit Fund...");
    const safeExit = await SafeExitFund.connect(deployer).deploy(token.address);
    await token.connect(deployer).setSafeExitFund(safeExit.address);
    console.log(`Safe Exit deployed at: ${await token.getSafeExitFundAddress()}`);

    // create pre-sale
    console.log("Deploying Pre-Sale...");
    const preSale = await PreSale.connect(deployer).deploy(token.address);
    await token.connect(deployer).setPreSaleEngine(preSale.address);
    console.log(`Pre-sale deployed at: ${await token.getPreSaleAddress()}`);

    // set up dex
    console.log("Setting up DEX...");
    await token.connect(deployer).setDex(TESTNET_DEX_ROUTER_ADDRESS);
    console.log(`DEX Pair: ${await token.getPair()}`);

    // transfer ownership to treasury
    await token.connect(deployer).setTreasury(treasury.address);
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

    await hre.run("verify:verify", { address: token.address, network: hre.network.name, constructorArguments: [token.address] });
    await hre.run("verify:verify", { address: lrfAddress, network: hre.network.name, constructorArguments: [token.address] });
    await hre.run("verify:verify", { address: autoLiquidityAddress, network: hre.network.name, constructorArguments: [token.address] });
    await hre.run("verify:verify", { address: safeExitFundAddress, network: hre.network.name, constructorArguments: [token.address] });
    await hre.run("verify:verify", { address: preSaleAddress, network: hre.network.name, constructorArguments: [token.address] });
  });

/**
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: "0.8.9",
  settings: {
    optimizer: {
      enabled: true,
      runs: 1,
    },
  },
  networks: {
    hardhat: {
      hostname: "127.0.0.1",
      port: 8545,
      chainId: parseInt(TESTNET_CHAIN_ID),
      accounts,
      forking: {
        url: TESTNET_URL,
      },
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    testnet: {
      url: TESTNET_URL,
      chainId: parseInt(TESTNET_CHAIN_ID),
      accounts: accounts.map((x) => x.privateKey), // accounts: PRIVATE_KEY !== undefined ? [PRIVATE_KEY] : [],
    },
    mainnet: {
      url: MAINNET_URL,
      chainId: parseInt(MAINNET_CHAIN_ID),
      accounts: PRIVATE_KEY !== undefined ? [PRIVATE_KEY] : [],
    },
  },
  gasReporter: {
    enabled: REPORT_GAS !== undefined,
    currency: "USD",
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
};
