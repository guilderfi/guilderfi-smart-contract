// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

// Libraries
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Interfaces
import "./interfaces/IDexPair.sol";
import "./interfaces/IDexRouter.sol";
import "./interfaces/IDexFactory.sol";
import "./interfaces/IGuilderFi.sol";
import "./interfaces/ISwapEngine.sol";
import "./interfaces/ILiquidityReliefFund.sol";
import "./interfaces/IAutoLiquidityEngine.sol";
import "./interfaces/ISafeExitFund.sol";
import "./interfaces/IPreSale.sol";

contract GuilderFi is IGuilderFi, IERC20, Ownable {
  using SafeMath for uint256;
  bool internal blocked = false;

  // TOKEN SETTINGS
  string private _name = "GuilderFi";
  string private _symbol = "N1";
  uint8 private constant DECIMALS = 18;

  // CONSTANTS
  uint256 private constant MAX_UINT256 = ~uint256(0);
  address private constant DEAD = 0x000000000000000000000000000000000000dEaD;
  address private constant ZERO = 0x0000000000000000000000000000000000000000;

  // SUPPLY CONSTANTS
  uint256 private constant INITIAL_FRAGMENTS_SUPPLY = 1 * 10**6 * 10**DECIMALS; // 1 million
  uint256 private constant MAX_SUPPLY = 82 * 10**21 * 10**DECIMALS;
  uint256 private constant TOTAL_GONS = MAX_UINT256 - (MAX_UINT256 % INITIAL_FRAGMENTS_SUPPLY);

  // REBASE CONSTANTS
  uint256 private constant YEAR1_REBASE_RATE = 160309122470000; // 0.0160309122470000 %
  uint256 private constant YEAR2_REBASE_RATE = 144501813571063; // 0.0144501813571063 %
  uint256 private constant YEAR3_REBASE_RATE = 128715080592867; // 0.0128715080592867 %
  uint256 private constant YEAR4_REBASE_RATE = 112969085762193; // 0.0112969085762193 %
  uint256 private constant YEAR5_REBASE_RATE = 97303671485527; // 0.0097303671485527 %
  uint256 private constant YEAR6_REBASE_RATE = 34322491203609; // 0.0034322491203609 %
  uint8 private constant REBASE_RATE_DECIMALS = 18;
  uint256 private constant REBASE_FREQUENCY = 12 minutes;

  // REBASE VARIABLES
  uint256 public override maxRebaseBatchSize = 40; // 8 hours

  // ADDRESSES
  address internal _treasuryAddress;
  address internal _burnAddress = DEAD;

  // OTHER CONTRACTS
  ISwapEngine private swapEngine;
  ILiquidityReliefFund private lrf;
  IAutoLiquidityEngine private autoLiquidityEngine;
  ISafeExitFund private safeExitFund;
  IPreSale private preSale;

  address private _swapEngineAddress;
  address private _lrfAddress;
  address private _autoLiquidityEngineAddress;
  address private _safeExitFundAddress;
  address private _preSaleAddress;

  // FEES
  uint256 private constant MAX_BUY_FEES = 200; // 20%
  uint256 private constant MAX_SELL_FEES = 250; // 25%
  uint256 private constant FEE_DENOMINATOR = 1000;

  // BUY FEES | Treasury = 3% | LRF = 5% | Auto-Liquidity = 5% | SafeExit = 0 | Burn = 0
  Fee private _buyFees = Fee(30, 50, 50, 0, 0, 130);

  // SELL FEES | Treasury = 4% | LRF = 7% | Auto-Liquidity = 6% | SafeExit = 1% | Burn = 0
  Fee private _sellFees = Fee(40, 70, 60, 10, 0, 180);

  // SETTING FLAGS
  bool public override isAutoRebaseEnabled = true;
  bool public override isAutoSafeExitEnabled = true;
  bool public override isAutoSwapEnabled = false;
  bool public override isAutoLiquidityEnabled = false;
  bool public override isAutoLrfEnabled = false;

  // FREQUENCIES
  uint256 public override autoSwapFrequency = 0;
  uint256 public override autoLiquidityFrequency = 0;
  uint256 public override autoLrfFrequency = 0;

  // PRIVATE FLAGS
  bool private _inSwap = false;

  // EXCHANGE VARIABLES
  IDexRouter private _router;
  IDexPair private _pair;

  // DATE/TIME STAMPS
  uint256 public override initRebaseStartTime;
  uint256 public override lastRebaseTime;
  uint256 public override lastAddLiquidityTime;
  uint256 public override lastLrfExecutionTime;
  uint256 public override lastSwapTime;
  uint256 public override lastEpoch;

  // TOKEN SUPPLY VARIABLES
  uint256 private _totalSupply;
  uint256 private _gonsPerFragment;

  // DATA
  mapping(address => bool) private _isFeeExempt;
  mapping(address => bool) private _isContract;
  mapping(address => uint256) private _gonBalances;
  mapping(address => mapping(address => uint256)) private _allowedFragments;
  mapping(address => bool) public blacklist;

  // TOKEN LAUNCHED FLAG
  bool public override hasLaunched = false;

  modifier swapping() {
    _inSwap = true;
    _;
    _inSwap = false;
  }

  modifier validRecipient(address to) {
    require(to != address(0x0), "Cannot send to zero address");
    _;
  }

  modifier canTrade(address from) {
    require(hasLaunched || from == address(_treasuryAddress) || _isContract[from], "Token has not launched yet");
    _;
  }

  constructor() Ownable() {
    // init treasury address
    _treasuryAddress = msg.sender;

    // initialise total supply
    _totalSupply = INITIAL_FRAGMENTS_SUPPLY;
    _gonsPerFragment = TOTAL_GONS.div(_totalSupply);

    // exempt fees from contract + treasury
    _isFeeExempt[address(this)] = true;
    _isFeeExempt[_treasuryAddress] = true;

    // assign total supply to treasury
    _gonBalances[_treasuryAddress] = TOTAL_GONS;
    emit Transfer(address(0x0), _treasuryAddress, _totalSupply);
  }

  function setSwapEngine(address _address) external override onlyOwner {
    _swapEngineAddress = _address;
    swapEngine = ISwapEngine(_address);
    initSubContract(_address);
  }

  function setLrf(address _address) external override onlyOwner {
    _lrfAddress = _address;
    lrf = ILiquidityReliefFund(_address);
    initSubContract(_address);
  }

  function setLiquidityEngine(address _address) external override onlyOwner {
    _autoLiquidityEngineAddress = _address;
    autoLiquidityEngine = IAutoLiquidityEngine(_address);
    initSubContract(_address);
  }

  function setSafeExitFund(address _address) external override onlyOwner {
    _safeExitFundAddress = _address;
    safeExitFund = ISafeExitFund(_address);
    initSubContract(_address);
  }

  function setPreSaleEngine(address _address) external override onlyOwner {
    _preSaleAddress = _address;
    preSale = IPreSale(_address);
    initSubContract(_address);
  }

  function initSubContract(address _address) internal {
    if (address(_router) != address(0)) {
      _allowedFragments[_address][address(_router)] = type(uint256).max;
    }

    _isContract[_address] = true;
    _isFeeExempt[_address] = true;
  }

  function setTreasury(address _address) external override onlyOwner {
    require(_treasuryAddress != _address, "Address already in use");

    _gonBalances[_address] = _gonBalances[_treasuryAddress];
    _gonBalances[_treasuryAddress] = 0;
    emit Transfer(_treasuryAddress, _address, _gonBalances[_address].div(_gonsPerFragment));

    _treasuryAddress = _address;

    // exempt fees
    _isFeeExempt[_treasuryAddress] = true;

    // transfer ownership
    _transferOwnership(_treasuryAddress);
  }

  /*
   * REBASE FUNCTIONS
   */
  function rebase() public override {
    require(hasLaunched, "Token has not launched yet");
    _rebase();
  }

  function _rebase() internal {
    // work out how many rebases to perform
    uint256 times = pendingRebases();

    if (times == 0) {
      return;
    }

    uint256 rebaseRate = getRebaseRate();

    // if there are too many pending rebases, execute a maximum batch size
    if (times > maxRebaseBatchSize) {
      times = maxRebaseBatchSize;
    }

    lastEpoch = lastEpoch.add(times);

    // increase total supply by rebase rate
    for (uint256 i = 0; i < times; i++) {
      _totalSupply = _totalSupply.mul((10**REBASE_RATE_DECIMALS).add(rebaseRate)).div(10**REBASE_RATE_DECIMALS);
    }

    _gonsPerFragment = TOTAL_GONS.div(_totalSupply);
    lastRebaseTime = lastRebaseTime.add(times.mul(REBASE_FREQUENCY));

    if (!_inSwap) {
      _pair.sync();
    }

    emit LogRebase(lastEpoch, _totalSupply, pendingRebases());
  }

  function getRebaseRate() public view override returns (uint256) {
    // calculate rebase rate depending on time passed since token launch
    uint256 deltaTimeFromInit = block.timestamp - initRebaseStartTime;

    if (deltaTimeFromInit < (365 days)) {
      return YEAR1_REBASE_RATE;
    } else if (deltaTimeFromInit >= (365 days) && deltaTimeFromInit < (2 * 365 days)) {
      return YEAR2_REBASE_RATE;
    } else if (deltaTimeFromInit >= (2 * 365 days) && deltaTimeFromInit < (3 * 365 days)) {
      return YEAR3_REBASE_RATE;
    } else if (deltaTimeFromInit >= (3 * 365 days) && deltaTimeFromInit < (4 * 365 days)) {
      return YEAR4_REBASE_RATE;
    } else if (deltaTimeFromInit >= (4 * 365 days) && deltaTimeFromInit < (5 * 365 days)) {
      return YEAR5_REBASE_RATE;
    } else {
      return YEAR6_REBASE_RATE;
    }
  }

  function pendingRebases() internal view returns (uint256) {
    uint256 timeSinceLastRebase = block.timestamp - lastRebaseTime;
    return timeSinceLastRebase.div(REBASE_FREQUENCY);
  }

  function transfer(address to, uint256 value) external override(IGuilderFi, IERC20) validRecipient(to) returns (bool) {
    _transferFrom(msg.sender, to, value);
    return true;
  }

  function transferFrom(
    address from,
    address to,
    uint256 value
  ) external override(IGuilderFi, IERC20) validRecipient(to) returns (bool) {
    if (_allowedFragments[from][msg.sender] != type(uint256).max) {
      _allowedFragments[from][msg.sender] = _allowedFragments[from][msg.sender].sub(value, "Insufficient allowance");
    }

    _transferFrom(from, to, value);
    return true;
  }

  function _basicTransfer(
    address from,
    address to,
    uint256 amount
  ) internal returns (bool) {
    uint256 gonAmount = amount.mul(_gonsPerFragment);
    _gonBalances[from] = _gonBalances[from].sub(gonAmount);
    _gonBalances[to] = _gonBalances[to].add(gonAmount);
    return true;
  }

  function shouldDoBasicTransfer(address sender, address recipient) internal view returns (bool) {
    if (_inSwap) return true;
    if (_isContract[sender]) return true;
    if (_isContract[recipient]) return true;
    if (sender == address(_router) || recipient == address(_router)) return true;
    if (swapEngine.inSwap() || lrf.inSwap() || autoLiquidityEngine.inSwap()) return true;
    return false;
  }

  function _transferFrom(
    address sender,
    address recipient,
    uint256 amount
  ) internal canTrade(sender) returns (bool) {
    require(!blacklist[sender] && !blacklist[recipient], "Address blacklisted");

    if (shouldDoBasicTransfer(sender, recipient)) {
      return _basicTransfer(sender, recipient, amount);
    }

    preTransactionActions(sender, recipient, amount);

    uint256 gonAmount = amount.mul(_gonsPerFragment);
    uint256 gonAmountReceived = gonAmount;

    if (shouldTakeFee(sender, recipient)) {
      gonAmountReceived = takeFee(sender, recipient, gonAmount);
    }

    _gonBalances[sender] = _gonBalances[sender].sub(gonAmount);
    _gonBalances[recipient] = _gonBalances[recipient].add(gonAmountReceived);

    emit Transfer(sender, recipient, gonAmountReceived.div(_gonsPerFragment));

    return true;
  }

  function preTransactionActions(
    address sender,
    address recipient,
    uint256 amount
  ) internal swapping {
    if (shouldExecuteSafeExit()) {
      safeExitFund.captureTransaction(sender, recipient, amount);
    }

    if (shouldSwap()) {
      swapEngine.executeSwapEngine();
      lastSwapTime = block.timestamp;
    }

    if (shouldAddLiquidity()) {
      autoLiquidityEngine.executeLiquidityEngine();
      lastAddLiquidityTime = block.timestamp;
    }

    if (shouldExecuteLrf()) {
      lrf.executeLiquidityReliefFund();
      lastLrfExecutionTime = block.timestamp;
    }

    if (shouldRebase()) {
      _rebase();
    }
  }

  function takeFee(
    address sender,
    address recipient,
    uint256 gonAmount
  ) internal returns (uint256) {
    Fee storage fees = (recipient == address(_pair)) ? _sellFees : _buyFees;

    uint256 burnAmount = fees.burnFee.mul(gonAmount).div(FEE_DENOMINATOR);
    uint256 lrfAmount = fees.lrfFee.mul(gonAmount).div(FEE_DENOMINATOR);
    uint256 safeExitAmount = fees.safeExitFee.mul(gonAmount).div(FEE_DENOMINATOR);
    uint256 liquidityAmount = fees.liquidityFee.mul(gonAmount).div(FEE_DENOMINATOR);
    uint256 treasuryAmount = fees.treasuryFee.mul(gonAmount).div(FEE_DENOMINATOR);

    uint256 totalToSwap = lrfAmount.add(safeExitAmount).add(treasuryAmount);

    uint256 total = totalToSwap.add(burnAmount).add(liquidityAmount);

    // burn
    if (burnAmount > 0) {
      _gonBalances[_burnAddress] = _gonBalances[_burnAddress].add(burnAmount);
      emit Transfer(sender, _burnAddress, burnAmount.div(_gonsPerFragment));
    }

    // add liquidity fees to auto liquidity engine
    _gonBalances[_autoLiquidityEngineAddress] = _gonBalances[_autoLiquidityEngineAddress].add(liquidityAmount);
    emit Transfer(sender, _autoLiquidityEngineAddress, liquidityAmount.div(_gonsPerFragment));

    // move the rest to swap engine
    _gonBalances[_swapEngineAddress] = _gonBalances[_swapEngineAddress].add(totalToSwap);
    emit Transfer(sender, _swapEngineAddress, totalToSwap.div(_gonsPerFragment));

    // record fees in swap engine
    if (address(swapEngine) != address(0)) {
      swapEngine.recordFees(lrfAmount.div(_gonsPerFragment), safeExitAmount.div(_gonsPerFragment), treasuryAmount.div(_gonsPerFragment));
    }

    return gonAmount.sub(total);
  }

  /*
   * INTERNAL CHECKER FUNCTIONS
   */
  function shouldTakeFee(address from, address to) internal view returns (bool) {
    if (_isFeeExempt[from]) return false;
    if (address(_pair) == from || address(_pair) == to) return true;

    return false;
  }

  function shouldRebase() internal view returns (bool) {
    return isAutoRebaseEnabled && hasLaunched && (_totalSupply < MAX_SUPPLY) && block.timestamp >= (lastRebaseTime + REBASE_FREQUENCY);
  }

  function shouldAddLiquidity() internal view returns (bool) {
    return
      isAutoLiquidityEnabled &&
      _autoLiquidityEngineAddress != address(0) &&
      (autoLiquidityFrequency == 0 || (block.timestamp >= (lastAddLiquidityTime + autoLiquidityFrequency)));
  }

  function shouldSwap() internal view returns (bool) {
    return
      isAutoSwapEnabled &&
      _swapEngineAddress != address(0) &&
      (autoSwapFrequency == 0 || (block.timestamp >= (lastSwapTime + autoSwapFrequency)));
  }

  function shouldExecuteLrf() internal view returns (bool) {
    return
      isAutoLrfEnabled &&
      _lrfAddress != address(0) &&
      (autoLrfFrequency == 0 || (block.timestamp >= (lastLrfExecutionTime + autoLrfFrequency)));
  }

  function shouldExecuteSafeExit() internal view returns (bool) {
    return isAutoSafeExitEnabled && _safeExitFundAddress != address(0);
  }

  /*
   * TOKEN ALLOWANCE/APPROVALS
   */
  function allowance(address owner_, address spender) public view override(IGuilderFi, IERC20) returns (uint256) {
    return _allowedFragments[owner_][spender];
  }

  function approve(address spender, uint256 value) external override(IGuilderFi, IERC20) returns (bool) {
    _allowedFragments[msg.sender][spender] = value;
    emit Approval(msg.sender, spender, value);
    return true;
  }

  function manualSync() external override {
    IDexPair(address(_pair)).sync();
  }

  /*
   * PUBLIC SETTER FUNCTIONS
   */
  function setAutoSwap(bool _flag) external override onlyOwner {
    isAutoSwapEnabled = _flag;
  }

  function setAutoLrf(bool _flag) external override onlyOwner {
    isAutoLrfEnabled = _flag;
  }

  function setAutoLiquidity(bool _flag) external override onlyOwner {
    isAutoLiquidityEnabled = _flag;
  }

  function setAutoRebase(bool _flag) external override onlyOwner {
    isAutoRebaseEnabled = _flag;
  }

  function setAutoSafeExit(bool _flag) external override onlyOwner {
    isAutoSafeExitEnabled = _flag;
  }

  function setFeeExempt(address _address, bool _flag) external override onlyOwner {
    _isFeeExempt[_address] = _flag;
  }

  function setBlacklist(address _address, bool _flag) external override onlyOwner {
    blacklist[_address] = _flag;
  }

  function setDex(address _routerAddress) external override onlyOwner {
    _router = IDexRouter(_routerAddress);

    IDexFactory factory = IDexFactory(_router.factory());
    address pairAddress = factory.getPair(_router.WETH(), address(this));

    if (pairAddress == address(0)) {
      pairAddress = IDexFactory(_router.factory()).createPair(_router.WETH(), address(this));
    }
    _pair = IDexPair(address(pairAddress));

    // exempt fees
    _isFeeExempt[_routerAddress] = true;

    // update allowances
    _allowedFragments[address(this)][_routerAddress] = type(uint256).max;
    _allowedFragments[address(swapEngine)][_routerAddress] = type(uint256).max;
    _allowedFragments[address(lrf)][_routerAddress] = type(uint256).max;
    _allowedFragments[address(autoLiquidityEngine)][_routerAddress] = type(uint256).max;
    _allowedFragments[address(safeExitFund)][_routerAddress] = type(uint256).max;
    _allowedFragments[address(preSale)][_routerAddress] = type(uint256).max;
  }

  function setAutoLiquidityFrequency(uint256 _frequency) external override onlyOwner {
    autoLiquidityFrequency = _frequency;
  }

  function setLrfFrequency(uint256 _frequency) external override onlyOwner {
    autoLrfFrequency = _frequency;
  }

  function setSwapFrequency(uint256 _frequency) external override onlyOwner {
    autoSwapFrequency = _frequency;
  }

  function setFees(
    bool _isSellFee,
    uint256 _treasuryFee,
    uint256 _lrfFee,
    uint256 _liquidityFee,
    uint256 _safeExitFee,
    uint256 _burnFee
  ) external override onlyOwner {
    uint256 feeTotal = _treasuryFee.add(_lrfFee).add(_liquidityFee).add(_safeExitFee).add(_burnFee);

    Fee memory fee = Fee(_treasuryFee, _lrfFee, _liquidityFee, _safeExitFee, _burnFee, feeTotal);

    if (_isSellFee) {
      require(feeTotal <= MAX_SELL_FEES, "Sell fees are too high");
      _sellFees = fee;
    }

    if (!_isSellFee) {
      require(feeTotal <= MAX_BUY_FEES, "Buy fees are too high");
      _buyFees = fee;
    }
  }

  function launchToken() external override onlyOwner {
    require(!hasLaunched, "Token has already launched");

    hasLaunched = true;

    // record rebase timestamps
    lastSwapTime = block.timestamp;
    lastLrfExecutionTime = block.timestamp;
    lastAddLiquidityTime = block.timestamp;
    initRebaseStartTime = block.timestamp;
    lastRebaseTime = block.timestamp;
    lastEpoch = 0;
  }

  /*
   * EXTERNAL GETTER FUNCTIONS
   */
  function getOwner() public view override returns (address) {
    return owner();
  }

  function getTreasuryAddress() public view override returns (address) {
    return _treasuryAddress;
  }

  function getSwapEngineAddress() public view override returns (address) {
    return address(swapEngine);
  }

  function getLrfAddress() public view override returns (address) {
    return address(lrf);
  }

  function getAutoLiquidityAddress() public view override returns (address) {
    return address(autoLiquidityEngine);
  }

  function getSafeExitFundAddress() public view override returns (address) {
    return address(safeExitFund);
  }

  function getPreSaleAddress() public view override returns (address) {
    return address(preSale);
  }

  function getRouter() public view override returns (address) {
    return address(_router);
  }

  function getPair() public view override returns (address) {
    return address(_pair);
  }

  /*
   * STANDARD ERC20 FUNCTIONS
   */
  function totalSupply() external view override(IGuilderFi, IERC20) returns (uint256) {
    return _totalSupply;
  }

  function balanceOf(address who) public view override(IGuilderFi, IERC20) returns (uint256) {
    return _gonBalances[who].div(_gonsPerFragment);
  }

  function name() public view override returns (string memory) {
    return _name;
  }

  function symbol() public view override returns (string memory) {
    return _symbol;
  }

  function decimals() public pure override returns (uint8) {
    return DECIMALS;
  }

  receive() external payable {}
}
