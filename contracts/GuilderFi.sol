// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

// Libraries
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// Interfaces
import "./interfaces/IDexPair.sol";
import "./interfaces/IDexRouter.sol";
import "./interfaces/IDexFactory.sol";
import "./interfaces/IGuilderFi.sol";

// Other contracts
import "./SwapEngine.sol";
import "./LiquidityReliefFund.sol";
import "./AutoLiquidityEngine.sol";
import "./SafeExitFund.sol";
import "./PreSale.sol";

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
    // uint256 private constant INITIAL_FRAGMENTS_SUPPLY = 100000 * 10**DECIMALS; // 100,000 for testing
    uint256 private constant INITIAL_FRAGMENTS_SUPPLY = 100 * 10**6 * 10**DECIMALS; // 100 million
    uint256 private constant MAX_SUPPLY = 82 * 10**21 * 10**DECIMALS;
    uint256 private constant TOTAL_GONS = MAX_UINT256 - (MAX_UINT256 % INITIAL_FRAGMENTS_SUPPLY);

    // REBASE SETTINGS
    uint256 private constant YEAR1_REBASE_RATE = 160309122470000; // 0.0160309122470000 %
    uint256 private constant YEAR2_REBASE_RATE = 144501813571063; // 0.0144501813571063 %
    uint256 private constant YEAR3_REBASE_RATE = 128715080592867; // 0.0128715080592867 %
    uint256 private constant YEAR4_REBASE_RATE = 112969085762193; // 0.0112969085762193 %
    uint256 private constant YEAR5_REBASE_RATE = 97303671485527;    // 0.0097303671485527 %
    uint256 private constant YEAR6_REBASE_RATE = 34322491203609;    // 0.0034322491203609 %
    uint8     private constant REBASE_RATE_DECIMALS = 18;
    uint256 private constant REBASE_FREQUENCY = 12 minutes;
    
    // REBASE VARIABLES
    uint256 public override maxRebaseBatchSize = 40; // 8 hours
    
    // ADDRESSES
    address internal _treasuryAddress = 0x46Af38553B5250f2560c3fc650bbAD0950c011c0; 
    address internal _burnAddress = DEAD;

    // OTHER CONTRACTS
    ISwapEngine public swapEngine;
    ILiquidityReliefFund public lrf;
    IAutoLiquidityEngine public autoLiquidityEngine;
    ISafeExitFund public safeExitFund;
    IPreSale public preSale;
    
    // DEX ROUTER ADDRESS
    // address private constant DEX_ROUTER_ADDRESS = 0x10ED43C718714eb63d5aA57B78B54704E256024E; // PancakeSwap BSC Mainnet
    // address private constant DEX_ROUTER_ADDRESS = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1; // PancakeSwap BSC Testnet
    // PancakeSwap BSC Testnet -> https://pancake.kiemtienonline360.com/
    address private constant DEX_ROUTER_ADDRESS = 0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3; 
    // address private constant DEX_ROUTER_ADDRESS = 0xc9C6f026E489e0A8895F67906ef1627f1E56860d; // AVAX Fuji OpenSwap router

    // FEES
    uint256 private constant MAX_BUY_FEES = 200; // 20%
    uint256 private constant MAX_SELL_FEES = 250; // 25%
    uint256 private constant FEE_DENOMINATOR = 1000;
    
    // BUY FEES | Treasury = 3% | LRF = 5% | Auto-Liquidity = 5% | SafeExit = 0 | Burn = 0
    Fee private _buyFees = Fee(30, 50, 50, 0, 0, 130);
    
    // SELL FEES | Treasury = 4% | LRF = 7% | Auto-Liquidity = 6% | SafeExit = 1% | Burn = 0
    Fee private _sellFees = Fee(40, 70, 60, 10, 0, 180);

    // SETTING FLAGS
    bool public override swapEnabled = true;
    bool public override autoRebaseEnabled = true;
    bool public override autoAddLiquidityEnabled = true;
    bool public override lrfEnabled = true;

    // FREQUENCIES
    uint256 public autoLiquidityFrequency = 2 days;
    uint256 public lrfFrequency = 2 days;
    uint256 public swapFrequency = 1 days;

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
    mapping(address => uint256) private _gonBalances;
    mapping(address => mapping(address => uint256)) private _allowedFragments;
    mapping(address => bool) public blacklist;

    // PRE-SALE FLAGS
    bool public override isPreSale = true;
    bool public override hasLaunched = false;
    mapping(address => bool) private _allowPreSaleTransfer;

    // MODIFIERS
    modifier checkAllowTransfer() {
        require(!isPreSale || msg.sender == owner() || _allowPreSaleTransfer[msg.sender], "Trading not open yet");
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

        // set up DEX _router/_pair
        _router = IDexRouter(DEX_ROUTER_ADDRESS); 
        address pairAddress = IDexFactory(_router.factory()).createPair(_router.WETH(), address(this));
        _pair = IDexPair(address(pairAddress));

        // set exchange _router allowance
        _allowedFragments[address(this)][address(_router)] = type(uint256).max;

        // initialise total supply
        _totalSupply = INITIAL_FRAGMENTS_SUPPLY;
        _gonsPerFragment = TOTAL_GONS.div(_totalSupply);
        
        // exempt fees from contract + treasury
        _isFeeExempt[_treasuryAddress] = true;
        _isFeeExempt[address(this)] = true;

        // init swap engine
        swapEngine = new SwapEngine();
        _allowedFragments[address(swapEngine)][address(_router)] = type(uint256).max;
        _isFeeExempt[address(swapEngine)] = true;

        // init LRF
        lrf = new LiquidityReliefFund();
        _allowedFragments[address(lrf)][address(_router)] = type(uint256).max;
        _isFeeExempt[address(lrf)] = true;

        // init auto liquidity engine
        autoLiquidityEngine = new AutoLiquidityEngine();
        _allowedFragments[address(autoLiquidityEngine)][address(_router)] = type(uint256).max;
        _isFeeExempt[address(autoLiquidityEngine)] = true;
        
        // init safe exit fund
        safeExitFund = new SafeExitFund();
        _allowedFragments[address(safeExitFund)][address(_router)] = type(uint256).max;
        _isFeeExempt[address(safeExitFund)] = true;
        
        // init presale
        preSale = new PreSale();
        _allowedFragments[address(preSale)][address(_router)] = type(uint256).max;
        _isFeeExempt[address(preSale)] = true;
        _allowPreSaleTransfer[address(preSale)] = true;

        // transfer ownership + total supply to treasury
        _gonBalances[_treasuryAddress] = TOTAL_GONS;
        _transferOwnership(_treasuryAddress);

        emit Transfer(address(0x0), _treasuryAddress, _totalSupply);
    }

    /*
     * REBASE FUNCTIONS
     */ 
    function rebase() public override {
        require(hasLaunched, "Token has not launched yet");

        if (_inSwap || !hasLaunched) {
            return;
        }
        
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
            _totalSupply = _totalSupply
                .mul((10**REBASE_RATE_DECIMALS).add(rebaseRate))
                .div(10**REBASE_RATE_DECIMALS);
        }

        _gonsPerFragment = TOTAL_GONS.div(_totalSupply);
        lastRebaseTime = lastRebaseTime.add(times.mul(REBASE_FREQUENCY));

        _pair.sync();

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

    function pendingRebases() public view override returns (uint256) {
        uint256 timeSinceLastRebase = block.timestamp - lastRebaseTime;
        return timeSinceLastRebase.div(REBASE_FREQUENCY);
    }

    function transfer(address to, uint256 value) external
        override(IGuilderFi, IERC20)
        validRecipient(to)
        returns (bool) {
        
        _transferFrom(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external
        override(IGuilderFi, IERC20)
        validRecipient(to)
        returns (bool) {

        if (blocked) {
            return true;
        }

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

    function _transferFrom(address sender, address recipient, uint256 amount) internal checkAllowTransfer returns (bool) {
    
        require(!blacklist[sender] && !blacklist[recipient], "Address blacklisted");

        if (_inSwap) {
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

        emit Transfer(
            sender,
            recipient,
            gonAmountReceived.div(_gonsPerFragment)
        );
        return true;
    }

    function preTransactionActions(address sender, address recipient, uint256 amount) internal swapping {

        if (shouldExecuteSafeExit()) {
            executeSafeExit(sender, recipient, amount);
        }

        if (shouldSwapBack()) {
            swapBack();
        }

        if (shouldRebase()) {
            rebase();
        }

        if (shouldAddLiquidity()) {
            executeAutoLiquidityEngine();
        }
   
        if (shouldExecuteLrf()) {
            executeLrf();
        }
    }

    function takeFee(address sender, address recipient, uint256 gonAmount) internal returns (uint256) {

        Fee storage fees = (recipient == address(_pair)) ? _sellFees : _buyFees;

        uint256 burnAmount      = fees.burnFee.mul(gonAmount).div(FEE_DENOMINATOR);
        uint256 lrfAmount       = fees.lrfFee.mul(gonAmount).div(FEE_DENOMINATOR);
        uint256 safeExitAmount  = fees.safeExitFee.mul(gonAmount).div(FEE_DENOMINATOR);
        uint256 liquidityAmount = fees.liquidityFee.mul(gonAmount).div(FEE_DENOMINATOR);
        uint256 treasuryAmount  = fees.treasuryFee.mul(gonAmount).div(FEE_DENOMINATOR);     

        uint256 totalToSwap = lrfAmount
            .add(safeExitAmount)
            .add(treasuryAmount);
        
        uint256 total = totalToSwap
            .add(burnAmount)
            .add(liquidityAmount);

        // burn
        if (burnAmount > 0) {
            _gonBalances[_burnAddress] = _gonBalances[_burnAddress].add(burnAmount);
            emit Transfer(sender, _burnAddress, burnAmount.div(_gonsPerFragment));
        }

        // add liquidity fees to auto liquidity engine
        _gonBalances[address(autoLiquidityEngine)] = _gonBalances[address(autoLiquidityEngine)].add(liquidityAmount);
        emit Transfer(sender, address(autoLiquidityEngine), liquidityAmount.div(_gonsPerFragment));

        // move the rest to swap engine
        _gonBalances[address(swapEngine)] = _gonBalances[address(swapEngine)].add(totalToSwap);
        emit Transfer(sender, address(swapEngine), totalToSwap.div(_gonsPerFragment));
        
        // record fees in swap engine
        swapEngine.recordFees(
            lrfAmount.div(_gonsPerFragment),
            safeExitAmount.div(_gonsPerFragment),
            treasuryAmount.div(_gonsPerFragment)
        );

        return gonAmount.sub(total);
    }
    
    function executeLrf() internal {
        lrf.execute();
        lastLrfExecutionTime = block.timestamp;
    }

    function executeAutoLiquidityEngine() internal {
        autoLiquidityEngine.execute();
        lastAddLiquidityTime = block.timestamp;
    }

    function executeSafeExit(address sender, address recipient, uint256 amount) internal {
        safeExitFund.execute(sender, recipient, amount);
    }

    function swapBack() internal {
        swapEngine.execute();
        lastSwapTime = block.timestamp;
    }

    /*
     * INTERNAL CHECKER FUNCTIONS
     */ 
    function shouldTakeFee(address from, address to) internal view returns (bool) {
        return 
            (address(_pair) == from || address(_pair) == to) &&
            to != address(lrf) &&
            to != address(autoLiquidityEngine) &&
            !_isFeeExempt[from];
    }

    function shouldRebase() internal view returns (bool) {
        return
            autoRebaseEnabled &&
            hasLaunched &&
            (_totalSupply < MAX_SUPPLY) &&
            msg.sender != address(_pair)    &&
            // !_inSwap &&
            block.timestamp >= (lastRebaseTime + REBASE_FREQUENCY);
    }

    function shouldAddLiquidity() internal view returns (bool) {
        return
            hasLaunched &&
            autoAddLiquidityEnabled && 
            // !_inSwap && 
            msg.sender != address(_pair) &&
            (autoLiquidityFrequency == 0 || (block.timestamp >= (lastAddLiquidityTime + autoLiquidityFrequency))); 
    }

    function shouldSwapBack() internal view returns (bool) {
        return 
            // !_inSwap &&
            swapEnabled &&
            msg.sender != address(_pair) &&
            (swapFrequency == 0 || (block.timestamp >= (lastSwapTime + swapFrequency)));
    }

    function shouldExecuteLrf() internal view returns (bool) {
        return
            lrfEnabled &&
            hasLaunched &&
            (lrfFrequency == 0 || (block.timestamp >= (lastLrfExecutionTime + lrfFrequency))); 
    }

    function shouldExecuteSafeExit() internal pure returns (bool) {
        return true;
            // safeExitFund.balanceOf(msg.sender) > 0;
    }

    /*
     * TOKEN ALLOWANCE/APPROVALS
     */ 
    function allowance(address owner_, address spender) public view override(IGuilderFi, IERC20) returns (uint256) {
        return _allowedFragments[owner_][spender];
    }

    function decreaseAllowance(address spender, uint256 subtractedValue) external override returns (bool) {
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

    function increaseAllowance(address spender, uint256 addedValue) external override returns (bool) {
        _allowedFragments[msg.sender][spender] = _allowedFragments[msg.sender][spender].add(addedValue);
        
        emit Approval(
            msg.sender,
            spender,
            _allowedFragments[msg.sender][spender]
        );

        return true;
    }

    function approve(address spender, uint256 value) external override(IGuilderFi, IERC20) returns (bool) {
        _allowedFragments[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function manualSync() override external {
        IDexPair(address(_pair)).sync();
    }

    /*
     * PUBLIC SETTER FUNCTIONS
     */ 
    function setAutoSwap(bool _flag) external override onlyOwner {
        swapEnabled = _flag;
    }

    function setAutoAddLiquidity(bool _flag) external override onlyOwner {
        autoAddLiquidityEnabled = _flag;
        if(_flag) {
            lastAddLiquidityTime = block.timestamp;
        }
    }

    function setAutoRebase(bool _flag) override external onlyOwner {
        autoRebaseEnabled = _flag;
        if (_flag) {
            lastRebaseTime = block.timestamp;
        }
    }

    function setFeeExempt(address _address, bool _flag) external override onlyOwner {
        _isFeeExempt[_address] = _flag;
    }

    function setBlacklist(address _address, bool _flag) external override onlyOwner {
        blacklist[_address] = _flag;    
    }

    function allowPreSaleTransfer(address _addr, bool _flag) external override onlyOwner {
        _allowPreSaleTransfer[_addr] = _flag;
    }

    function setMaxRebaseBatchSize(uint256 _maxRebaseBatchSize) external override onlyOwner {
        maxRebaseBatchSize = _maxRebaseBatchSize;
    }

    function setDex(address _routerAddress) external override onlyOwner {
        _router = IDexRouter(_routerAddress);

        IDexFactory factory = IDexFactory(_router.factory());
        address pairAddress = factory.getPair(_router.WETH(), address(this));
        
        if (pairAddress == address(0)) {
            pairAddress = IDexFactory(_router.factory()).createPair(_router.WETH(), address(this));
        }
        _pair = IDexPair(address(pairAddress));
        _allowedFragments[address(this)][address(_router)] = type(uint256).max;        
    }

    function setAutoLiquidityFrequency(uint256 _frequency) external override onlyOwner {
        autoLiquidityFrequency = _frequency;
    }
    
    function setLrfFrequency(uint256 _frequency) external override onlyOwner {
        lrfFrequency = _frequency;
    }
    
    function setSwapFrequency(uint256 _frequency) external override onlyOwner {
        swapFrequency = _frequency;
    }

    function setAddresses(
        address treasuryAddress,
        address lrfAddress,
        address autoLiquidityAddress,
        address safeExitFundAddress,
        address burnAddress
    ) external override onlyOwner {
        _treasuryAddress = treasuryAddress;
        lrf = ILiquidityReliefFund(lrfAddress);
        autoLiquidityEngine = IAutoLiquidityEngine(autoLiquidityAddress);
        safeExitFund = ISafeExitFund(safeExitFundAddress);
        _burnAddress = burnAddress;
    }

    function setFees(
        bool _isSellFee,
        uint256 _treasuryFee,
        uint256 _lrfFee,
        uint256 _liquidityFee,
        uint256 _safeExitFee,
        uint256 _burnFee
    ) external override onlyOwner {

        uint256 feeTotal = _treasuryFee
            .add(_lrfFee)
            .add(_liquidityFee)
            .add(_safeExitFee)
            .add(_burnFee);

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

    function openTrade() external override onlyOwner {
        isPreSale = false;
    }

    function launchToken() external override onlyOwner {
        require(!hasLaunched, "Token has already launched");

        isPreSale = false;
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
    function getCirculatingSupply() public view override returns (uint256) {
        return (TOTAL_GONS.sub(_gonBalances[DEAD]).sub(_gonBalances[ZERO])).div(_gonsPerFragment);
    }
    function checkFeeExempt(address _addr) public view override returns (bool) {
        return _isFeeExempt[_addr];
    }
    function isNotInSwap() public view override returns (bool) {
        return !_inSwap;
    }
    function getOwner() public view override returns (address) {
        return owner();
    }
    function getTreasuryAddress() public view override returns (address) {
        return _treasuryAddress;
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
    function getBurnAddress() public view override returns (address) {
        return _burnAddress;
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
     
    function balanceOf(address who) external view override(IGuilderFi, IERC20) returns (uint256) {
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