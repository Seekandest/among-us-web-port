import React, { useState, useEffect } from 'react';
import socketService from '../services/socket';

/**
 * @param {{onJoinGame: (roomId: string) => void}} props
 */
export function Lobby({ onJoinGame }) {
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [error, setError] = useState('');

  const socket = socketService.getSocket();

  useEffect(() => {
    // Listen for lobby events
    socket.on('lobby:created', (data) => {
      console.log('Lobby created:', data);
      onJoinGame(data.roomId);
    });

    socket.on('lobby:joined', (data) => {
      console.log('Joined lobby:', data);
      onJoinGame(data.roomId);
    });

    return () => {
      socket.off('lobby:created');
      socket.off('lobby:joined');
    };
  }, [socket, onJoinGame]);

  const handleRegister = () => {
    if (!playerName.trim()) {
      setError('Please enter a name');
      return;
    }

    const playerId = socket.id;
    if (!playerId) {
      setError('Not connected to server');
      return;
    }

    socket.emit('player:register', {
      id: playerId,
      name: playerName.trim(),
      roomId: '', // Will be set when joining/creating
      color: getRandomColor(),
    });

    setIsRegistered(true);
    setError('');
  };

  const handleCreateLobby = () => {
    if (!isRegistered) {
      setError('Please register first');
      return;
    }

    const newRoomId = generateRoomId();
    socket.emit('lobby:create', {
      hostId: socket.id,
      roomId: newRoomId,
    });
  };

  const handleJoinLobby = () => {
    if (!isRegistered) {
      setError('Please register first');
      return;
    }

    if (!roomId.trim()) {
      setError('Please enter a room code');
      return;
    }

    socket.emit('lobby:join', {
      playerId: socket.id,
      roomId: roomId.trim().toUpperCase(),
    });
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.title}>Among Us</h1>

        {!isRegistered ? (
          <div style={styles.section}>
            <h2 style={styles.subtitle}>Enter Your Name</h2>
            <input
              type="text"
              placeholder="Your name..."
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              style={styles.input}
              maxLength={20}
            />
            <button onClick={handleRegister} style={styles.button}>
              Continue
            </button>
          </div>
        ) : (
          <div style={styles.section}>
            <p style={styles.welcome}>Welcome, {playerName}!</p>

            <button onClick={handleCreateLobby} style={styles.buttonPrimary}>
              Create Lobby
            </button>

            <div style={styles.divider}>
              <span>or</span>
            </div>

            <input
              type="text"
              placeholder="Enter room code..."
              value={roomId}
              onChange={(e) => setRoomId(e.target.value.toUpperCase())}
              style={styles.input}
              maxLength={6}
            />
            <button onClick={handleJoinLobby} style={styles.button}>
              Join Lobby
            </button>
          </div>
        )}

        {error && <p style={styles.error}>{error}</p>}
      </div>
    </div>
  );
}

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function getRandomColor() {
  const colors = [
    '#c51111', // red
    '#132ed1', // blue
    '#117f2d', // green
    '#ed54ba', // pink
    '#ef7d0d', // orange
    '#f5f557', // yellow
    '#3f474e', // black
    '#d6e0f0', // white
    '#6b2fbc', // purple
    '#71491e', // brown
    '#38fedc', // cyan
    '#50ef39', // lime
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

const styles = {
  container: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a2e',
    fontFamily: 'Arial, sans-serif',
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 40,
    minWidth: 350,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
    textAlign: 'center',
  },
  title: {
    color: '#fff',
    fontSize: 36,
    margin: '0 0 24px 0',
    textShadow: '2px 2px 4px rgba(0, 0, 0, 0.5)',
  },
  subtitle: {
    color: '#e0e0e0',
    fontSize: 18,
    margin: '0 0 16px 0',
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  welcome: {
    color: '#4ecca3',
    fontSize: 18,
    margin: '0 0 16px 0',
  },
  input: {
    padding: '12px 16px',
    fontSize: 16,
    borderRadius: 8,
    border: '2px solid #4ecca3',
    backgroundColor: '#0f3460',
    color: '#fff',
    outline: 'none',
    textAlign: 'center',
  },
  button: {
    padding: '12px 24px',
    fontSize: 16,
    fontWeight: 'bold',
    borderRadius: 8,
    border: 'none',
    backgroundColor: '#4ecca3',
    color: '#1a1a2e',
    cursor: 'pointer',
    transition: 'transform 0.1s, background-color 0.2s',
  },
  buttonPrimary: {
    padding: '16px 24px',
    fontSize: 18,
    fontWeight: 'bold',
    borderRadius: 8,
    border: 'none',
    backgroundColor: '#e94560',
    color: '#fff',
    cursor: 'pointer',
    transition: 'transform 0.1s, background-color 0.2s',
  },
  divider: {
    display: 'flex',
    alignItems: 'center',
    margin: '16px 0',
    color: '#666',
  },
  error: {
    color: '#e94560',
    marginTop: 16,
    fontSize: 14,
  },
};

export default Lobby;

