import {useRef, useState, useEffect} from 'react';

import {PhaserGame} from './PhaserGame';
import socketService from './services/socket';
import Room from './pages/Room';

function App() {
  const [currentPage, setCurrentPage] = useState('room'); // 'room' | 'game'
  const [roomId, setRoomId] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  //  References to the PhaserGame component (game and scene are exposed)
  const phaserRef = useRef();

  // Initialize socket connection
  useEffect(() => {
    socketService.connect();

    // Update connection status
    const socket = socketService.getSocket();
    socket.on("connect", () => setIsConnected(true));
    socket.on("disconnect", () => setIsConnected(false));

    // Cleanup on unmount
    return () => {
      socketService.disconnect();
    };
  }, []);

  const handleJoinGame = (joinedRoomId) => {
    setRoomId(joinedRoomId);
    setCurrentPage('game');
  };

  const handleBackToRoom = () => {
    setRoomId(null);
    setCurrentPage('room');
  };

  return (
    <div id="app">
      {/* Connection status indicator */}
      <div style={{
        position: 'absolute',
        top: 10,
        right: 10,
        padding: '5px 10px',
        backgroundColor: isConnected ? '#4caf50' : '#f44336',
        color: 'white',
        borderRadius: '5px',
        zIndex: 1000
      }}>
        {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
      </div>

      {currentPage === 'room' && (
        <Room onJoinGame={handleJoinGame}/>
      )}

      {currentPage === 'game' && (
        <div style={{position: 'relative'}}>
          {/* Back button */}
          <button
            onClick={handleBackToRoom}
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              zIndex: 1000,
              padding: '8px 16px',
              backgroundColor: '#e94560',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              fontWeight: 'bold',
            }}
          >
            ← Leave
          </button>

          {/* Room ID display */}
          <div style={{
            position: 'absolute',
            top: 10,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            padding: '8px 16px',
            backgroundColor: '#16213e',
            color: '#4ecca3',
            borderRadius: 6,
            fontFamily: 'monospace',
            fontSize: 18,
          }}>
            Room: {roomId}
          </div>

          <PhaserGame ref={phaserRef}/>
        </div>
      )}
    </div>
  );
}

export default App
