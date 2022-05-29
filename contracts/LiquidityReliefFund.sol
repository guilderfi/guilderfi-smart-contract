// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/IGuilderFi.sol";
import "./interfaces/ILiquidityReliefFund.sol";
import "./interfaces/IDexPair.sol";
import "./interfaces/IDexRouter.sol";

contract LiquidityReliefFund is ILiquidityReliefFund {

    using SafeMath for uint256;

    // GuilderFi token contract address
    IGuilderFi internal _token;

    uint256 public constant ACCURACY_FACTOR = 10 ** 18;
    uint256 public constant PERCENTAGE_ACCURACY_FACTOR = 10 ** 4;

    uint256 public constant ACTIVATION_TARGET = 10000; // 100.00%
    uint256 public constant LOW_CAP = 8500; // 85.00%
    uint256 public constant HIGH_CAP = 11500; // 115.00%

    address public pairAddress;
    bool internal _hasReachedActivationTarget = false; 
    bool internal _enabled = true;

    // PRIVATE FLAGS
    bool private _isRunning = false;
    modifier running() {
        _isRunning = true;
        _;
        _isRunning = false;
    }

    modifier onlyToken() {
        require(msg.sender == address(_token), "Sender is not token contract"); _;
    }

    modifier onlyTokenOwner() {
        require(msg.sender == address(_token.getOwner()), "Sender is not token owner"); _;
    }

    modifier onlyTokenOrTokenOwner() {
        require(msg.sender == address(_token.getOwner()) || msg.sender == address(_token), "Sender is not contract or owner"); _;
    }

    constructor (address tokenAddress) {
        _token = IGuilderFi(tokenAddress);
    }

    // External execute function
    function execute() override external onlyTokenOrTokenOwner {
        
        // TODO: refactor so backed liquidity ratio is not calculated over and over
        if (!_hasReachedActivationTarget) {
            uint256 backedLiquidityRatio = getBackedLiquidityRatio();

            if (backedLiquidityRatio >= ACTIVATION_TARGET) {
                _hasReachedActivationTarget = true;
            }
        }

        if (shouldExecute()) {
            _execute();
        }
    }

    function shouldExecute() internal view returns (bool) {
        uint256 backedLiquidityRatio = getBackedLiquidityRatio();

        return
            _hasReachedActivationTarget &&
            !_isRunning &&
            _enabled &&
            backedLiquidityRatio <= HIGH_CAP &&
            backedLiquidityRatio >= LOW_CAP;
    }

    function _execute() internal running {
        uint256 backedLiquidityRatio = getBackedLiquidityRatio();

        // TODO check if LOW cap has been hit before running
        // TODO add code to check if should run (e.g. 2 day window)
        if (backedLiquidityRatio == 0) {
            return;
        }

        if (backedLiquidityRatio > HIGH_CAP) {
            buyTokens();
        }
        else if (backedLiquidityRatio < LOW_CAP) {
            sellTokens();
        }
    }

    function buyTokens() internal {
        if (address(this).balance == 0) {
            return;
        }

        IDexRouter router = getRouter();
        uint256 totalTreasuryAssetValue = getTotalTreasuryAssetValue();
        (uint256 liquidityPoolEth, ) = getLiquidityPoolReserves();
        uint256 ethToBuy = (totalTreasuryAssetValue.sub(liquidityPoolEth)).div(2);

        if (ethToBuy > address(this).balance) {
            ethToBuy = address(this).balance;
        }


        address[] memory path = new address[](2);
        path[0] = router.WETH();
        path[1] = address(_token);

        router.swapExactETHForTokensSupportingFeeOnTransferTokens{ value: ethToBuy }(
            0,
            path,
            address(this),
            block.timestamp
        );
    }


    function sellTokens() internal {
        uint256 tokenBalance = _token.balanceOf(address(this)); 
        if (tokenBalance == 0) {
            return;
        }

        IDexRouter router = getRouter();
        uint256 totalTreasuryAssetValue = getTotalTreasuryAssetValue();
        (uint256 liquidityPoolEth, uint256 liquidityPoolTokens) = getLiquidityPoolReserves();
        
        uint256 valueDiff = ACCURACY_FACTOR.mul(liquidityPoolEth.sub(totalTreasuryAssetValue));
        uint256 tokenPrice = ACCURACY_FACTOR.mul(liquidityPoolEth).div(liquidityPoolTokens);
        uint256 tokensToSell = valueDiff.div(tokenPrice.mul(2));

        if (tokensToSell > tokenBalance) {
            tokensToSell = tokenBalance;
        }

        address[] memory path = new address[](2);
        path[0] = address(_token);
        path[1] = router.WETH();

        router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            tokensToSell,
            0,
            path,
            address(this),
            block.timestamp
        );
    }

    function getBackedLiquidityRatio() public view returns (uint256) {
        (uint256 liquidityPoolEth, ) = getLiquidityPoolReserves();
        if (liquidityPoolEth == 0) {
            return 0;
        }

        uint256 totalTreasuryAssetValue = getTotalTreasuryAssetValue();
        uint256 ratio = PERCENTAGE_ACCURACY_FACTOR.mul(totalTreasuryAssetValue).div(liquidityPoolEth);
        return ratio;
    }

    function getTotalTreasuryAssetValue() internal view returns (uint256) {
        uint256 treasuryEthBalance = address(_token.getTreasuryAddress()).balance;
        return treasuryEthBalance.add(address(this).balance);
    }

    function getLiquidityPoolReserves() internal view returns (uint256, uint256) {
        IDexPair pair = getPair();
        address token0Address = pair.token0();
        (uint256 token0Reserves, uint256 token1Reserves, ) = pair.getReserves();
        
        // returns eth reserves, token reserves
        return token0Address == address(_token) ?
            (token1Reserves, token0Reserves) :
            (token0Reserves, token1Reserves);
    }

    function getRouter() internal view returns (IDexRouter) {
        return IDexRouter(_token.getRouter());
    }

    function getPair() internal view returns (IDexPair) {
        return IDexPair(_token.getPair());
    }

    function withdraw(uint256 amount) external override onlyTokenOwner{
        payable(msg.sender).transfer(amount);
    }
    
    function withdrawTokens(address token, uint256 amount) external override onlyTokenOwner {
        IERC20(token).transfer(msg.sender, amount);
    }

    receive() external payable {}
}