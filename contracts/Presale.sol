// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "./interfaces/ISafeExitFund.sol";

contract Presale {
    constructor() {}

    function buyTokens(address _tokenAddress, address wallet) public {
        ISafeExitFund(_tokenAddress).mint(wallet);
    }
}