// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./interfaces/IGuilderFi.sol";
import "./interfaces/ISwapEngine.sol";
import "./interfaces/IDexPair.sol";
import "./interfaces/IDexRouter.sol";

contract SwapEngine is ISwapEngine {

    using SafeMath for uint256;

    // GuilderFi token contract address
    address internal _token;
 
    // enabled flag
    bool internal _isEnabled = true;

    // FEES COLLECTED
    uint256 internal _treasuryFeesCollected;
    uint256 internal _lrfFeesCollected;
    uint256 internal _safeExitFeesCollected;

    bool private _inSwap = false;

    // PRIVATE FLAGS
    bool private _isRunning = false;
    modifier running() {
        _isRunning = true;
        _;
        _isRunning = false;
    }

    modifier onlyToken() {
        require(msg.sender == _token, "Sender is not token contract"); _;
    }

    modifier onlyTokenOwner() {
        require(msg.sender == IGuilderFi(_token).getOwner(), "Sender is not token owner"); _;
    }

    modifier onlyTokenOrTokenOwner() {
        require(msg.sender == IGuilderFi(_token).getOwner() || msg.sender == _token, "Sender is not contract or owner"); _;
    }

    constructor (address tokenAddress) {
        _token = tokenAddress;
    }

    // External execute function
    function execute() override external onlyTokenOrTokenOwner {
        if (shouldExecute()) {
            _execute();
        }
    }

    // External execute function
    function recordFees(uint256 lrfAmount, uint256 safeExitAmount, uint256 treasuryAmount) override external onlyToken {
        _lrfFeesCollected = _lrfFeesCollected.add(lrfAmount);
        _safeExitFeesCollected = _safeExitFeesCollected.add(safeExitAmount);
        _treasuryFeesCollected = _treasuryFeesCollected.add(treasuryAmount);
    }

    function shouldExecute() internal view returns (bool) {
        return !_isRunning && _isEnabled;
    }

    function _execute() internal running {

        IDexRouter _router = getRouter();
        uint256 totalGonFeesCollected = _treasuryFeesCollected.add(_lrfFeesCollected).add(_safeExitFeesCollected);
        uint256 amountToSwap = IGuilderFi(_token).balanceOf(address(this));

        if (amountToSwap == 0) {
            return;
        }

        uint256 balanceBefore = address(this).balance;

        address[] memory path = new address[](2);
        path[0] = _token;
        path[1] = _router.WETH();

        // swap all tokens in contract for ETH
        _inSwap = true;
        _router.swapExactTokensForETHSupportingFeeOnTransferTokens(
            amountToSwap,
            0,
            path,
            address(this),
            block.timestamp
        );
        _inSwap = false;
        
        uint256 amountETH = address(this).balance.sub(balanceBefore);
        uint256 treasuryETH = amountETH.mul(_treasuryFeesCollected).div(totalGonFeesCollected);
        uint256 safeExitETH = amountETH.mul(_safeExitFeesCollected).div(totalGonFeesCollected);
        uint256 lrfETH = amountETH.sub(treasuryETH).sub(safeExitETH);

        _treasuryFeesCollected = 0;
        _lrfFeesCollected = 0;
        _safeExitFeesCollected = 0;
        
        // send eth to treasury
        (bool success, ) = payable(IGuilderFi(_token).getTreasuryAddress()).call{ value: treasuryETH }("");

        // send eth to lrf
        (success, ) = payable(IGuilderFi(_token).getLrfAddress()).call{ value: lrfETH }("");

        // send eth to safe exit fund
        (success, ) = payable(IGuilderFi(_token).getSafeExitFundAddress()).call{ value: safeExitETH }("");
    }

    function getRouter() internal view returns (IDexRouter) {
        return IDexRouter(IGuilderFi(_token).getRouter());
    }

    function getPair() internal view returns (IDexPair) {
        return IDexPair(IGuilderFi(_token).getPair());
    }

    function isEnabled() public view override returns (bool) {
        return _isEnabled;
    }

    function inSwap() public view override returns (bool) {
        return _inSwap;
    }

    function setEnabled(bool _enable) external override onlyTokenOwner {
        _isEnabled = _enable;
    }

    function withdraw(uint256 amount) external override onlyTokenOwner {
        payable(msg.sender).transfer(amount);
    }
    
    function withdrawTokens(address token, uint256 amount) external override onlyTokenOwner {
        IERC20(token).transfer(msg.sender, amount);
    }

    receive() external payable {}
}