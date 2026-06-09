// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AIBattleScore
 * @dev Production-ready battle leaderboard for AI vs User trading battles
 * Stores every battle, maintains separate leaderboards, tracks stats
 */
contract AIBattleScore {
    
    // ══════════════════════════════════════════════════════
    // STRUCTS
    // ══════════════════════════════════════════════════════
    
    struct Battle {
        uint256 id;
        address player;
        uint256 userScore;
        uint256 aiScore;
        bool userWon;  // true = user won, false = ai won, null if tie
        uint256 timestamp;
        string battleHash; // optional: IPFS hash or battle summary
    }

    struct PlayerStats {
        uint256 totalBattles;
        uint256 wins;
        uint256 losses;
        uint256 ties;
        uint256 totalScore;
        uint256 bestScore;
        uint256 lastBattleTime;
    }

    // ══════════════════════════════════════════════════════
    // STATE
    // ══════════════════════════════════════════════════════
    
    Battle[] public battles;
    mapping(address => PlayerStats) public playerStats;
    mapping(address => uint256[]) public playerBattles; // player -> battle IDs
    
    address[] public allPlayers;
    mapping(address => bool) public isPlayer;

    event BattleSaved(
        uint256 indexed battleId,
        address indexed player,
        uint256 userScore,
        uint256 aiScore,
        bool userWon,
        uint256 timestamp
    );

    event PlayerStatsUpdated(
        address indexed player,
        uint256 totalBattles,
        uint256 wins,
        uint256 totalScore
    );

    // ══════════════════════════════════════════════════════
    // FUNCTIONS
    // ══════════════════════════════════════════════════════

    /**
     * Save a battle result
     * @param userScore - User's portfolio points
     * @param aiScore - AI's portfolio points
     */
    function saveBattle(uint256 userScore, uint256 aiScore) external {
        address player = msg.sender;
        
        // Determine winner (higher score wins)
        bool userWon;
        if (userScore > aiScore) {
            userWon = true;
        } else if (aiScore > userScore) {
            userWon = false;
        } else {
            // Tie — but we still need to pick one for bool
            userWon = false; // default to false for ties
        }

        // Create battle record
        uint256 battleId = battles.length;
        Battle memory newBattle = Battle({
            id: battleId,
            player: player,
            userScore: userScore,
            aiScore: aiScore,
            userWon: userWon,
            timestamp: block.timestamp,
            battleHash: ""
        });
        battles.push(newBattle);

        // Update player stats
        PlayerStats storage stats = playerStats[player];
        
        if (stats.totalBattles == 0) {
            // First battle — add to player list
            allPlayers.push(player);
            isPlayer[player] = true;
        }

        stats.totalBattles++;
        if (userScore > aiScore) {
            stats.wins++;
        } else if (aiScore > userScore) {
            stats.losses++;
        } else {
            stats.ties++;
        }
        stats.totalScore += userScore;
        if (userScore > stats.bestScore) {
            stats.bestScore = userScore;
        }
        stats.lastBattleTime = block.timestamp;

        // Track battle ID for player
        playerBattles[player].push(battleId);

        emit BattleSaved(battleId, player, userScore, aiScore, userWon, block.timestamp);
        emit PlayerStatsUpdated(player, stats.totalBattles, stats.wins, stats.totalScore);
    }

    /**
     * Get battle by ID
     */
    function getBattle(uint256 battleId) external view returns (Battle memory) {
        require(battleId < battles.length, "Battle not found");
        return battles[battleId];
    }

    /**
     * Get all battles for a player
     */
    function getPlayerBattles(address player) external view returns (uint256[] memory) {
        return playerBattles[player];
    }

    /**
     * Get player stats
     */
    function getPlayerStats(address player) external view returns (PlayerStats memory) {
        return playerStats[player];
    }

    /**
     * Get total battles
     */
    function getTotalBattles() external view returns (uint256) {
        return battles.length;
    }

    /**
     * Get top N players by total score
     */
    function getTopPlayers(uint256 limit) external view returns (
        address[] memory addresses,
        uint256[] memory scores,
        uint256[] memory wins,
        uint256[] memory battleCounts
    ) {
        uint256 len = allPlayers.length < limit ? allPlayers.length : limit;
        
        // Simple bubble sort by total score (for small lists)
        address[] memory sorted = new address[](len);
        uint256 count = 0;
        
        for (uint256 i = 0; i < allPlayers.length && count < len; i++) {
            address current = allPlayers[i];
            uint256 currentScore = playerStats[current].totalScore;
            
            // Insert in sorted order
            uint256 insertPos = count;
            for (uint256 j = 0; j < count; j++) {
                if (currentScore > playerStats[sorted[j]].totalScore) {
                    insertPos = j;
                    break;
                }
            }
            
            // Shift elements
            for (uint256 j = count; j > insertPos; j--) {
                sorted[j] = sorted[j - 1];
            }
            sorted[insertPos] = current;
            count++;
        }

        // Extract data for top players
        addresses = new address[](len);
        scores = new uint256[](len);
        wins = new uint256[](len);
        battleCounts = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            addresses[i] = sorted[i];
            scores[i] = playerStats[sorted[i]].totalScore;
            wins[i] = playerStats[sorted[i]].wins;
            battleCounts[i] = playerStats[sorted[i]].totalBattles;
        }
    }

    /**
     * Get leaderboard by wins
     */
    function getTopPlayersByWins(uint256 limit) external view returns (
        address[] memory addresses,
        uint256[] memory winCounts,
        uint256[] memory battleCounts
    ) {
        uint256 len = allPlayers.length < limit ? allPlayers.length : limit;
        
        address[] memory sorted = new address[](len);
        uint256 count = 0;
        
        // Sort by wins
        for (uint256 i = 0; i < allPlayers.length && count < len; i++) {
            address current = allPlayers[i];
            uint256 currentWins = playerStats[current].wins;
            
            uint256 insertPos = count;
            for (uint256 j = 0; j < count; j++) {
                if (currentWins > playerStats[sorted[j]].wins) {
                    insertPos = j;
                    break;
                }
            }
            
            for (uint256 j = count; j > insertPos; j--) {
                sorted[j] = sorted[j - 1];
            }
            sorted[insertPos] = current;
            count++;
        }

        addresses = new address[](len);
        winCounts = new uint256[](len);
        battleCounts = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            addresses[i] = sorted[i];
            winCounts[i] = playerStats[sorted[i]].wins;
            battleCounts[i] = playerStats[sorted[i]].totalBattles;
        }
    }

    /**
     * Get recent battles (last N)
     */
    function getRecentBattles(uint256 limit) external view returns (Battle[] memory) {
        uint256 len = battles.length < limit ? battles.length : limit;
        Battle[] memory recent = new Battle[](len);
        
        for (uint256 i = 0; i < len; i++) {
            recent[i] = battles[battles.length - 1 - i];
        }
        return recent;
    }

    /**
     * Get all players
     */
    function getAllPlayers() external view returns (address[] memory) {
        return allPlayers;
    }

    /**
     * Get leaderboard ranking for a player
     */
    function getPlayerRank(address player) external view returns (uint256 rank) {
        uint256 playerScore = playerStats[player].totalScore;
        rank = 1;
        
        for (uint256 i = 0; i < allPlayers.length; i++) {
            if (playerStats[allPlayers[i]].totalScore > playerScore) {
                rank++;
            }
        }
    }
}
