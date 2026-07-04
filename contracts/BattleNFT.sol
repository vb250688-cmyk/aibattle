// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title BattleNFT — AI Battle Trader Achievement Badges
/// @notice Each "badge type" is an achievement (e.g. Tier unlocked, PvP win, 100 trades).
///         Players self-mint (paying only gas) once they've unlocked a badge in-game.
///         The frontend gates *which* mint buttons are shown/enabled based on the
///         player's local game state — same trust model already used by the existing
///         Sepolia "Tier Unlock" gas-fee system in this project. This is a testnet
///         demo, not a trustless on-chain verification system.
contract BattleNFT is ERC721, Ownable {
    uint256 public nextTokenId;

    // wallet => badgeType => already minted?
    mapping(address => mapping(uint256 => bool)) public hasBadge;
    // badgeType => metadata URI (set by owner after deploy)
    mapping(uint256 => string) public badgeURI;
    // tokenId => badgeType (for tokenURI lookups)
    mapping(uint256 => uint256) public tokenBadgeType;

    event BadgeMinted(address indexed to, uint256 indexed badgeType, uint256 tokenId);
    event BadgeConfigured(uint256 indexed badgeType, string uri);

    constructor() ERC721("AI Battle Trader Badge", "BATTLEBADGE") Ownable(msg.sender) {}

    /// @notice Owner sets/updates metadata URI for a badge type (call once per badge type after deploy).
    function setBadgeURI(uint256 badgeType, string calldata uri) external onlyOwner {
        badgeURI[badgeType] = uri;
        emit BadgeConfigured(badgeType, uri);
    }

    /// @notice Self-mint a badge you've unlocked in-game. One per badge type per wallet.
    function mintBadge(uint256 badgeType) external {
        require(!hasBadge[msg.sender][badgeType], "Already minted this badge");
        require(bytes(badgeURI[badgeType]).length > 0, "Badge type not configured yet");

        hasBadge[msg.sender][badgeType] = true;
        uint256 tokenId = nextTokenId;
        nextTokenId++;
        tokenBadgeType[tokenId] = badgeType;
        _safeMint(msg.sender, tokenId);

        emit BadgeMinted(msg.sender, badgeType, tokenId);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return badgeURI[tokenBadgeType[tokenId]];
    }

    /// @notice Convenience view: does `user` already own `badgeType`?
    function owns(address user, uint256 badgeType) external view returns (bool) {
        return hasBadge[user][badgeType];
    }
}
