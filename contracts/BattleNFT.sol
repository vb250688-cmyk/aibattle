// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BattleNFT is ERC721, Ownable {
    mapping(address => mapping(uint256 => bool)) public owns;
    mapping(uint256 => string) private _tokenURIs;
    uint256 private _tokenIds;
    
    constructor() ERC721("Battle Badge", "BADGE") Ownable(msg.sender) {}
    
    function mintBadge(uint256 badgeId) external {
        require(!owns[msg.sender][badgeId], "Already owns this badge");
        _tokenIds++;
        uint256 newTokenId = _tokenIds;
        _safeMint(msg.sender, newTokenId);
        owns[msg.sender][badgeId] = true;
    }
    
    function setBadgeURI(uint256 badgeId, string memory uri) external onlyOwner {
        _tokenURIs[badgeId] = uri;
    }
    
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "Token doesn't exist");
        return _tokenURIs[tokenId];
    }
    
    function ownerMint(address to, uint256 tokenId) external onlyOwner {
        _safeMint(to, tokenId);
    }
}
