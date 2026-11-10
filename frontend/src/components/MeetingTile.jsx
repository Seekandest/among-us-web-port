import {useState,useEffect} from "react";
import styles from './meetingTile.module.css';

// Public assets should be referenced by URL paths (served from /assets/...)
const playerIcon = '/assets/meeting/pfp.png';
const voteIcon = '/assets/meeting/voted.png';
const ivotedIcon = '/assets/meeting/ivoted.png';
const cancelIcon = '/assets/meeting/cancel.png';
const confirmIcon = '/assets/meeting/confirm.png';
// player: {id, name, voted, color}
export default function MeetingTile({player, votes, VoteCallBack, disabled = false}) {
  const [selected, setSelected] = useState(false);
  const [localPlayerVoted, setLocalPlayerVoted] = useState(false);
  const locked = disabled || localPlayerVoted;

  const handleConfirm = (e) => {
    e.stopPropagation();
    if (locked) return;
    // Read it NOW: at module load (before registering) sessionStorage had no playerId yet.
    const localPlayerId = sessionStorage.getItem('playerId');
    setSelected(false);
    // callerId is informative only: the server takes the voter from our connection.
    VoteCallBack({callerId: localPlayerId, votedForId: player.id});
    setLocalPlayerVoted(true);
  }
  const handleCancel = (e) => {
    e.stopPropagation();
    setSelected(false);
  }
  return <>
  <div className={styles.tile} onClick={() => {!locked && setSelected(!selected)}}>
    <div className="flex flex-row">
    <div className={styles.playerIcon}>
      <img src={playerIcon} alt="Player Icon" className={styles.iconImage}/>
      {player.voted && <img src={ivotedIcon} alt="I Voted Icon" className={styles.ivoted}/>}
    </div>

    <div className={styles.textContainer}>
      <div className={styles.name}>
        {player.name}
      </div>
      <div className={styles.votesContainer}>
        {votes && votes.map(vote => (
          <div key={vote.id} className={styles.vote}>
            <img src={voteIcon} alt="Vote Icon" className={styles.voteImage}/>
          </div>
        ))}
      </div>
    </div>
    </div>

    {selected && <div className='flex justify-between items-center max-w-[60px]'>
      <img src={confirmIcon} alt="Confirm Icon" className='h-1/2' onClick={handleConfirm}/>
      <img src={cancelIcon} alt="Cancel Icon" className='h-1/2' onClick={handleCancel}/>
    </div>}

  </div>
  </>
}
