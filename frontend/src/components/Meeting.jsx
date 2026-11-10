import {useState} from 'react';
import styles from './Meeting.module.css';
import Button from './Button';
import MeetingTile from '../components/MeetingTile.jsx'

// players: the ALIVE players sent by the server in meeting:started (keyed by id).
// The server owns the timer; timeRemaining is only a countdown display.
function Meeting({players, onVote, timeRemaining}) {

  const [hasVoted, setHasVoted] = useState(false);
  const playerList = Object.values(players || {}).filter(p => p.isAlive !== false);

  const vote = (data) => {
    if (hasVoted) return;
    setHasVoted(true);
    onVote(data);
  };

  return (
    <div className={styles.meetingOverlay}>
        <div className={styles.screenContent}>
          <div className={styles.contentWrapper}>
            <h1 className={styles.title}>Who is The Imposter?</h1>
            <div className={styles.content}>
              <div className={styles.playerGrid}>
                {playerList.map(player => (
                  <MeetingTile key={player.id} player={player} name={player.name} VoteCallBack={vote} disabled={hasVoted}/>
                ))}
              </div>
              <div className={styles.actions}>
                <Button
                  className={styles.skipBtn}
                  onClick={() => vote({votedForId: 'skip'})}
                  disabled={hasVoted}
                >
                  {hasVoted ? 'Vote sent' : 'Skip'}
                </Button>
              </div>
              <div className={styles.timer}>
                Time Remaining: {Math.ceil(timeRemaining / 1000)}s
              </div>
            </div>
          </div>
      </div>
    </div>
)

}

export default Meeting;
