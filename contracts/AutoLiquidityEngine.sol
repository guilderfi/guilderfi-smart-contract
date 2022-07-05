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

  bool private _inSwap = false;

  address private constant DEAD = 0x000000000000000000000000000000000000dEaD;

  modifier onlyToken() {
    require(msg.sender == address(_token), "Sender is not token contract");
    _;
  }

  modifier onlyTokenOwner() {
    require(msg.sender == address(_token.getOwner()), "Sender is not token owner");
    _;
  }

  modifier onlyTokenOrTokenOwner() {
    require(msg.sender == address(_token.getOwner()) || msg.sender == address(_token), "Sender is not contract or owner");
    _;
  }

  constructor(address tokenAddress) {
    _token = IGuilderFi(tokenAddress);
  }

  // External execute function
  function executeLiquidityEngine() external override onlyTokenOrTokenOwner {
    if (shouldExecute()) {
      _execute();
    }
  }

  function shouldExecute() internal view returns (bool) {
    return _token.balanceOf(address(this)) > 0;
  }

  function _execute() internal {
    // transfer all tokens from liquidity account to contract
    uint256 autoLiquidityAmount = _token.balanceOf(address(this));

    // calculate 50/50 split
    uint256 amountToLiquify = autoLiquidityAmount.div(2);
    uint256 amountToSwap = autoLiquidityAmount.sub(amountToLiquify);

    if (amountToSwap == 0) {
      return;
    }

    IDexRouter router = getRouter();

    address[] memory path = new address[](2);
    path[0] = address(_token);
    path[1] = router.WETH();

    uint256 balanceBefore = address(this).balance;

    // swap tokens for ETH
    _inSwap = true;
    router.swapExactTokensForETHSupportingFeeOnTransferTokens(amountToSwap, 0, path, address(this), block.timestamp);
    _inSwap = false;

    uint256 amountETHLiquidity = address(this).balance.sub(balanceBefore);

    // add tokens + ETH to liquidity pool
    if (amountToLiquify > 0 && amountETHLiquidity > 0) {
      _inSwap = true;
      router.addLiquidityETH{value: amountETHLiquidity}(address(_token), amountToLiquify, 0, 0, _token.getTreasuryAddress(), block.timestamp);
      _inSwap = false;
    }
  }

  function inSwap() public view override returns (bool) {
    return _inSwap;
  }

  function getRouter() internal view returns (IDexRouter) {
    return IDexRouter(_token.getRouter());
  }

  function withdraw(uint256 amount) external override onlyTokenOwner {
    payable(msg.sender).transfer(amount);
  }

  function withdrawTokens(address token, uint256 amount) external override onlyTokenOwner {
    IERC20(token).transfer(msg.sender, amount);
  }

  function burn(uint256 amount) external override onlyTokenOwner {
    _token.transfer(DEAD, amount);
  }

  receive() external payable {}
}
