import React, {useState, useEffect} from 'react';
import socketService from '../services/socket';

/**
 * @param {{onJoinGame: (roomId: string) => void}} props
 */
export function Room({onJoinGame}) {
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('');
  const [isRegistered, setIsRegistered] = useState(false);
  const [error, setError] = useState('');
  const [rooms, setRooms] = useState({});

  const socket = socketService.getSocket();

  useEffect(() => {
    // Listen for room events
    socket.on('room:created', (data) => {
      console.log('Room created:', data);
      onJoinGame(data.roomId);
    });

    socket.on('room:joined', (data) => {
      console.log('Joined room:', data);
      socket.join(data.roomId);
      onJoinGame(data.roomId);
    });

    return () => {
      socket.off('room:created');
      socket.off('room:joined');
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
      id: playerId, name: playerName.trim(), color: getRandomColor(),
    });

    setIsRegistered(true);
    setError('');
  };

  const handleCreateRoom = () => {
    if (!isRegistered) {
      setError('Please register first');
      return;
    }

    const newRoomId = generateRoomId();
    socket.emit('room:create', {
      hostId: socket.id, roomId: newRoomId,
    });
  };

  const handleFetchRooms = () => {
    fetch('http://localhost:3001/rooms')
      .then(response => response.json())
      .then(data => {setRooms(data)})
      .catch(error => console.error('Error fetching rooms:', error));
  }
  const handleJoinRoom = (roomId) => {
    if (!isRegistered) {
      setError('Please register first');
      return;
    }

    socket.emit('room:join', {
      playerId: socket.id, roomId: roomId.trim().toUpperCase(),
    });
    onJoinGame(roomId);
  };

  return (<div style={styles.container}>
    <div style={styles.card}>
      <h1 style={styles.title}>Among Us</h1>

      {!isRegistered ? (<div style={styles.section}>
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
      </div>) : (<div style={styles.section}>
        <p style={styles.welcome}>Welcome, {playerName}!</p>

        <button onClick={handleCreateRoom} style={styles.buttonPrimary}>
          Create Room
        </button>

        <div style={styles.divider}>
          <span>or</span>
        </div>

        <button onClick={handleJoinRoom} style={styles.button}>
          Join Room
        </button>
        <button onClick={handleFetchRooms} style={styles.button}>
          Refresh Rooms
        </button>
        <div>
          {rooms.length > 0 ? ( <div>
            <h3 style={{color: '#fff'}}>Available Rooms:</h3>
            <ul style={{listStyleType: 'none', padding: 0}}>
              {Object.values(rooms).map((room) => (
                <li key={room.id} style={{marginBottom: 8}}>
                  <span style={{color: '#4ecca3', fontWeight: 'bold'}}>{room.id}</span> - Host: <span style={{color: '#f39c12'}}>{room.host.name}</span> - Players: <span style={{color: '#f39c12'}}>{Object.keys(room.players).length}</span>
                  <button onClick={() => handleJoinRoom(room.id)}></button>
                </li>
              ))}
            </ul>
          </div>) : (<p style={{color: '#aaa'}}>No available rooms. Create one!</p>)}
        </div>

      </div>)}

      {error && <p style={styles.error}>{error}</p>}
    </div>
  </div>);
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
  const colors = ['#c51111', // red
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
  }, card: {
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 40,
    minWidth: 350,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
    textAlign: 'center',
  }, title: {
    color: '#fff', fontSize: 36, margin: '0 0 24px 0', textShadow: '2px 2px 4px rgba(0, 0, 0, 0.5)',
  }, subtitle: {
    color: '#e0e0e0', fontSize: 18, margin: '0 0 16px 0',
  }, section: {
    display: 'flex', flexDirection: 'column', gap: 12,
  }, welcome: {
    color: '#4ecca3', fontSize: 18, margin: '0 0 16px 0',
  }, input: {
    padding: '12px 16px',
    fontSize: 16,
    borderRadius: 8,
    border: '2px solid #4ecca3',
    backgroundColor: '#0f3460',
    color: '#fff',
    outline: 'none',
    textAlign: 'center',
  }, button: {
    padding: '12px 24px',
    fontSize: 16,
    fontWeight: 'bold',
    borderRadius: 8,
    border: 'none',
    backgroundColor: '#4ecca3',
    color: '#1a1a2e',
    cursor: 'pointer',
    transition: 'transform 0.1s, background-color 0.2s',
  }, buttonPrimary: {
    padding: '16px 24px',
    fontSize: 18,
    fontWeight: 'bold',
    borderRadius: 8,
    border: 'none',
    backgroundColor: '#e94560',
    color: '#fff',
    cursor: 'pointer',
    transition: 'transform 0.1s, background-color 0.2s',
  }, divider: {
    display: 'flex', alignItems: 'center', margin: '16px 0', color: '#666',
  }, error: {
    color: '#e94560', marginTop: 16, fontSize: 14,
  },
};

export default Room;

