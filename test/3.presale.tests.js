const { expect } = require("chai");
const { ethers } = require("hardhat");

const { addZeroes, print, transferTokens } = require("./helpers");

const TOKEN_NAME = "GuilderFi";
const DECIMALS = 18;

let token;
let treasury;
let account1;
let preSale;

describe(`Testing pre-sale..`, function () {
  before(async function () {
    // Set up accounts
    [, treasury, account1] = await ethers.getSigners();

    print(`Deploying smart contracts..`);

    // Deploy contract
    const Token = await ethers.getContractFactory(TOKEN_NAME);
    token = await Token.deploy();
    await token.deployed();

    // contracts
    preSale = await ethers.getContractAt("PreSale", await token.preSale());

    // send 27m tokens to presale contract
    await transferTokens({ token, from: treasury, to: preSale, amount: addZeroes(27000000, DECIMALS) });
  });

  it("Should prevent purchasing until public sale is enabled", async function () {
    expect(await preSale.isPublicSaleOpen()).to.equal(false);
    expect(await preSale.isWhitelistSaleOpen()).to.equal(false);

    try {
      await preSale.connect(account1).buyTokens({ value: addZeroes(1, DECIMALS) });
    } catch (error) {
      expect(error.message).to.contain("Pre sale is not open");
    }

    // open sale
    await preSale.connect(treasury).openPublicSale(true);

    // buy tokens
    await preSale.connect(account1).buyTokens({ value: addZeroes(1, DECIMALS) });

    // check token balance of locker + wallet
    const locker = await ethers.getContractAt("ILocker", await preSale.locker(account1.address));
    const tokenAmount = (await token.balanceOf(account1.address)).add(await token.balanceOf(locker.address));
    expect(tokenAmount).to.equal(addZeroes(1400, DECIMALS));

    // set presale date in future
    // set presale active
    // try buy tokens
    // expect purchase to go through
    // turn off pre sale
  });

  it("Should prevent whitelist purchasing until whitelist sale is enabled", async function () {
    // disable pre-sale
    // enable whitelist
    // add user to whitelist 1
    // purchase
    // check amount
    // repeate for whitelist 2 and 3
  });

  it("Should apply correct pricing if both whitelist and public sale are running", async function () {
    // disable pre-sale
    // enable whitelist
    // add user to whitelist 1
    // purchase
    // check amount
    // repeate for whitelist 2 and 3
    // remove whitelist
    // purchase
    // check amount (public sale)
  });

  it("Should allow for custom pricing tiers to be configured", async function () {
    // todo
  });

  it("Should lock half of the purchase amount in a locker", async function () {
    // check multiple transactions are adding to the locker
  });

  it("Should auto add liquidity and distribute funds when sale is finalised", async function () {
    // check multiple transactions are only adding one NFT but increasing the capacity in the NFT
  });

  it("Should allow refunds if soft cap has not been reached", async function () {
    // check multiple transactions are only adding one NFT but increasing the capacity in the NFT
  });
});
