const { expect } = require("chai");
const { ethers } = require("hardhat");
const { print, transferTokens, ether } = require("../helpers");

const { TESTNET_DEX_ROUTER_ADDRESS } = process.env;
const TOKEN_NAME = "GuilderFi";

let token;
let deployer;
let treasury;
let account1;

describe(`Testing rebasing engine..`, function () {
  before(async function () {
    // Set up accounts
    [deployer, treasury, account1] = await ethers.getSigners();

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

    // start rebasing
    await token.connect(treasury).launchToken();

    // transfer 100 tokens to account1
    await transferTokens({ token, from: treasury, to: account1, amount: ether(100) });
  });

  it("Rebase should increase each account balance by 0.016% after 12 minutes", async function () {
    // move time forward 12 minutes
    await ethers.provider.send("evm_increaseTime", [720]);
    await ethers.provider.send("evm_mine");

    expect(await token.pendingRebases()).to.equal(1);

    // trigger rebase
    await token.connect(treasury).rebase();

    // check that rebase has been applied
    expect(await token.balanceOf(account1.address)).to.equal(ether(100.016030912247));
    expect(await token.lastEpoch()).to.equal(1);
    expect(await token.pendingRebases()).to.equal(0);
  });

  it("Rebase should perform rebases in max batch sizes", async function () {
    // move time forward by 100 rebases)
    await ethers.provider.send("evm_increaseTime", [720 * 100]);
    await ethers.provider.send("evm_mine");

    expect(await token.pendingRebases()).to.equal(100);

    // trigger rebase
    await token.connect(treasury).rebase();

    expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(100.659379119725), ether(0.001));
    expect(await token.lastEpoch()).to.equal(41);
    expect(await token.pendingRebases()).to.equal(60);

    await token.connect(treasury).rebase();
    expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(101.306865632955), ether(0.001));
    expect(await token.lastEpoch()).to.equal(81);
    expect(await token.pendingRebases()).to.equal(20);

    await token.connect(treasury).rebase();
    expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(101.632169066129), ether(0.001));
    expect(await token.lastEpoch()).to.equal(101);
    expect(await token.pendingRebases()).to.equal(0);

    try {
      await token.connect(treasury).rebase();
    } catch (error) {
      expect(error.message).to.contain("No pending rebases");
    }

    expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(101.632169066129), ether(0.001));
    expect(await token.lastEpoch()).to.equal(101);
    expect(await token.pendingRebases()).to.equal(0);
  });
});
