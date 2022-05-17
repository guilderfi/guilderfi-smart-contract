/*
const { expect } = require("chai");
const { ethers } = require("hardhat");

const { addZeroes, print } = require("./helpers");

const TOKEN_NAME = "GuilderFi";
const DECIMALS = 18;

let token;

let treasury;
let account1;
let preSale;
let safeExit;
*/

describe(`Testing safe exit..`, function () {
  before(async function () {
    /*
    // Set up accounts
    [, treasury, account1] = await ethers.getSigners();

    print(`Deploying smart contracts..`);

    // Deploy contract
    const Token = await ethers.getContractFactory(TOKEN_NAME);
    token = await Token.deploy();
    await token.deployed();

    // contracts
    preSale = await ethers.getContractAt("PreSale", await token.preSale());
    safeExit = await ethers.getContractAt("SafeExitFund", await token.safeExitFund());
    */
  });

  it("Should mint correct number of NFTs with each purchase", async function () {
    // check each tier1,2,3,public sale receives an NFT
  });

  it("Should fill the NFTs with each purchase during pre-sale", async function () {
    // check balance of each NFT above
    // buy more tokens, check balance again
  });

  it("Should allocate NFT values using random seed", async function () {
    // apply random seed
    // check package for each wallet
  });

  it("Should fill NFTs during post-sale when buying from exchange", async function () {
    // buy tokens
    // check balance increases
  });

  it("Should clear NFT balance when transferred to another wallet", async function () {
    // buy tokens
    // check balance increases
  });

  it("Should allow user to claim safe exit using NFT", async function () {
    // todo
  });
});
