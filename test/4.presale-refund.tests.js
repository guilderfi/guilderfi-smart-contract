const { expect } = require("chai");
const { ethers } = require("hardhat");

const { ether, print, transferTokens } = require("./helpers");
const { publicTier, tier1 } = require("./helpers/data");

const { TESTNET_DEX_ROUTER_ADDRESS } = process.env;
const TOKEN_NAME = "GuilderFi";

let token;
let deployer;
let treasury;
let preSale;
let account1;
let account2;

describe(`Testing pre-sale refund scenario..`, function () {
  before(async function () {
    // Set up accounts
    [deployer, treasury, account1, account2] = await ethers.getSigners();

    print(`Deploying smart contracts..`);

    const Token = await ethers.getContractFactory(TOKEN_NAME);
    const SwapEngine = await ethers.getContractFactory("SwapEngine");
    const AutoLiquidityEngine = await ethers.getContractFactory("AutoLiquidityEngine");
    const LiquidityReliefFund = await ethers.getContractFactory("LiquidityReliefFund");
    const SafeExitFund = await ethers.getContractFactory("SafeExitFund");
    const PreSale = await ethers.getContractFactory("PreSale");

    // Deploy contract
    token = await Token.deploy();
    global.token = token;
    await token.deployed();

    // create swap engine
    const _swapEngine = await SwapEngine.connect(deployer).deploy(token.address);
    await token.connect(deployer).setSwapEngine(_swapEngine.address);

    // create auto liquidity engine
    const _autoLiquidityEngine = await AutoLiquidityEngine.connect(deployer).deploy(token.address);
    await token.connect(deployer).setLiquidityEngine(_autoLiquidityEngine.address);

    // create LRF
    const _lrf = await LiquidityReliefFund.connect(deployer).deploy(token.address);
    await token.connect(deployer).setLrf(_lrf.address);

    // create safe exit fund
    const _safeExit = await SafeExitFund.connect(deployer).deploy(token.address);
    await token.connect(deployer).setSafeExitFund(_safeExit.address);

    // create pre-sale
    const _preSale = await PreSale.connect(deployer).deploy(token.address);
    await token.connect(deployer).setPreSaleEngine(_preSale.address);

    // set up dex
    await token.connect(deployer).setDex(TESTNET_DEX_ROUTER_ADDRESS);

    // set up treasury
    await token.connect(deployer).setTreasury(treasury.address);

    // contracts
    preSale = await ethers.getContractAt("PreSale", await token.getPreSaleAddress());

    // send 27m tokens to presale contract
    await transferTokens({ token, from: treasury, to: preSale, amount: ether(27000000) });
  });

  it("Should allow users to claim redunds when sale is cancelled", async function () {
    await preSale.connect(treasury).openPublicSale(true);
    await preSale.connect(treasury).openWhitelistSale(1, true);

    // buy public sale
    await preSale.connect(account1).buyTokens({ value: publicTier.maxAmount });

    // buy tier 1
    await preSale.connect(treasury).addToWhitelist([account2.address], tier1.tierId);
    await preSale.connect(account2).buyTokens({ value: tier1.maxAmount });

    try {
      await preSale.connect(account1).claimRefund();
    } catch (error) {
      expect(error.message).to.contain("Sale is not closed");
    }

    // capture balance before cancelling sale
    const ethBalanceBefore = await ethers.provider.getBalance(account1.address);
    await preSale.connect(treasury).cancelSale();

    expect(await ethers.provider.getBalance(preSale.address)).to.equal(publicTier.maxAmount.add(tier1.maxAmount));

    // claim refund
    await preSale.connect(account1).claimRefund();

    expect(await ethers.provider.getBalance(preSale.address)).to.equal(tier1.maxAmount);

    const ethBalanceAfter = await ethers.provider.getBalance(account1.address);
    const ethAmount = ethBalanceAfter.sub(ethBalanceBefore);

    expect(await ethers.provider.getBalance(preSale.address)).to.equal(tier1.maxAmount);
    expect(ethAmount).to.be.closeTo(publicTier.maxAmount, ether(0.01)); // account for gas
  });
});
