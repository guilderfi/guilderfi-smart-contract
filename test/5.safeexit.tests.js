const { expect } = require("chai");
const { ethers } = require("hardhat");

const { deploy } = require("../helpers/deploy");
const { MAX_INT, ether, print, createWallet, weiToEthNumber } = require("../helpers/utils");
const { transferTokens, transferEth, buyTokensFromDexByExactEth, addLiquidity, gasUsed, sellTokens } = require("../helpers");
const { tier1, tier2, tier3 } = require("../helpers/data");

let token;
let deployer;
let treasury;
let router;
let preSale;
let safeExit;

const account1 = createWallet(ethers);
const account2 = createWallet(ethers);
const account3 = createWallet(ethers);
const account4 = createWallet(ethers);
const account5 = createWallet(ethers);
const account6 = createWallet(ethers);
const account7 = createWallet(ethers);

const DEAD = ethers.utils.getAddress("0x000000000000000000000000000000000000dEaD");

describe(`Testing safe exit..`, function () {
  before(async function () {
    // Set up accounts
    [deployer, treasury] = await ethers.getSigners();

    print(`Deploying smart contracts..`);
    token = await deploy({ ethers, deployer, treasury });

    // contracts
    router = await ethers.getContractAt("IDexRouter", await token.getRouter());
    preSale = await ethers.getContractAt("PreSale", await token.getPreSaleAddress());
    safeExit = await ethers.getContractAt("SafeExitFund", await token.getSafeExitFundAddress());

    // send 270k tokens to presale contract
    await transferTokens({ token, from: treasury, to: preSale, amount: ether(270000) });

    // add some eth to safe exit fund
    await transferEth({ from: treasury, to: safeExit, amount: ether(10) });

    // transfer some eth to test accounts
    await transferEth({ from: deployer, to: account1, amount: ether(150) });
    await transferEth({ from: deployer, to: account2, amount: ether(150) });
    await transferEth({ from: deployer, to: account3, amount: ether(150) });
    await transferEth({ from: deployer, to: account4, amount: ether(150) });
    await transferEth({ from: deployer, to: account5, amount: ether(150) });
    await transferEth({ from: deployer, to: account6, amount: ether(150) });
    await transferEth({ from: deployer, to: account7, amount: ether(150) });

    // setup custom sales tiers
    await preSale.connect(treasury).addCustomTier(tier1.tierId, tier1.minAmount, tier1.maxAmount, tier1.tokensPerEth);
    await preSale.connect(treasury).addCustomTier(tier2.tierId, tier2.minAmount, tier2.maxAmount, tier2.tokensPerEth);
    await preSale.connect(treasury).addCustomTier(tier3.tierId, tier3.minAmount, tier3.maxAmount, tier3.tokensPerEth);

    // Approve DEX to transfer
    await token.connect(treasury).approve(router.address, MAX_INT);

    // Add 10 million tokens + 10 eth into liquidity
    const tokenAmount = ether(100);
    const ethAmount = ether(100);
    await addLiquidity({
      router,
      from: treasury,
      token,
      tokenAmount,
      ethAmount,
    });
  });

  it("Should mint correct number of NFTs with each purchase", async function () {
    expect(await safeExit.issuedTokens()).to.equal(0);

    // check each tier1,2,3,public sale receives an NFT
    await preSale.connect(treasury).openPublicSale(true);
    await preSale.connect(treasury).openWhitelistSale(1, true);
    await preSale.connect(treasury).openWhitelistSale(2, true);
    await preSale.connect(treasury).openWhitelistSale(3, true);

    // add whitelist participants
    await preSale.connect(treasury).addToWhitelist([account1.address], tier1.tierId);
    await preSale.connect(treasury).addToWhitelist([account2.address], tier2.tierId);
    await preSale.connect(treasury).addToWhitelist([account3.address], tier3.tierId);

    // buy minimum for each tier
    await preSale.connect(account1).buyTokens({ value: tier1.minAmount });
    await preSale.connect(account2).buyTokens({ value: tier2.minAmount });
    await preSale.connect(account3).buyTokens({ value: tier3.minAmount });

    // check that 1 NFT has been minted for each account
    expect(await safeExit.balanceOf(account1.address)).to.equal(1);
    expect(await safeExit.balanceOf(account2.address)).to.equal(1);
    expect(await safeExit.balanceOf(account3.address)).to.equal(1);

    // buy up to maximum for each tier
    await preSale.connect(account1).buyTokens({ value: tier1.maxAmount.sub(tier1.minAmount) });
    await preSale.connect(account2).buyTokens({ value: tier2.maxAmount.sub(tier2.minAmount) });
    await preSale.connect(account3).buyTokens({ value: tier3.maxAmount.sub(tier3.minAmount) });

    // each account should still only have 1 NFT
    expect(await safeExit.balanceOf(account1.address)).to.equal(1);
    expect(await safeExit.balanceOf(account2.address)).to.equal(1);
    expect(await safeExit.balanceOf(account3.address)).to.equal(1);

    expect(await safeExit.issuedTokens()).to.equal(3);
  });

  it("Should only mint tokens if minimum purchase amount (0.5 eth) is met", async function () {
    await preSale.connect(account4).buyTokens({ value: ether(0.25) });
    await preSale.connect(account5).buyTokens({ value: ether(0.5) });

    expect(await safeExit.balanceOf(account4.address)).to.equal(0);
    expect(await safeExit.balanceOf(account5.address)).to.equal(1);

    await preSale.connect(account4).buyTokens({ value: ether(0.25) });
    expect(await safeExit.balanceOf(account4.address)).to.equal(1);

    await safeExit.connect(treasury).setPresaleMetadataUri("PRESALE");
    expect(await safeExit.tokenURI(await safeExit.tokenOfOwnerByIndex(account4.address, 0))).to.equal("PRESALE");
  });

  it("Should fill the NFTs with each purchase during pre-sale", async function () {
    // buy fixed amount
    await preSale.connect(account6).buyTokens({ value: ether(1) });

    // finalise sale
    await preSale.connect(treasury).setLockDuration(0);
    await preSale.connect(treasury).finalizeSale();
    await token.connect(treasury).launchToken();

    // set random safe exit seed
    await safeExit.connect(treasury).launchSafeExitNft(123456);

    // approve safe exit to burn tokens
    await token.connect(account6).approve(safeExit.address, MAX_INT);

    // check previous eth balance
    const account6ethBalanceBefore = await ethers.provider.getBalance(account6.address);

    // check payout amount
    expect((await safeExit.getInsuranceStatus(account6.address)).totalPurchaseAmount).to.equal(ether(1));

    // claim safe exit
    const txRejectedGasUsed = 0;
    // let txRejectedGasUsed = 0;
    /*
    try {
      const txRejected = await safeExit.connect(account6).claimSafeExit();
      txRejectedGasUsed = await gasUsed(txRejected);
    } catch (error) {
      expect(error.message).to.contain("SafeExit not available yet");
    }
    */

    // payout amount should remain unchanged
    expect((await safeExit.getInsuranceStatus(account6.address)).totalPurchaseAmount).to.equal(ether(1));

    // enable safe exit
    await safeExit.connect(treasury).setActivationDate(0);

    // do a claim
    const tx = await safeExit.connect(account6).claimSafeExit();
    const gas = await gasUsed(tx);

    // check eth balance has increased by correct amount
    const account6ethBalanceAfter = await ethers.provider.getBalance(account6.address);
    const account6ethPayout = account6ethBalanceAfter.sub(account6ethBalanceBefore);

    expect(account6ethPayout).to.equal(ether(1.0625).sub(gas).sub(txRejectedGasUsed)); // account for gas
    expect(await token.balanceOf(account6.address)).to.equal(0);
  });

  it("Should fill NFTs during post-sale when buying tokens from exchange", async function () {
    const PURCHASE_AMOUNT = 10;

    // create random wallet and fund with ether
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await transferEth({ from: deployer, to: wallet, amount: ether(PURCHASE_AMOUNT + 1) }); // +1 for gas

    // check eth balance before buying from exchange
    expect(await token.balanceOf(wallet.address)).to.equal(0);

    // check eth balance before buying from exchange
    const ethBalanceBeforeBuy = await ethers.provider.getBalance(wallet.address);

    // buy 1 eth worth of tokens from exchange
    const tx = await buyTokensFromDexByExactEth({ router, token, account: wallet, ethAmount: ether(PURCHASE_AMOUNT) });
    const gas = await gasUsed(tx);

    // check eth balance has reduced by 0.5 eth
    const ethBalanceAfterBuy = await ethers.provider.getBalance(wallet.address);
    const ethSpent = ethBalanceBeforeBuy.sub(ethBalanceAfterBuy);
    expect(ethSpent).to.equal(ether(PURCHASE_AMOUNT).add(gas)); // account for gas

    const insuranceStatus = await safeExit.connect(wallet).getInsuranceStatus(wallet.address);
    const totalPurchaseAmount = weiToEthNumber(insuranceStatus.totalPurchaseAmount);
    expect(totalPurchaseAmount).to.be.closeTo(PURCHASE_AMOUNT, PURCHASE_AMOUNT * 0.002); // within 0.2% accuracy
  });

  it("Should clear NFT balance when transferred to another wallet", async function () {
    const insuranceStatusBeforeSell = await safeExit.getInsuranceStatus(account2.address);
    const totalPurchaseAmountBeforeSell = weiToEthNumber(insuranceStatusBeforeSell.totalPurchaseAmount);
    expect(totalPurchaseAmountBeforeSell).to.be.greaterThan(0);

    // sell tokens
    await token.connect(account2).approve(router.address, MAX_INT);
    await sellTokens({ router, token, account: account2, tokenAmount: ether(1) });

    // purchased/insured amount should reset to zero
    const insuranceStatusAfterSell = await safeExit.getInsuranceStatus(account2.address);
    const totalPurchaseAmountAfterSell = weiToEthNumber(insuranceStatusAfterSell.totalPurchaseAmount);
    expect(totalPurchaseAmountAfterSell).to.equal(0);
  });

  it("Should allow user to claim safe exit using NFT", async function () {
    // check status before claim
    const insuranceStatusBeforeClaim = await safeExit.getInsuranceStatus(account3.address);
    const totalPurchaseAmountBeforeClaim = weiToEthNumber(insuranceStatusBeforeClaim.totalPurchaseAmount);
    expect(totalPurchaseAmountBeforeClaim).to.be.greaterThan(0);

    // calculate payout amount
    const maxInsuranceAmount = weiToEthNumber(insuranceStatusBeforeClaim.maxInsuranceAmount);
    const expectedPayout = Math.min(totalPurchaseAmountBeforeClaim, maxInsuranceAmount);

    // check previous eth balance
    const ethBalanceBefore = await ethers.provider.getBalance(account3.address);

    // check locker
    const lockerAddress = await preSale.locker(account3.address);
    const lockerBalance = weiToEthNumber(await token.balanceOf(lockerAddress));
    expect(lockerBalance).to.be.greaterThan(0);

    // dead token balance
    const deadTokenBalanceBefore = await token.balanceOf(DEAD);

    // claim safe exit
    const txApprove = await token.connect(account3).approve(safeExit.address, MAX_INT);
    const gasApprove = await gasUsed(txApprove);

    const tx = await safeExit.connect(account3).claimSafeExit();
    const gas = await gasUsed(tx);

    // check eth balance has increased by correct amount
    const ethBalanceAfter = await ethers.provider.getBalance(account3.address);
    const ethPayout = ethBalanceAfter.sub(ethBalanceBefore);

    // expect to be rewarded amount + 6.25% premium
    expect(ethPayout).to.equal(
      ether(expectedPayout * 1.0625)
        .sub(gas)
        .sub(gasApprove)
    ); // account for gas

    // check burnt tokens
    const deadTokenBalanceAfter = await token.balanceOf(DEAD);
    const deadTokens = deadTokenBalanceAfter.sub(deadTokenBalanceBefore);
    expect(weiToEthNumber(deadTokens)).to.be.greaterThan(0);

    // check balances after
    expect(await token.balanceOf(account3.address)).to.equal(ether(0));
    expect(await token.balanceOf(lockerAddress)).to.equal(ether(0));
  });

  it("Should prevent user from claiming safe exit again", async function () {
    expect(Number(await safeExit.balanceOf(account3.address))).to.be.greaterThan(0);
    expect(Number((await safeExit.getInsuranceStatus(account3.address)).totalPurchaseAmount)).to.equal(0);

    // buy some tokens
    await buyTokensFromDexByExactEth({ router, token, account: account3, ethAmount: ether(1) });

    // check if purchase/insurance amount increased
    expect(Number((await safeExit.getInsuranceStatus(account3.address)).totalPurchaseAmount)).to.be.greaterThan(0);

    // claim safe exit
    try {
      await safeExit.connect(account3).claimSafeExit();
    } catch (error) {
      expect(error.message).to.contain("Invalid payout amount");
    }
  });

  it("Should allow for custom NFTs", async function () {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);

    await safeExit.connect(treasury).createPackage(10, "test", ether(2000), "", "", "");
    await safeExit.connect(treasury).mint(wallet.address, 10);

    expect((await safeExit.getInsuranceStatus(wallet.address)).maxInsuranceAmount).to.equal(ether(2000));
  });

  it("Should return the correct token metadata URI", async function () {
    const wallet = ethers.Wallet.createRandom().connect(ethers.provider);

    await safeExit.connect(treasury).setMetadataUri(1, "ACTIVE", "READY", "DEAD");
    await safeExit.connect(treasury).mint(wallet.address, 1);

    expect(await safeExit.tokenURI(await safeExit.tokenOfOwnerByIndex(wallet.address, 0))).to.equal("READY");

    await transferEth({ from: deployer, to: wallet, amount: ether(10) });
    await transferEth({ from: deployer, to: safeExit, amount: ether(5) });
    await buyTokensFromDexByExactEth({ router, token, account: wallet, ethAmount: ether(5) });

    expect(await safeExit.tokenURI(await safeExit.tokenOfOwnerByIndex(wallet.address, 0))).to.equal("ACTIVE");

    await token.connect(wallet).approve(safeExit.address, MAX_INT);
    await safeExit.connect(wallet).claimSafeExit();
    expect(await safeExit.tokenURI(await safeExit.tokenOfOwnerByIndex(wallet.address, 0))).to.equal("DEAD");
  });
});
