// SPDX-License-Identifier: MIT

pragma solidity 0.8.10;

import "@openzeppelin/contracts/utils/math/SafeMath.sol";

import "./interfaces/IGuilderFi.sol";
import "./interfaces/ISafeExitFund.sol";

contract SafeExitFund is ISafeExitFund {

    using SafeMath for uint256;

    // GuilderFi token contract address
    IGuilderFi internal _token;

    modifier onlyToken() {
        require(msg.sender == address(_token), "Sender is not token contract"); _;
    }

    constructor () {
        _token = IGuilderFi(msg.sender);
    }

    // External execute function
    function execute() override external onlyToken {
        // TODO
    }

    receive() external payable {}
}