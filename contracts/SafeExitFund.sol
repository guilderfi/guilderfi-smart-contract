// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/counters.sol";


import "./interfaces/IGuilderFi.sol";
import "./interfaces/ISafeExitFund.sol";

contract SafeExitFund is ISafeExitFund, ERC721Enumerable {

    using Counters for Counters.Counter;
    Counters.Counter private _tokenId;

    struct Package {
        uint256 insuranceAmount;
        uint256 randomRangeFrom;
        uint256 randomRangeTo;
        string metadataUri;
    }

    Package[] private packages;

    struct NftData {
        uint256 insuredAmount;
        bool used; // one time use
    }

    mapping(uint256 => NftData) private nftData;

    uint256 public maxSupply = 5000;

    string unrevealedUri = "";
    string usedUri = "";

    uint256 private randomSeed = 123456789;
    uint256 private timestampSalt = 123456789;
    bool private randomSeedHasBeenSet = false;

    // GuilderFi token contract address
    IGuilderFi internal _token;

    modifier onlyToken() {
        require(msg.sender == address(_token), "Sender is not token contract"); _;
    }

    modifier onlyTokenOwner() {
        require(msg.sender == address(_token.getOwner()), "Sender is not token owner"); _;
    }

    modifier onlyPresale() {
        // require(msg.sender == address(_presale), "Sender is not token owner"); // TODO
         _;
    }

    modifier nftsRevealed() {
        require(randomSeedHasBeenSet == true, "NFTs are not revealed yet"); 
         _;
    }

    constructor () ERC721("Safe Exit Fund", "SEF") {
        _token = IGuilderFi(msg.sender);

        packages.push(Package(25 ether, 0, 24, "")); // PACK A, index 0
        packages.push(Package(5 ether, 25, 49, "")); // PACK B, index 1
        packages.push(Package(1 ether, 50, 74, "")); // PACK C, index 2
        packages.push(Package(10 ether, 75, 99, "")); // PACK D, index 3
    }

    // External function executed with every main contract transaction
    function execute() override external onlyToken {
        // TODO
    }

    /**
     * Gets a wallet address and an amount of coins to insure. 
     * Tries to fill all the NFTs in the user's wallet insuring the amount.
     * 
     * Called by the token contract when a "buy" event occurs
     */
    function fillNftsInWallet(address _walletAddress, uint256 _amount) external onlyToken {
        for (uint256 i = 0; i < balanceOf(_walletAddress); i++) {
            if (_amount <= 0) return;

            uint256 nftId = tokenOfOwnerByIndex(_walletAddress, i);

            (uint256 insuredPerNft, uint256 totalInsurablePerNft) = getNftInsurance(nftId);

            if (insuredPerNft < totalInsurablePerNft) {
                uint256 spaceLeft = totalInsurablePerNft - insuredPerNft;

                if (_amount <= spaceLeft) {
                    nftData[nftId].insuredAmount += _amount;
                    return;
                } else {
                    nftData[nftId].insuredAmount += spaceLeft;
                    _amount -= spaceLeft;
                }
            }
        }
    }

    /**
     * Drains all the insured amount for a user.
     * 
     * Called by the token contract when a user transfers or sells any token.
     */
    function drainNftsInWallet(address _walletAddress) external onlyToken {
        for (uint256 i = 0; i < balanceOf(_walletAddress); i++) {
            uint256 nftId = tokenOfOwnerByIndex(_walletAddress, i);
            nftData[nftId].insuredAmount = 0;
        }
    }

    /**
     * Use all the NFTs in a user's wallet giving the insured amount to the user.
     *
     * Called by the user in case he wants the insured amount back
     */
    function useNftsInWallet() external {
        uint256 insuranceToRedeem = 0;

        for (uint256 i = 0; i < balanceOf(msg.sender); i++) {
            uint256 nftId = tokenOfOwnerByIndex(msg.sender, i);
            insuranceToRedeem += nftData[nftId].insuredAmount;
            nftData[nftId].insuredAmount = 0;
            nftData[nftId].used = true;
        }

        payable(msg.sender).transfer(insuranceToRedeem);

        // TODO destroy all tokens in user's wallet.
    }

    function tokenURI(uint256 _nftId) public view virtual override returns (string memory) {
        require(_exists(_nftId), "ERC721Metadata: URI query for nonexistent token");

        if (randomSeedHasBeenSet == false) {
            return unrevealedUri;
        }

        if (nftData[_nftId].used == true) {
            return usedUri;
        }

        return packages[getPackageIndexFromNftId(_nftId)].metadataUri;
    }

    function setMetadataUri(uint256 _packIndex, string memory _uri) external onlyTokenOwner {
        require(_packIndex <= packages.length, "NFT package index not found");

        packages[_packIndex].metadataUri = _uri;
    }

    function mint(address _walletAddress) external onlyPresale {
        uint256 tokenId = _tokenId.current();
        require(tokenId < maxSupply, "Can't mint more NFTs");
        _mint(_walletAddress, tokenId);
        _tokenId.increment();
    }

    /**
     * Gets the package index given a token ID. 
     * Works with a random procedure after the nfts are revealed
     */
    function getPackageIndexFromNftId(uint256 _nftId) public view nftsRevealed returns (uint256) {
        // using timestamp salt & random seed & nftId we get a pseudo random number between 0 and 99
        uint256 randomNum = uint256(keccak256(abi.encodePacked(timestampSalt, randomSeed, _nftId))) % 100;

        for (uint i=0; i<packages.length; i++) {
            if (randomNum >= packages[i].randomRangeFrom && randomNum <= packages[i].randomRangeTo) {
                return i;
            }
        }

        return 0;
    }

    /**
     * Gets the insurance amount of an NFT, and the total insurable
     */     
    function getNftInsurance(uint256 _nftId) public view returns (uint256, uint256) {
        require(_exists(_nftId), "ERC721Metadata: URI query for nonexistent token");

        if (nftData[_nftId].used == true) return (0,0);

        return (nftData[_nftId].insuredAmount, packages[getPackageIndexFromNftId(_nftId)].insuranceAmount);
    }

    /**
     * Gets the total insured amount of a user, and the total insurable
     */
    function getTotalUserInsurance(address _walletAddress) external view returns (uint256, uint256) {
        uint256 insuredAmount = 0;
        uint256 totalInsurable = 0;

        for (uint256 i = 0; i < balanceOf(_walletAddress); i++) {
            uint256 nftId = tokenOfOwnerByIndex(_walletAddress, i);
            (uint256 insuredPerNft, uint256 totalInsurablePerNft) = getNftInsurance(nftId);
            insuredAmount += insuredPerNft;
            totalInsurable += totalInsurablePerNft;
        }

        return (insuredAmount, totalInsurable);
    }

    // Should be set after pre-sales are complete
    // Trigerred by an external function from main contract
    function setRandomSeed(uint256 _randomSeed) external onlyToken {
        if (!randomSeedHasBeenSet) {
            randomSeed = _randomSeed;
            timestampSalt = block.timestamp;

            // ensure random seed can only be set once
            randomSeedHasBeenSet = true;
        }
    }

    function withdraw(uint256 amount) external override onlyTokenOwner {
        payable(msg.sender).transfer(amount);
    }
    
    function withdrawTokens(address token, uint256 amount) external override onlyTokenOwner {
        IERC20(token).transfer(msg.sender, amount);
    }

    receive() external payable {}
}