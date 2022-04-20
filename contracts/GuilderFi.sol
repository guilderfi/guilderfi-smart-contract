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
import "./LiquidityReliefFund.sol";

contract GuilderFi is IGuilderFi, IERC20, Ownable {

    using SafeMath for uint256;
    uint256 internal counter = 0;

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
    address public _treasuryAddress = 0x46Af38553B5250f2560c3fc650bbAD0950c011c0; 
    address public _lrfAddress = 0xea7231dC1ed7778D5601B1F4dDe1120E8eE38F66;
    address public _autoLiquidityAddress = 0x0874813dEF7e61A003A6d3b114c4474001eD6F0A;
    address public _safeExitFundAddress = 0x67Efb7f2Dd5F6dD55c38C55de898d9f7EE111880;
    address public _burnAddress = DEAD;

    // OTHER CONTRACTS
    ILiquidityReliefFund public lrf;
    
    // DEX ADDRESSES
    // address private constant DEX_ROUTER_ADDRESS = 0x10ED43C718714eb63d5aA57B78B54704E256024E; // PancakeSwap BSC Mainnet
    address private constant DEX_ROUTER_ADDRESS = 0xD99D1c33F9fC3444f8101754aBC46c52416550D1; // PancakeSwap BSC Testnet

    // FEES
    uint256 private constant MAX_BUY_FEES = 200; // 20%
    uint256 private constant MAX_SELL_FEES = 240; // 24%
    uint256 private constant FEE_DENOMINATOR = 1000;
    
    // Buy fees = 3% treasury, 5% LRF, 5% auto liquidity, 0% burn
    Fee private _buyFees = Fee(30, 50, 50, 0, 130);
    
    // Sell fees = 7% treasury, 5% LRF, 5% auto liquidity, 0% burn
    Fee private _sellFees = Fee(70, 50, 50, 0, 170);

    // FEES COLLECTED
    uint256 internal _treasuryFeesCollected;
    uint256 internal _lrfFeesCollected;

    // SETTING FLAGS
    bool public override swapEnabled = true;
    bool public override autoRebaseEnabled = true;
    bool public override autoAddLiquidityEnabled = true;

    // PRIVATE FLAGS
    bool private _inSwap = false;

    // EXCHANGE VARIABLES
    IDexRouter private _router;
    IDexPair private _pair;
    
    // DATE/TIME STAMPS
    uint256 public override initRebaseStartTime;
    uint256 public override lastRebaseTime;
    uint256 public override lastAddLiquidityTime;
    uint256 public override lastEpoch;

    // TOKEN SUPPLY VARIABLES
    uint256 private _totalSupply;
    uint256 private _gonsPerFragment;

    // DATA
    mapping(address => bool) private _isFeeExempt;
    mapping(address => uint256) private _gonBalances;
    mapping(address => mapping(address => uint256)) private _allowedFragments;
    mapping(address => bool) public blacklist;

    // PRE-SALE FLAG
    bool public override isOpen = false;
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

        // init other contracts
        lrf = new LiquidityReliefFund();
        _allowedFragments[address(lrf)][address(_router)] = type(uint256).max;
        _isFeeExempt[address(lrf)] = true;
        
        // transfer ownership + total supply to treasury
        _gonBalances[_treasuryAddress] = TOTAL_GONS;
        _transferOwnership(_treasuryAddress);

        emit Transfer(address(0x0), _treasuryAddress, _totalSupply);
    }

    /*
     * REBASE FUNCTIONS
     */ 
    function rebase() public override {
        require(isOpen, "Trading is not open yet");

        if (_inSwap || !isOpen) {
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

function toAsciiString(address x) internal pure returns (string memory) {
    bytes memory s = new bytes(40);
    for (uint i = 0; i < 20; i++) {
        bytes1 b = bytes1(uint8(uint(uint160(x)) / (2**(8*(19 - i)))));
        bytes1 hi = bytes1(uint8(b) / 16);
        bytes1 lo = bytes1(uint8(b) - 16 * uint8(hi));
        s[2*i] = char(hi);
        s[2*i+1] = char(lo);            
    }
    return string(s);
}

function char(bytes1 b) internal pure returns (bytes1 c) {
    if (uint8(b) < 10) return bytes1(uint8(b) + 0x30);
    else return bytes1(uint8(b) + 0x57);
}

    function _transferFrom(address sender, address recipient, uint256 amount) internal isOpenForTrade returns (bool) {
        counter = counter + 1;
        require(!blacklist[sender] && !blacklist[recipient], "Address blacklisted");

        if (_inSwap) {
            return _basicTransfer(sender, recipient, amount);
        }

        preTransactionActions();

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

    function preTransactionActions() internal {
        if (shouldSwapBack()) {
            swapBack();
        }

        if (shouldRebase()) {
            // rebase();
        }

        if (shouldAddLiquidity()) {
            // addLiquidity();
        }
   
        if (isOpen) {
            lrf.execute();
        }
    }

    function takeFee(address sender, address recipient, uint256 gonAmount) internal returns (uint256) {

        Fee storage fees = (recipient == address(_pair)) ? _sellFees : _buyFees;

        uint256 burnAmount = gonAmount.div(FEE_DENOMINATOR).mul(fees.burnFee);
        uint256 treasuryAmount = gonAmount.div(FEE_DENOMINATOR).mul(fees.treasuryFee);
        uint256 lrfAmount = gonAmount.div(FEE_DENOMINATOR).mul(fees.lrfFee);
        uint256 liquidityAmount = gonAmount.div(FEE_DENOMINATOR).mul(fees.liquidityFee);
        uint256 totalFeeAmount = burnAmount + treasuryAmount + lrfAmount + liquidityAmount;
         
        // burn 
        _gonBalances[_burnAddress] = _gonBalances[_burnAddress].add(burnAmount);

        // add treasury fees to smart contract
        _gonBalances[address(this)] = _gonBalances[address(this)].add(treasuryAmount);
        _treasuryFeesCollected = _treasuryFeesCollected.add(treasuryAmount.div(_gonsPerFragment));
        
        // add lrf fees to smart contract
        _gonBalances[address(this)] = _gonBalances[address(this)].add(lrfAmount);
        _lrfFeesCollected = _lrfFeesCollected.add(lrfAmount.div(_gonsPerFragment));

        // add liquidity fees to liquidity address
        _gonBalances[_autoLiquidityAddress] = _gonBalances[_autoLiquidityAddress].add(liquidityAmount);
        
        emit Transfer(sender, address(this), totalFeeAmount.div(_gonsPerFragment));
        return gonAmount.sub(totalFeeAmount);
    }

    function addLiquidity() internal swapping {
        // transfer all tokens from liquidity account to contract
        uint256 autoLiquidityAmount = _gonBalances[_autoLiquidityAddress].div(_gonsPerFragment);
        _gonBalances[address(this)] = _gonBalances[address(this)].add(_gonBalances[_autoLiquidityAddress]);
        _gonBalances[_autoLiquidityAddress] = 0;

        // calculate 50/50 split
        uint256 amountToLiquify = autoLiquidityAmount.div(2);
        uint256 amountToSwap = autoLiquidityAmount.sub(amountToLiquify);

        if( amountToSwap == 0 ) {
            return;
        }

        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = _router.WETH();

        uint256 balanceBefore = address(this).balance;

        // swap tokens for ETH
        _router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            amountToSwap,
            0,
            path,
            address(this),
            block.timestamp
        );

        uint256 amountETHLiquidity = address(this).balance.sub(balanceBefore);

        // add tokens + ETH to liquidity pool
        if (amountToLiquify > 0 && amountETHLiquidity > 0) {
            _router.addLiquidityETH{value: amountETHLiquidity}(
                address(this),
                amountToLiquify,
                0,
                0,
                _autoLiquidityAddress,
                block.timestamp
            );
        }

        lastAddLiquidityTime = block.timestamp;
    }

    function swapBack() internal swapping {

        uint256 totalGonFeesCollected = _treasuryFeesCollected.add(_lrfFeesCollected);
        uint256 amountToSwap = _gonBalances[address(this)].div(_gonsPerFragment);

        if (amountToSwap == 0) {
            return;
        }

        uint256 balanceBefore = address(this).balance;

        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = _router.WETH();

        // swap all tokens in contract for ETH
        _router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            amountToSwap,
            0,
            path,
            address(this),
            block.timestamp
        );

        uint256 amountETH = address(this).balance.sub(balanceBefore);
        uint256 treasuryETH = amountETH.mul(_treasuryFeesCollected).div(totalGonFeesCollected);
        uint256 lrfETH = amountETH.sub(treasuryETH);

        _treasuryFeesCollected = 0;
        _lrfFeesCollected = 0;
        
        // send eth to treasury
        (bool success, ) = payable(_treasuryAddress).call{ value: treasuryETH }("");

        // send eth to lrf
        (success, ) = payable(_lrfAddress).call{ value: lrfETH }("");
    }

    function test() public {
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = _router.WETH();

        // swap all tokens in contract for ETH
        _router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            80000000000000000000,
            0,
            path,
            address(this),
            block.timestamp
        );        
    }

    /*
     * INTERNAL CHECKER FUNCTIONS
     */ 
    function shouldTakeFee(address from, address to) internal view returns (bool) {
        return 
            (address(_pair) == from || address(_pair) == to) &&
            to != address(lrf) &&
            !_isFeeExempt[from];
    }

    function shouldRebase() internal view returns (bool) {
        return
            autoRebaseEnabled &&
            isOpen &&
            (_totalSupply < MAX_SUPPLY) &&
            msg.sender != address(_pair)    &&
            !_inSwap &&
            block.timestamp >= (lastRebaseTime + REBASE_FREQUENCY);
    }

    function shouldAddLiquidity() internal view returns (bool) {
        return
            autoAddLiquidityEnabled && 
            !_inSwap && 
            msg.sender != address(_pair) &&
            block.timestamp >= (lastAddLiquidityTime + 2 days); // TODO: make 
    }

    function shouldSwapBack() internal view returns (bool) {
        return 
            !_inSwap &&
            swapEnabled &&
            msg.sender != address(_pair);
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

    function setDex(address routerAddress) external override onlyOwner {
        _router = IDexRouter(routerAddress); 
        address pairAddress = IDexFactory(_router.factory()).createPair(_router.WETH(), address(this));
        _pair = IDexPair(address(pairAddress));
    }

    function setAddresses(
        address treasuryAddress,
        address lrfAddress,
        address autoLiquidityAddress,
        address burnAddress
    ) external override onlyOwner {
        _treasuryAddress = treasuryAddress;
        _lrfAddress = lrfAddress;
        _autoLiquidityAddress = autoLiquidityAddress;
        _burnAddress = burnAddress;
    }

    function setFees(
        bool _isSellFee,
        uint256 _treasuryFee,
        uint256 _lrfFee,
        uint256 _liquidityFee,
        uint256 _burnFee
    ) external override onlyOwner {

        uint256 feeTotal = _treasuryFee
            .add(_lrfFee)
            .add(_liquidityFee)
            .add(_burnFee);

        Fee memory fee = Fee(_treasuryFee, _lrfFee, _liquidityFee, _burnFee, feeTotal);
        
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
        isOpen = true;
        
        // record rebase timestamps
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
    function getTreasuryAddress() public view override returns (address) {
        return _treasuryAddress;
    }
    function getLrfAddress() public view override returns (address) {
        return _lrfAddress;
    }
    function getAutoLiquidityAddress() public view override returns (address) {
        return _autoLiquidityAddress;
    }
    function getBurnAddress() public view override returns (address) {
        return _burnAddress;
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