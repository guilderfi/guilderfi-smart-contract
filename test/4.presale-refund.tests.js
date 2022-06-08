const { expect } = require("chai");
const { ethers } = require("hardhat");

const { deploy } = require("../helpers/deploy");
const { ether, print, createWallet } = require("../helpers/utils");
const { transferTokens, transferEth } = require("../helpers");
const { publicTier, tier1 } = require("../helpers/data");

let token;
let deployer;
let treasury;
let preSale;

const account1 = createWallet(ethers);
const account2 = createWallet(ethers);

describe(`Testing pre-sale refund scenario..`, function () {
  before(async function () {
    // Set up accounts
    [deployer, treasury] = await ethers.getSigners();

    print(`Deploying smart contracts..`);
    token = await deploy({ ethers, deployer, treasury });

    // contracts
    preSale = await ethers.getContractAt("PreSale", await token.getPreSaleAddress());

    // send 27m tokens to presale contract
    await transferTokens({ token, from: treasury, to: preSale, amount: ether(27000000) });

    // transfer some eth to test accounts
    await transferEth({ from: deployer, to: account1, amount: ether(150) });
    await transferEth({ from: deployer, to: account2, amount: ether(150) });

    await preSale.connect(treasury).addCustomTier(tier1.tierId, tier1.minAmount, tier1.maxAmount, tier1.tokensPerEth);
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
