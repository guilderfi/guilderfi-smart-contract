const { expect } = require("chai");
const { ethers } = require("hardhat");
const { deploy } = require("../helpers/deploy");
const { ether, print, createWallet } = require("../helpers/utils");
const { transferTokens, transferEth, getPendingRebases } = require("../helpers");

let token;
let deployer;
let treasury;

const account1 = createWallet(ethers);

describe(`Testing rebasing engine..`, function () {
  before(async function () {
    // Set up accounts
    [deployer, treasury] = await ethers.getSigners();

    print(`Deploying smart contracts..`);
    token = await deploy({ ethers, deployer, treasury });

    // start rebasing
    await token.connect(treasury).launchToken();

    // transfer 100 tokens to account1
    await transferTokens({ token, from: treasury, to: account1, amount: ether(100) });

    // transfer some eth to test accounts
    await transferEth({ from: deployer, to: account1, amount: ether(10) });
  });

  it("Rebase should increase each account balance by 0.016% after 12 minutes", async function () {
    // move time forward 12 minutes
    await ethers.provider.send("evm_increaseTime", [720]);
    await ethers.provider.send("evm_mine");

    expect(await getPendingRebases({ ethers, token })).to.equal(1);

    // trigger rebase
    await token.connect(treasury).rebase();

    // check that rebase has been applied
    expect(await token.balanceOf(account1.address)).to.equal(ether(100.016030912247));
    expect(await token.lastEpoch()).to.equal(1);
    expect(await getPendingRebases({ ethers, token })).to.equal(0);
  });

  it("Rebase should perform rebases in max batch sizes", async function () {
    // move time forward by 100 rebases)
    await ethers.provider.send("evm_increaseTime", [720 * 100]);
    await ethers.provider.send("evm_mine");

    expect(await getPendingRebases({ ethers, token })).to.equal(100);

    // trigger rebase
    await token.connect(treasury).rebase();

    expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(100.659379119725), ether(0.001));
    expect(await token.lastEpoch()).to.equal(41);
    expect(await getPendingRebases({ ethers, token })).to.equal(60);

    await token.connect(treasury).rebase();
    expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(101.306865632955), ether(0.001));
    expect(await token.lastEpoch()).to.equal(81);
    expect(await getPendingRebases({ ethers, token })).to.equal(20);

    await token.connect(treasury).rebase();
    expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(101.632169066129), ether(0.001));
    expect(await token.lastEpoch()).to.equal(101);
    expect(await getPendingRebases({ ethers, token })).to.equal(0);

    try {
      await token.connect(treasury).rebase();
    } catch (error) {
      expect(error.message).to.contain("No pending rebases");
    }

    expect(await token.balanceOf(account1.address)).to.be.closeTo(ether(101.632169066129), ether(0.001));
    expect(await token.lastEpoch()).to.equal(101);
    expect(await getPendingRebases({ ethers, token })).to.equal(0);
  });
});
