// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/IGuilderFi.sol";
import "./interfaces/IAutoLiquidityEngine.sol";
import "./interfaces/IDexPair.sol";
import "./interfaces/IDexRouter.sol";

contract AutoLiquidityEngine is IAutoLiquidityEngine {

    using SafeMath for uint256;

    // GuilderFi token contract address
    IGuilderFi internal _token;
 
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

    constructor (address tokenAddress) {
        _token = IGuilderFi(tokenAddress);
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

    function test() external view returns (uint256) {
        uint256 autoLiquidityAmount = _token.balanceOf(address(this));

        // calculate 50/50 split
        uint256 amountToLiquify = autoLiquidityAmount.div(2);
        uint256 amountToSwap = autoLiquidityAmount.sub(amountToLiquify);

        return amountToSwap;
    }

    function _execute() internal running {        
        // transfer all tokens from liquidity account to contract
        uint256 autoLiquidityAmount = _token.balanceOf(address(this));

        // calculate 50/50 split
        uint256 amountToLiquify = autoLiquidityAmount.div(2);
        uint256 amountToSwap = autoLiquidityAmount.sub(amountToLiquify);

        if( amountToSwap == 0 ) {
            return;
        }
        
        IDexRouter router = getRouter();

        address[] memory path = new address[](2);
        path[0] = address(_token);
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
        if (amountToLiquify > 0 && amountETHLiquidity > 0) {
            router.addLiquidityETH{value: amountETHLiquidity}(
                address(_token),
                amountToLiquify,
                0,
                0,
                _token.getTreasuryAddress(),
                block.timestamp
            );
        }
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