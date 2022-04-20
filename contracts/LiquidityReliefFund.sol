// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

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
    uint256 public constant HIGH_CAP = 10000; // 100.00%
    uint256 public constant LOW_CAP = 10000; // 100.00%

    address public pairAddress;
    bool internal _isLrfActivated = false; 
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

    constructor () {
        _token = IGuilderFi(msg.sender);
    }

    // External execute function
    function execute() override external onlyToken {
        if (shouldExecute()) {
            _execute();
        }
    }

    function shouldExecute() internal view returns (bool) {
        return
            !_isRunning &&
            _enabled;
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

    receive() external payable {}
}