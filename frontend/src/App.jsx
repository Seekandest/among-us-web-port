import {useState, useEffect, useRef} from 'react';

import {PhaserGame} from './PhaserGame';
import socketService from './services/socket';
import Menu from './pages/Menu.jsx';
import styles from './App.module.css';
import Button from "./components/Button.jsx";
import {EventBus} from './game/EventBus';

const PAGES = {MENU: 'lobby', WAITING: 'waiting', GAME: 'game'};

function App() {
  const [currentPage, setCurrentPage] = useState(PAGES.MENU);
  const [roomId, setRoomId] = useState(null);
  const roomIdRef = useRef(null)
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState(null);
  const playerIdRef = useRef(null);
  const [error, setError] = useState(null);

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
        EventBus.emit('start-game', data);
        setCurrentPage(PAGES.GAME);
      }
    }
    sockett.on('connect', handleConnect);
    sockett.on('disconnect', handleDisconnect);
    sockett.on('game:started', handleStartGame);

    return () => {
      sockett.off('connect', handleConnect);
      sockett.off('disconnect', handleDisconnect);
      sockett.off('game:started', handleStartGame);
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
    // check event bus start-game
    // TODO instead check if room is started and then decide value
  };
  const handleStartGame = () => {
    socket.emit('game:start', { roomId, playerId: playerIdRef.current });
  }

  const handleBackToRoom = () => {
    const playerId = localStorage.getItem('playerId');
    if (socket && playerId) socket.emit('room:leave', {playerId});
    setRoomId(null);
    setCurrentPage(PAGES.MENU);
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

      {(currentPage === PAGES.GAME || currentPage === PAGES.WAITING) && (
        <div className={styles.gameContainer}>
          <PhaserGame/>
          {currentPage === PAGES.WAITING && <Button onClick={handleStartGame} children="Start Game" className={styles.startBtn}/>}
          <button className={styles.backButton} onClick={handleBackToRoom}>Leave</button>
          <div className={styles.roomTag}>
            Room: {roomId}
          </div>
        </div>
      )}
    </div>
  );
}

export default App
