import {useState, useEffect, useRef} from 'react';
import {PhaserGame} from './PhaserGame';
import socketService from './services/socket';
import Menu from './pages/Menu.jsx';
import styles from './App.module.css';
import Button from "./components/Button.jsx";
import Meeting from "./components/Meeting.jsx";
import EndGame from "./components/EndGame.jsx";
import {EventBus} from './game/EventBus';

const PAGES = {MENU: 'lobby', WAITING: 'waiting', GAME: 'game', GAMEEND: 'gameend'};

function App() {
  const [currentPage, setCurrentPage] = useState(PAGES.MENU);
  const [roomId, setRoomId] = useState(null);
  const roomIdRef = useRef(null)
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const playerIdRef = useRef(null);
  const [error, setError] = useState(null);

  // Meeting state
  const [meetingActive, setMeetingActive] = useState(false);
  const [meetingData, setMeetingData] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(60000);

  const [gameResult, setGameResult] = useState(null);
  const [isLocalPlayerImposter, setIsLocalPlayerImposter] = useState(false);

  useEffect(() => {
    socketService.connect();
    const sockett = socketService.getSocket();
    if (!sockett) {
      console.warn('Socket unavailable after connect()');
      return;
    }
    setSocket(sockett);

    const handleConnect = () => setIsConnected(true);
    const handleDisconnect = () => setIsConnected(false);
    const handleStartGame = (data) => {
      console.log('Game started event received in App:', data, roomIdRef.current, data.roomId === roomId);
      if (data.roomId === roomIdRef.current) {
        console.log('Starting game for room:', roomId);
        data.playerId = playerIdRef.current;
        setIsLocalPlayerImposter(data.isImposter);
        EventBus.emit('start-game', data);
        setCurrentPage(PAGES.GAME);
      }
    }

    // Meeting Event from Phaser
    const handleMeetingStarted = (data) => {
      console.log('Meeting started in App:', data);
      setMeetingData(data);
      setMeetingActive(true);
      setTimeRemaining(60000); // Reset timer to 60 seconds
    };

    const handleMeetingEnded = (data) => {
      console.log('Meeting ended in App:', data);
      setMeetingActive(false);
      setMeetingData(null);
    };

    const handleGameEnd = (data) => {
      console.log('Game end event received in App:', data);
      setGameResult(data);
      setCurrentPage(PAGES.GAMEEND);
    };

    sockett.on('connect', handleConnect);
    sockett.on('disconnect', handleDisconnect);
    sockett.on('game:started', handleStartGame);

    EventBus.on('meeting:started', handleMeetingStarted);
    EventBus.on('meeting:ended', handleMeetingEnded);
    EventBus.on('game:ended', handleGameEnd);

    return () => {
      sockett.off('connect', handleConnect);
      sockett.off('disconnect', handleDisconnect);
      sockett.off('game:started', handleStartGame);
      EventBus.off('meeting:started', handleMeetingStarted);
      EventBus.off('meeting:ended', handleMeetingEnded);
      EventBus.off('game:ended', handleGameEnd);
      socketService.disconnect();
    };
  }, []);

  const handleJoinRoom = (data) => {
    const joinedRoomId = data.roomId;
    playerIdRef.current = data.playerId;
    console.log('Joining room with ID:', joinedRoomId);
    setRoomId(joinedRoomId);
    roomIdRef.current = joinedRoomId;
    setCurrentPage(PAGES.WAITING);
  };
  const handleStartGameBtn = () => {
    socket.emit('game:start', { roomId });
  }
  const handleBackToRoom = () => {
    const playerId = localStorage.getItem('playerId');
    if (socket && playerId) socket.emit('room:leave', {playerId});
    setRoomId(null);
    setCurrentPage(PAGES.MENU);
  };

  // Timer countdown for meeting
  useEffect(() => {
    if (!meetingActive) return;

    const interval = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1000) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1000;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [meetingActive]);

  const handleVote = (votedForId) => {
    if (!socket || !roomId) return;
    console.log('Voting for:', votedForId);
    socket.emit('meeting:vote', {
      roomId: roomId,
      callerId: playerIdRef.current,
      votedForId: votedForId
    });
  };

  const handleEndMeeting = () => {
    if (!socket || !roomId) return;
    console.log('Ending meeting');
    socket.emit('meeting:end', {
      roomId: roomId
    });
  };

  return (
    <div id="app">
      {error && <p className={styles.error}>{error}</p>}
      <div className={`${styles.statusBadge} ${isConnected ? styles.connected : styles.disconnected}`}>
        {isConnected ? '🟢 Connected' : '🔴 Disconnected'}

      </div>

      {currentPage === PAGES.MENU && (
        <Menu onJoinGame={handleJoinRoom}/>
      )}

      {currentPage === PAGES.GAMEEND && (
        <EndGame
          result={gameResult}
          onBackToMenu={handleBackToRoom}
          isLocalPlayerImposter={isLocalPlayerImposter}
        />
      )}

      {(currentPage === PAGES.GAME || currentPage === PAGES.WAITING) && (
        <div className={styles.gameContainer}>
          <PhaserGame/>
          {currentPage === PAGES.WAITING && <Button onClick={handleStartGameBtn} children="Start Game" className={styles.startBtn}/>}
          <button className={styles.backButton} onClick={handleBackToRoom}>Leave</button>
          <div className={styles.roomTag}>
            Room: {roomId}
          </div>

          {/* Meeting UI overlay */}
          {meetingActive && meetingData && (
            <Meeting
              players={meetingData.players}
              currentPlayerId={playerIdRef.current}
              onVote={handleVote}
              onEndMeeting={handleEndMeeting}
              timeRemaining={timeRemaining}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default App
