// SPDX-License-Identifier: MIT

pragma solidity 0.8.4;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "./IDexPair.sol";
import "./IDexRouter.sol";
import "./IDexFactory.sol";

contract GuilderFi is IERC20, Ownable {

  using SafeMath for uint256;

  // EVENTS
  event LogRebase(uint256 indexed epoch, uint256 totalSupply);

  // TOKEN SETTINGS
  string private _name = "GuilderFi";
  string private _symbol = "NPLUS1";
  uint8 private constant DECIMALS = 18;

  // CONSTANTS
  uint256 private constant MAX_UINT256 = ~uint256(0);
  address private constant DEAD = 0x000000000000000000000000000000000000dEaD;
  address private constant ZERO = 0x0000000000000000000000000000000000000000;

  // SUPPLY CONSTANTS
  uint256 private constant INITIAL_FRAGMENTS_SUPPLY = 100 * 10**6 * 10**DECIMALS; // 100 million
  uint256 private constant MAX_SUPPLY = 5 * 10**12 * 10**DECIMALS; // 5 trillion
  uint256 private constant TOTAL_GONS = MAX_UINT256 - (MAX_UINT256 % INITIAL_FRAGMENTS_SUPPLY);

  // REBASE SETTINGS
  uint256 public constant YEAR1_REBASE_RATE = 707; // 0.00707 %
  uint256 public constant YEAR2_REBASE_RATE = 641; // 0.00641 %
  uint256 public constant YEAR3_REBASE_RATE = 575; // 0.00575 %
  uint256 public constant YEAR4_REBASE_RATE = 509; // 0.00509 %
  uint256 public constant YEAR5_REBASE_RATE = 443; // 0.00443 %
  uint256 public constant YEAR6_REBASE_RATE = 311; // 0.00311 %
  uint8   public constant REBASE_RATE_DECIMALS = 7;
  uint256 public constant REBASE_FREQUENCY = 12 minutes;
  
  // REBASE VARIABLES
  uint256 public maxRebaseCount = 40; // 8 hours
  uint256 public pendingRebases = 0;
  
  // ADDRESSES
  address public treasuryAddress = 0xdF6240E7f63cbFdb23e50D20270ECA8D457781B6; 
  address public insuranceAddress = 0x00E0B8c741E77fC0F877f6A4Ca372B878E08b89a;
  address public autoLiquidityAddress = 0x6Ba7B06dB3D5F8eB11d25B0209Dc76517787173F;
  address public burnAddress = DEAD;
  
  // DEX ADDRESSES
  address private constant DEX_ROUTER_ADDRESS = 0x10ED43C718714eb63d5aA57B78B54704E256024E; // PancakeSwap BSC Mainnet
  // address private constant DEX_ROUTER_ADDRESS = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1; // PancakeSwap BSC Testnet

  // FEES
  struct Fee {
    uint256 treasuryFee;
    uint256 insuranceFee;
    uint256 liquidityFee;
    uint256 burnFee;
    uint256 totalFee;
  }
  
  Fee private _buyFees = Fee(30, 50, 50, 0, 130);
  Fee private _sellFees = Fee(70, 50, 50, 0, 170);
  uint256 public feeDenominator = 1000;

  // FEES COLLECTED
  uint256 public treasuryFeesCollected;
  uint256 public insuranceFeesCollected;

  // SETTING FLAGS
  bool public swapEnabled = true;
  bool public autoRebaseEnabled = true;
  bool public autoAddLiquidityEnabled = true;

  // PRIVATE FLAGS
  bool private _inSwap = false;

  // EXCHANGE VARIABLES
  address public pairAddress;
  IDexRouter public router;
  IDexPair public pair;
  
  // DATE/TIME STAMPS
  uint256 public initRebaseStartTime;
  uint256 public lastRebaseTime;
  uint256 public lastAddLiquidityTime;
  uint256 public lastEpoch;

  // TOKEN SUPPLY VARIABLES
  uint256 private _totalSupply;
  uint256 private _gonsPerFragment;

  // DATA
  mapping(address => bool) private _isFeeExempt;
  mapping(address => uint256) private _gonBalances;
  mapping(address => mapping(address => uint256)) private _allowedFragments;
  mapping(address => bool) public blacklist;

  // PRE-SALE FLAG
  bool public isOpen = false;
  mapping(address => bool) private _allowPreSaleTransfer;

  // MODIFIERS
  modifier isOpenForTrade() {
    require(isOpen || msg.sender == owner() || _allowPreSaleTransfer[msg.sender], "Trading not open yet");
    _;
  }  

  modifier swapping() {
    _inSwap = true;
    _;
    _inSwap = false;
  }

  modifier validRecipient(address to) {
    require(to != address(0x0), "Cannot send to zero address");
    _;
  }

  constructor() Ownable() {

    // Set up DEX router/pair
    setDex(DEX_ROUTER_ADDRESS);

    // set exchange router allowance
    _allowedFragments[address(this)][address(router)] = type(uint256).max;
  
    // initialise total supply
    _totalSupply = INITIAL_FRAGMENTS_SUPPLY;
    _gonsPerFragment = TOTAL_GONS.div(_totalSupply);
    
    // exempt fees from contract + treasury
    _isFeeExempt[treasuryAddress] = true;
    _isFeeExempt[address(this)] = true;

    // transfer ownership + total supply to treasury
    _gonBalances[treasuryAddress] = TOTAL_GONS;
    _transferOwnership(treasuryAddress);

    emit Transfer(address(0x0), treasuryAddress, _totalSupply);
  }

  /*
   * REBASE FUNCTIONS
   */ 
  function rebase() public {
    
    if (_inSwap || !isOpen) {
      return;
    }

    uint256 rebaseRate = getRebaseRate();
    
    // work out how many rebases to perform
    uint256 deltaTime = block.timestamp - lastRebaseTime;
    uint256 times = deltaTime.div(REBASE_FREQUENCY);

    if (times == 0) {
      return;
    } 
    
    // if there are too many rebases, execute a maximum batch size
    if (times > maxRebaseCount) {
      pendingRebases = pendingRebases.add(times).sub(maxRebaseCount);
      times = maxRebaseCount;
    } else {
      pendingRebases = 0;
    }

    lastEpoch = lastEpoch.add(times);

    // increase total supply by rebase rate
    for (uint256 i = 0; i < times; i++) {
      _totalSupply = _totalSupply
        .mul((10**REBASE_RATE_DECIMALS).add(rebaseRate))
        .div(10**REBASE_RATE_DECIMALS);
    }

    _gonsPerFragment = TOTAL_GONS.div(_totalSupply);
    lastRebaseTime = lastRebaseTime.add(times.mul(REBASE_FREQUENCY));

    pair.sync();

    emit LogRebase(lastEpoch, _totalSupply);
  }

  function getRebaseRate() public view returns (uint256) {

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

  function transfer(address to, uint256 value) external override validRecipient(to) returns (bool) {
    _transferFrom(msg.sender, to, value);
    return true;
  }

  function transferFrom(address from, address to, uint256 value) external override validRecipient(to) returns (bool) {
    if (_allowedFragments[from][msg.sender] != type(uint256).max) {
      _allowedFragments[from][msg.sender] = _allowedFragments[from][msg.sender].sub(value, "Insufficient allowance");
    }
    _transferFrom(from, to, value);
    return true;
  }

  function _basicTransfer(address from, address to, uint256 amount) internal returns (bool) {
    uint256 gonAmount = amount.mul(_gonsPerFragment);
    _gonBalances[from] = _gonBalances[from].sub(gonAmount);
    _gonBalances[to] = _gonBalances[to].add(gonAmount);
    return true;
  }

  function _transferFrom(address sender, address recipient, uint256 amount) internal isOpenForTrade returns (bool) {

    require(!blacklist[sender] && !blacklist[recipient], "Address blacklisted");

    if (_inSwap) {
      return _basicTransfer(sender, recipient, amount);
    }

    if (shouldRebase()) {
       rebase();
    }

    if (shouldAddLiquidity()) {
      addLiquidity();
    }

    if (shouldSwapBack()) {
      swapBack();
    }

    uint256 gonAmount = amount.mul(_gonsPerFragment);
    uint256 gonAmountReceived = gonAmount;
    
    if (shouldTakeFee(sender, recipient)) {
      gonAmountReceived = takeFee(sender, recipient, gonAmount);
    }

    _gonBalances[sender] = _gonBalances[sender].sub(gonAmount);
    _gonBalances[recipient] = _gonBalances[recipient].add(gonAmountReceived);

    emit Transfer(
      sender,
      recipient,
      gonAmountReceived.div(_gonsPerFragment)
    );
    return true;
  }

  function takeFee(address, address recipient, uint256 gonAmount) internal  returns (uint256) {

    Fee storage fees = (recipient == pairAddress) ? _sellFees : _buyFees;

    uint256 burnAmount = gonAmount.div(feeDenominator).mul(fees.burnFee);
    uint256 treasuryAmount = gonAmount.div(feeDenominator).mul(fees.treasuryFee);
    uint256 insuranceAmount = gonAmount.div(feeDenominator).mul(fees.insuranceFee);
    uint256 liquidityAmount = gonAmount.div(feeDenominator).mul(fees.liquidityFee);
    uint256 totalFeeAmount = burnAmount + treasuryAmount + insuranceAmount + liquidityAmount;
     
    // burn 
    _gonBalances[burnAddress] = _gonBalances[burnAddress].add(burnAmount);

    // add treasury fees to smart contract
    _gonBalances[treasuryAddress] = _gonBalances[address(this)].add(treasuryAmount);
    treasuryFeesCollected = treasuryFeesCollected.add(treasuryAmount);
    
    // add insurance fees to smart contract
    _gonBalances[insuranceAddress] = _gonBalances[address(this)].add(insuranceAmount);
    insuranceFeesCollected = insuranceFeesCollected.add(insuranceAmount);

    // add liquidity fees to liquidity address
    _gonBalances[autoLiquidityAddress] = _gonBalances[autoLiquidityAddress].add(liquidityAmount);
    
    // emit Transfer(sender, address(this), totalFeeAmount.div(_gonsPerFragment));
    return gonAmount.sub(totalFeeAmount);
  }

  function addLiquidity() internal swapping {
    // transfer all tokens from liquidity account to contract
    uint256 autoLiquidityAmount = _gonBalances[autoLiquidityAddress].div(_gonsPerFragment);
    _gonBalances[address(this)] = _gonBalances[address(this)].add(_gonBalances[autoLiquidityAddress]);
    _gonBalances[autoLiquidityAddress] = 0;

    // calculate 50/50 split
    uint256 amountToLiquify = autoLiquidityAmount.div(2);
    uint256 amountToSwap = autoLiquidityAmount.sub(amountToLiquify);

    if( amountToSwap == 0 ) {
      return;
    }

    address[] memory path = new address[](2);
    path[0] = address(this);
    path[1] = router.WETH();

    uint256 balanceBefore = address(this).balance;

    // swap tokens for ETH
    router.swapExactTokensForETHSupportingFeeOnTransferTokens(
      amountToSwap,
      0,
      path,
      address(this),
      block.timestamp
    );

    uint256 amountETHLiquidity = address(this).balance.sub(balanceBefore);

    // add tokens + ETH to liquidity pool
    if (amountToLiquify > 0&&amountETHLiquidity > 0) {
      router.addLiquidityETH{value: amountETHLiquidity}(
        address(this),
        amountToLiquify,
        0,
        0,
        autoLiquidityAddress,
        block.timestamp
      );
    }

    lastAddLiquidityTime = block.timestamp;
  }

  function swapBack() internal swapping {

    uint256 totalGonFeesCollected = treasuryFeesCollected.add(insuranceFeesCollected);
    uint256 amountToSwap = totalGonFeesCollected.div(_gonsPerFragment);

    if (amountToSwap == 0) {
      return;
    }

    uint256 balanceBefore = address(this).balance;

    address[] memory path = new address[](2);
    path[0] = address(this);
    path[1] = router.WETH();

    // swap all tokens in contract for ETH
    router.swapExactTokensForETHSupportingFeeOnTransferTokens(
      amountToSwap,
      0,
      path,
      address(this),
      block.timestamp
    );

    uint256 amountETH = address(this).balance.sub(balanceBefore);
    uint256 treasuryETH = amountETH.mul(treasuryFeesCollected).div(totalGonFeesCollected);
    uint256 insuranceETH = amountETH.sub(treasuryETH);

    // send eth to treasury
    (bool success, ) = payable(treasuryAddress).call{ value: treasuryETH }("");

    // send eth to insurance
    (success, ) = payable(insuranceAddress).call{ value: insuranceETH }("");
  }

  /*
   * INTERNAL CHECKER FUNCTIONS
   */ 
  function shouldTakeFee(address from, address to) internal view returns (bool) {
    return 
      (pairAddress == from || pairAddress == to) &&
      !_isFeeExempt[from];
  }

  function shouldRebase() internal view returns (bool) {
    return
      autoRebaseEnabled &&
      isOpen &&
      (_totalSupply < MAX_SUPPLY) &&
      msg.sender != pairAddress  &&
      !_inSwap &&
      block.timestamp >= (lastRebaseTime + REBASE_FREQUENCY);
  }

  function shouldAddLiquidity() internal view returns (bool) {
    return
      autoAddLiquidityEnabled && 
      !_inSwap && 
      msg.sender != pairAddress &&
      block.timestamp >= (lastAddLiquidityTime + 2 days);
  }

  function shouldSwapBack() internal view returns (bool) {
    return 
      !_inSwap &&
      msg.sender != pairAddress; 
  }

  /*
   * TOKEN ALLOWANCE/APPROVALS
   */ 
  function allowance(address owner_, address spender) external view override returns (uint256) {
    return _allowedFragments[owner_][spender];
  }

  function decreaseAllowance(address spender, uint256 subtractedValue) external returns (bool) {
    uint256 oldValue = _allowedFragments[msg.sender][spender];
    
    if (subtractedValue >= oldValue) {
      _allowedFragments[msg.sender][spender] = 0;
    } else {
      _allowedFragments[msg.sender][spender] = oldValue.sub(subtractedValue);
    }

    emit Approval(
      msg.sender,
      spender,
      _allowedFragments[msg.sender][spender]
    );

    return true;
  }

  function increaseAllowance(address spender, uint256 addedValue) external returns (bool) {
    _allowedFragments[msg.sender][spender] = _allowedFragments[msg.sender][spender].add(addedValue);
    
    emit Approval(
      msg.sender,
      spender,
      _allowedFragments[msg.sender][spender]
    );

    return true;
  }

  function approve(address spender, uint256 value) external override returns (bool) {
    _allowedFragments[msg.sender][spender] = value;
    emit Approval(msg.sender, spender, value);
    return true;
  }

  function manualSync() external {
    IDexPair(pairAddress).sync();
  }

  /*
   * PUBLIC SETTER FUNCTIONS
   */ 
  function setAutoRebase(bool _flag) external onlyOwner {
    autoRebaseEnabled = _flag;
    if (_flag) {
      lastRebaseTime = block.timestamp;
    }
  }

  function setAutoAddLiquidity(bool _flag) external onlyOwner {
    autoAddLiquidityEnabled = _flag;
    if(_flag) {
      lastAddLiquidityTime = block.timestamp;
    }
  }

  function setFeeExempt(address _address, bool _flag) external onlyOwner {
    _isFeeExempt[_address] = _flag;
  }

  function setBlacklist(address _address, bool _flag) external onlyOwner {
    blacklist[_address] = _flag;  
  }

  function allowPreSaleTransfer(address _addr, bool _flag) external onlyOwner {
    _allowPreSaleTransfer[_addr] = _flag;
  }

  function setMaxRebaseCount(uint256 _maxRebaseCount) external onlyOwner {
    maxRebaseCount = _maxRebaseCount;
  }

  function setDex(address routerAddress) public onlyOwner {
    router = IDexRouter(routerAddress); 
    pairAddress = IDexFactory(router.factory()).createPair(router.WETH(), address(this));
    pair = IDexPair(pairAddress);
  }

  function setFeeReceivers(
    address _autoLiquidityAddress,
    address _treasuryAddress,
    address _insuranceAddress,
    address _burnAddress
  ) external onlyOwner {
    autoLiquidityAddress = _autoLiquidityAddress;
    treasuryAddress = _treasuryAddress;
    insuranceAddress = _insuranceAddress;
    burnAddress = _burnAddress;
  }

  function openTrade() external onlyOwner {
    isOpen = true;
    
    // record rebase timestamps
    initRebaseStartTime = block.timestamp;
    lastRebaseTime = block.timestamp;
    lastEpoch = 0;
  }
  
  /*
   * EXTERNAL GETTER FUNCTIONS
   */ 
  function getLiquidityBacking(uint256 accuracy) public view returns (uint256) {
    uint256 liquidityBalance = _gonBalances[pairAddress].div(_gonsPerFragment);
    return accuracy.mul(liquidityBalance.mul(2)).div(getCirculatingSupply());
  }

  function getCirculatingSupply() public view returns (uint256) {
    return (TOTAL_GONS.sub(_gonBalances[DEAD]).sub(_gonBalances[ZERO])).div(_gonsPerFragment);
  }

  function checkFeeExempt(address _addr) external view returns (bool) {
    return _isFeeExempt[_addr];
  }

  function isNotInSwap() external view returns (bool) {
    return !_inSwap;
  }

  /*
   * STANDARD ERC20 FUNCTIONS
   */ 
  function totalSupply() external view override returns (uint256) {
    return _totalSupply;
  }
   
  function balanceOf(address who) external view override returns (uint256) {
    return _gonBalances[who].div(_gonsPerFragment);
  }

  function name() public view returns (string memory) {
    return _name;
  }

  function symbol() public view returns (string memory) {
    return _symbol;
  }

  function decimals() public pure returns (uint8) {
    return DECIMALS;
  }

  receive() external payable {}

  // Withdraw any locked ERC20 tokens sent to this contract
  function withdrawLockedTokens(address _token, uint256 _amount) external onlyOwner {
    IERC20(_token).transfer(msg.sender, _amount);
  }

  // Withdraw any locked ETH sent to this contract
  function withdrawLockedETH(uint256 _amount) external onlyOwner returns (bool) {
    (bool success, ) = payable(msg.sender).call{ value: _amount }("");
    return success;
  }
}