import { useState, useEffect } from 'react';
import styles from './Meeting.module.css';
import Button from './Button';

function Meeting({ players, currentPlayerId, onVote, onEndMeeting, timeRemaining }) {
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    const [hasVoted, setHasVoted] = useState(false);

    const handleVote = (playerId) => {
        if (hasVoted) return;
        setSelectedPlayer(playerId);
    };

    const confirmVote = () => {
        if (hasVoted || !selectedPlayer) return;
        setHasVoted(true);
        onVote(selectedPlayer);
    };

    const skipVote = () => {
        if (hasVoted) return;
        setHasVoted(true);
        onVote(null); // null means skip
    };

    // Convert players object to array
    const playerList = Object.values(players || {}).filter(p => p.isAlive !== false);

    return (
        <div className={styles.meetingOverlay}>
            <div className={styles.meetingContainer}>
                <h1 className={styles.title}>Emergency Meeting</h1>

                <div className={styles.timer}>
                    Time Remaining: {Math.ceil(timeRemaining / 1000)}s
                </div>

                <div className={styles.content}>
                    <h2 className={styles.subtitle}>Who is the Imposter?</h2>

                    <div className={styles.playerGrid}>
                        {playerList.map(player => (
                            <div
                                key={player.id}
                                className={`${styles.playerCard} ${
                                    selectedPlayer === player.id ? styles.selected : ''
                                } ${hasVoted ? styles.disabled : ''}`}
                                onClick={() => !hasVoted && handleVote(player.id)}
                                style={{ borderColor: player.color }}
                            >
                                <div
                                    className={styles.playerAvatar}
                                    style={{ backgroundColor: player.color }}
                                />
                                <span className={styles.playerName}>
                                    {player.name || `Player ${player.id}`}
                                </span>
                                {player.id === currentPlayerId && (
                                    <span className={styles.youBadge}>(You)</span>
                                )}
                            </div>
                        ))}
                    </div>

                    <div className={styles.actions}>
                        {!hasVoted ? (
                            <>
                                <Button
                                    onClick={confirmVote}
                                    disabled={!selectedPlayer}
                                    className={styles.voteBtn}
                                >
                                    Vote {selectedPlayer ? `for ${playerList.find(p => p.id === selectedPlayer)?.name || 'Player'}` : ''}
                                </Button>
                                <Button
                                    onClick={skipVote}
                                    className={styles.skipBtn}
                                >
                                    Skip Vote
                                </Button>
                            </>
                        ) : (
                            <div className={styles.votedMessage}>
                                ✓ Vote submitted. Waiting for others...
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default Meeting;
