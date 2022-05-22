const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");
const clc = require("cli-color");

const DECIMALS = 18;
const MAX_INT = ethers.constants.MaxUint256;

const addZeroes = (num, zeroes) => {
  return BigNumber.from(num).mul(BigNumber.from(10).pow(zeroes));
};

const ether = (num) => {
  const numString = num.toString();
  const decimals = numString.indexOf(".") > 0 ? numString.split(".")[1].length : 0;
  return BigNumber.from(numString.replace(".", "")).mul(BigNumber.from(10).pow(DECIMALS - decimals));
};

const print = (msg) => {
  console.log(clc.xterm(8)("      " + msg));
};

// calculate gas used in a transaction
const gasUsed = async (tx) => {
  const receipt = await tx.wait();
  const { cumulativeGasUsed, effectiveGasPrice } = receipt;
  const _gasUsed = cumulativeGasUsed.mul(effectiveGasPrice);
  return _gasUsed;
};

const transferTokens = async ({ token, from, to, amount }) => {
  const tx = await token.connect(from).transfer(to.address, amount);
  return tx;
};

const transferEth = async ({ from, to, amount }) => {
  const tx = await from.sendTransaction({
    to: to.address,
    value: amount,
  });

  return tx;
};

const addLiquidity = async ({ router, from, token, tokenAmount, ethAmount }) => {
  const timestamp = (await ethers.provider.getBlock("latest")).timestamp + 1;
  const tx = await router.connect(from).addLiquidityETH(token.address, tokenAmount, 0, 0, from.address, timestamp, {
    value: ethAmount,
  });

  return tx;
};

const buyTokensFromDex = async ({ router, pair, token, account, tokenAmount }) => {
  const { ethReserves, tokenReserves } = await getLiquidityReserves({ token, pair });

  // calculate how much eth is needed
  const numerator = ethReserves.mul(tokenAmount).mul(10000);
  const denominator = tokenReserves.sub(tokenAmount).mul(9970);
  const ethAmount = numerator.div(denominator).add(1);

  const tx = await router
    .connect(account)
    .swapETHForExactTokens(
      tokenAmount,
      [await router.WETH(), token.address],
      account.address,
      (await ethers.provider.getBlock("latest")).timestamp + 1,
      { value: ethAmount }
    );

  return tx;
};

const buyTokensFromDexByExactEth = async ({ router, token, account, ethAmount }) => {
  const tx = await router.connect(account).swapExactETHForTokens(
    0, // min number of tokens
    [await router.WETH(), token.address],
    account.address,
    (await ethers.provider.getBlock("latest")).timestamp + 1,
    { value: ethAmount }
  );

  return tx;
};

const sellTokens = async ({ router, token, account, tokenAmount, expiry }) => {
  const tx = await router.connect(account).swapExactTokensForETHSupportingFeeOnTransferTokens(
    tokenAmount,
    0, // minimum ETH out
    [token.address, await router.WETH()], // pair
    account.address, // recipient
    expiry ?? (await ethers.provider.getBlock("latest")).timestamp + 1
  );

  return tx;
};

const getLiquidityReserves = async ({ token, pair }) => {
  let returnVal;
  const reserves = await pair.getReserves();

  // Check which token (0/1) is eth vs token
  if ((await pair.token0()) === token.address) {
    returnVal = {
      tokenReserves: reserves.reserve0,
      ethReserves: reserves.reserve1,
    };
  } else {
    returnVal = {
      tokenReserves: reserves.reserve1,
      ethReserves: reserves.reserve0,
    };
  }

  returnVal.tokenPrice = returnVal.ethReserves / returnVal.tokenReserves;
  return returnVal;
};

const calculateEthToReceive = async ({ token, pair, tokenAmount }) => {
  const reserves = await getLiquidityReserves({ token, pair });
  const amountInWithFee = tokenAmount.mul(9975);
  const numerator = amountInWithFee.mul(reserves.ethReserves);
  const denominator = reserves.tokenReserves.mul(10000).add(amountInWithFee);
  return numerator.div(denominator);
};

const calculateLPtokens = ({ tokenAmount, ethAmount }) => {
  // https://www.reddit.com/r/UniSwap/comments/i49dmk/how_are_lp_token_amounts_calculated/

  const MINIMUM_LIQUIDITY = 1000;

  const sqrt = (value) => {
    const ONE = ethers.BigNumber.from(1);
    const TWO = ethers.BigNumber.from(2);

    const x = BigNumber.from(value);
    let z = x.add(ONE).div(TWO);
    let y = x;
    while (z.sub(y).isNegative()) {
      y = z;
      z = x.div(z).add(z).div(TWO);
    }
    return y;
  };

  return sqrt(tokenAmount.mul(ethAmount)).sub(MINIMUM_LIQUIDITY);
};

const printStatus = async ({ token, treasury, lrf, safeExit, pair }) => {
  const treasuryBalance = await ethers.provider.getBalance(treasury.address);
  const lrfBalance = await ethers.provider.getBalance(lrf.address);
  const lrfTokenBalance = await token.balanceOf(lrf.address);
  const feesCollected = await token.balanceOf(token.address);
  const { ethReserves, tokenReserves } = await getLiquidityReserves({ token, pair });
  const liquidityTokens = await token.balanceOf(await token.autoLiquidityEngine());
  const safeExitFundBalance = await ethers.provider.getBalance(safeExit.address);
  const backedLiquidity = BigNumber.from("1000000000000000000")
    .mul(treasuryBalance.add(lrfBalance))
    .div(ethReserves.mul(BigNumber.from("10000000000000000")));

  console.log();
  console.log(`Treasury - eth:   ${ethers.utils.formatEther(treasuryBalance, { comify: true })}`);
  console.log(`LRF - eth:        ${ethers.utils.formatEther(lrfBalance, { comify: true })}`);
  console.log(`LRF - tokens:     ${ethers.utils.formatEther(lrfTokenBalance, { comify: true })}`);
  console.log(`Total assets:     ${ethers.utils.formatEther(lrfBalance.add(treasuryBalance), { comify: true })}`);
  console.log();
  console.log(`LP - eth:         ${ethers.utils.formatEther(ethReserves, { comify: true })}`);
  console.log(`LP - tokens:      ${ethers.utils.formatEther(tokenReserves, { comify: true })}`);
  console.log(`Backed liquidity: ${backedLiquidity}%`);
  console.log();
  console.log(`Token fees coll:  ${ethers.utils.formatEther(feesCollected, { comify: true })}`);
  console.log(`Liquidity tokens: ${ethers.utils.formatEther(liquidityTokens, { comify: true })}`);
  console.log(
    `Liquidity eng ETH: ${ethers.utils.formatEther(await ethers.provider.getBalance(await token.autoLiquidityEngine()), { comify: true })}`
  );
  console.log();
  console.log(`Safe exit fund:   ${ethers.utils.formatEther(safeExitFundBalance, { comify: true })}`);
};

module.exports = {
  DECIMALS,
  MAX_INT,
  ether,
  addZeroes,
  print,
  transferTokens,
  transferEth,
  buyTokensFromDex,
  buyTokensFromDexByExactEth,
  sellTokens,
  addLiquidity,
  getLiquidityReserves,
  calculateEthToReceive,
  calculateLPtokens,
  printStatus,
  gasUsed,
};
