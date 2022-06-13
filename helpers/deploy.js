const { TESTNET_DEX_ROUTER_ADDRESS } = process.env;
const TOKEN_NAME = "GuilderFi";

const deploy = async ({ ethers, deployer, treasury }) => {
  let tx;

  const Token = await ethers.getContractFactory(TOKEN_NAME);
  const SwapEngine = await ethers.getContractFactory("SwapEngine");
  const AutoLiquidityEngine = await ethers.getContractFactory("AutoLiquidityEngine");
  const LiquidityReliefFund = await ethers.getContractFactory("LiquidityReliefFund");
  const SafeExitFund = await ethers.getContractFactory("SafeExitFund");
  const PreSale = await ethers.getContractFactory("PreSale");

  // Deploy contract
  const token = await Token.deploy();
  await token.deployed();

  // create swap engine
  const _swapEngine = await SwapEngine.connect(deployer).deploy(token.address);
  await _swapEngine.deployed();
  await token.connect(deployer).setSwapEngine(_swapEngine.address);

  // create auto liquidity engine
  const _autoLiquidityEngine = await AutoLiquidityEngine.connect(deployer).deploy(token.address);
  await _autoLiquidityEngine.deployed();
  await token.connect(deployer).setLiquidityEngine(_autoLiquidityEngine.address);

  // create LRF
  const _lrf = await LiquidityReliefFund.connect(deployer).deploy(token.address);
  await _lrf.deployed();
  await token.connect(deployer).setLrf(_lrf.address);

  // create safe exit fund
  const _safeExit = await SafeExitFund.connect(deployer).deploy(token.address);
  await _safeExit.deployed();
  await token.connect(deployer).setSafeExitFund(_safeExit.address);

  // create pre-sale
  const _preSale = await PreSale.connect(deployer).deploy(token.address);
  await _preSale.deployed();
  await token.connect(deployer).setPreSaleEngine(_preSale.address);

  // set up dex
  await token.connect(deployer).setDex(TESTNET_DEX_ROUTER_ADDRESS);

  // set up treasury
  await token.connect(deployer).setTreasury(treasury.address);

  // settings
  tx = await token.connect(treasury).setAutoSwap(true);
  await tx.wait();

  tx = await token.connect(treasury).setAutoLiquidity(false);
  await tx.wait();

  tx = await token.connect(treasury).setAutoRebase(true);
  await tx.wait();

  tx = await token.connect(treasury).setAutoLrf(false);
  await tx.wait();

  tx = await token.connect(treasury).setAutoSafeExit(false);
  await tx.wait();

  tx = await token.connect(treasury).setAutoLiquidityFrequency(0);
  await tx.wait();

  tx = await token.connect(treasury).setLrfFrequency(0);
  await tx.wait();

  tx = await token.connect(treasury).setSwapFrequency(0);
  await tx.wait();

  return token;
};

module.exports = { deploy };
