import {useState, useEffect} from 'react';

import {PhaserGame} from './PhaserGame';
import socketService from './services/socket';
import Lobby from './pages/Room';
import styles from './App.module.css';

const PAGES = {LOBBY: 'lobby', GAME: 'game'};

function App() {
  const [currentPage, setCurrentPage] = useState(PAGES.LOBBY);
  const [roomId, setRoomId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [socket, setSocket] = useState(null);

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

    sockett.on('connect', handleConnect);
    sockett.on('disconnect', handleDisconnect);

    return () => {
      sockett.off('connect', handleConnect);
      sockett.off('disconnect', handleDisconnect);
      socketService.disconnect();
    };
  }, []);

  const handleJoinGame = (joinedRoomId) => {
    setRoomId(joinedRoomId);
    setCurrentPage(PAGES.GAME);
  };

  const handleBackToRoom = () => {
    const playerId = localStorage.getItem('playerId');
    if (socket && playerId) socket.emit('room:leave', {playerId});
    setRoomId(null);
    setCurrentPage(PAGES.LOBBY);
  };

  return (
    <div id="app">
      <div className={`${styles.statusBadge} ${isConnected ? styles.connected : styles.disconnected}`}>
        {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
      </div>

      {currentPage === PAGES.LOBBY && (
        <Lobby onJoinGame={handleJoinGame}/>
      )}

      {currentPage === PAGES.GAME && (
        <div className={styles.gameWrapper}>
          <button
            onClick={handleBackToRoom}
            className={styles.backButton}
          >
            ← Leave
          </button>

          <div className={styles.roomTag}>
            Room: {roomId}
          </div>

          <PhaserGame/>
        </div>
      )}
    </div>
  );
}

export default App
