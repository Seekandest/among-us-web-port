import React, {useState, useEffect, useRef} from 'react';
import net from '../services/net.js';
import styles from './room.module.css';
import {Button} from '../components/Button.jsx';

/**
 * @param {{onJoinGame: (roomId: string) => void}} props
 */
export function Menu({onJoinGame}) {
  const [playerName, setPlayerName] = useState('');
  const [password, setPassword] = useState('');
  const [selectedColor, setSelectedColor] = useState(null);
  const [isRegistered, setIsRegistered] = useState(false);
  const isRegisteredRef = useRef(false);
  const [error, setError] = useState('');
  const [rooms, setRooms] = useState({});
  // Latest callback, without re-subscribing to the network on every render.
  const onJoinGameRef = useRef(onJoinGame);
  onJoinGameRef.current = onJoinGame;

  useEffect(() => {
    const savedName = localStorage.getItem('playerName');
    if (savedName) {
      setPlayerName(savedName);
    }
  }, []);

  useEffect(() => {
    // The server PUSHES the whole room list to every client whenever a room changes
    // (created, joined, left, started, deleted): no polling, no HTTP request.
    const onRoomsList = (data) => {
      setRooms(roomsToMap(data.rooms));
    };

    const onRoomJoined = (data) => {
      console.log('Joined room:', data);
      const playerId = getPlayerId()
      // let color;
      // color = getRandomColor();
      // const available_colors = Object.values(data.room.players).map(p => p.color);
      // if (!selectedColor) {
      //   while (!available_colors.includes(color)) {
      //     color = getRandomColor();
      //   }
      // }
      onJoinGameRef.current({roomId: data.roomId, playerId, isHost: data.room.host.id === playerId});
    };

    const onPlayerRegistered = (data) => {
      // The server issued this id. The client never chooses it.
      if (data?.playerId) sessionStorage.setItem('playerId', data.playerId);
      console.log('Player registered', data?.playerId);
      isRegisteredRef.current = true;
      setIsRegistered(true);
    };

    const onPlayerUnregistered = () => {
      console.log('Player unregistered');
      isRegisteredRef.current = false;
      setIsRegistered(false);
    };

    const handleCantJoin = (data) => {
      setError(data.message || 'Cannot join room');
    };

    const handleCantRegister = (data) => {
      isRegisteredRef.current = false;
      setIsRegistered(false);
      setError(data.message || 'Cannot register');
    };

    const askForRooms = () => net.emit('rooms:get', {});

    net.on('rooms:list', onRoomsList);
    net.on('room:joined', onRoomJoined);
    net.on('player:registered', onPlayerRegistered);
    net.on('player:unregistered', onPlayerUnregistered);
    net.on('room:join:error', handleCantJoin);
    net.on('player:register:error', handleCantRegister);
    net.on('connect', askForRooms);

    net.ready.then(() => { if (net.connected) askForRooms(); });

    return () => {
      net.off('rooms:list', onRoomsList);
      net.off('room:joined', onRoomJoined);
      net.off('player:registered', onPlayerRegistered);
      net.off('player:unregistered', onPlayerUnregistered);
      net.off('room:join:error', handleCantJoin);
      net.off('player:register:error', handleCantRegister);
      net.off('connect', askForRooms);
    };

  }, []);

  const handleRegister = () => {
    if (!playerName.trim()) {
      setError('Please enter a name');
      return;
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters');
      return;
    }

    if (!net.connected) {
      setError('Not connected to server');
      return;
    }

    localStorage.setItem('playerName', playerName.trim());

    // Use selected color or random color if none selected
    const playerColor = selectedColor || getRandomColor();
    console.log('Registering player with color:', playerColor, 'Selected:', selectedColor);

    // No player id here: the server creates one (new account) or looks up the existing one.
    // A wrong password comes back as player:register:error.
    net.emit('player:register', {
      name: playerName.trim(), password, color: playerColor,
    });

    setError('');
  };
  const handleBackToRegister = () => {
    // The server knows who we are from our connection (session), no id needed in the payload.
    net.emit('player:unregister', {});
  }
  const handleCreateRoom = () => {
    if (!isRegisteredRef.current) {
      setError('Please register first');
      return;
    }
    setError('');
    net.emit('room:create', {roomId: generateRoomId()});
  };

  const handleJoinRoom = (roomId) => {
    if (!isRegisteredRef.current) {
      setError('Please register first');
      return;
    }
    console.log('Joining room:', roomId);
    setError('');
    // The server checks everything (room exists, not started, name free) and picks a free color
    // if ours is taken. Success -> room:joined, failure -> room:join:error {message}.
    net.emit('room:join', {roomId});
  };

  return (<div className={styles.container}>
    {isRegistered && (<Button onClick={handleBackToRegister} children="Back" className={styles.backBtn}/>)}
    <div className={styles.card}>
      <h1 className={styles.title}>Among Us</h1>
      {!isRegistered ? (<div className={styles.section}>
        <h2 className={styles.subtitle}>Log in</h2>
        <p className={styles.hint}>A new name creates an account. The same name later must use the same password.</p>
        <input
          type="text"
          placeholder="Your name..."
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          className={styles.input}
          maxLength={16}
          onKeyDown={(e) => { if (e.key === 'Enter') handleRegister(); }}
        />
        <input
          type="password"
          placeholder="Password..."
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={styles.input}
          maxLength={64}
          onKeyDown={(e) => { if (e.key === 'Enter') handleRegister(); }}
        />

        <div className={styles.colorPickerSection}>
          <p className={styles.colorLabel}>Choose your color (optional):</p>
          <div className={styles.colorGrid}>
            {getAvailableColors().map((color) => (
              <div
                key={color}
                className={`${styles.colorOption} ${selectedColor === color ? styles.colorOptionSelected : ''}`}
                style={{backgroundColor: color}}
                onClick={() => setSelectedColor(color)}
                title={color}
              />
            ))}
          </div>
          {selectedColor && (
            <button
              onClick={() => setSelectedColor(null)}
              className={styles.clearColorButton}
            >
              Clear Selection (Random)
            </button>
          )}
        </div>

        <Button onClick={handleRegister} children="Register / Log in"/>
      </div>) : (<div className={styles.section}>
        <p className={styles.welcome}>Welcome, {playerName}!</p>
        <div>
          {Object.keys(rooms).length > 0 ? ( <div>
            <h3 className={styles.subtitle}>Available Rooms:</h3>
            <ul className={styles.roomList}>
              {Object.values(rooms).map((room) => (
                <li className={styles.lobbyCard} key={room.id} onClick={() => handleJoinRoom(room.id)}>
                  <span className={styles.roomId}>{room.id}</span> - Host: <span className={styles.highlight}>{room.host.name}</span> - Players: <span className={styles.highlight}>{Object.keys(room.players).length}</span>
                  {room.started && <span className={styles.highlight}> (in game)</span>}
                </li>
              ))}
            </ul>
          </div>) : (<p className={styles.noRooms}>No available rooms. Create one!</p>)}
        </div>
        <Button onClick={handleCreateRoom} children="Create Room"/>
      </div>)}

      {error && <p className={styles.error}>{error}</p>}
    </div>
  </div>);
}

/**
 * Backend returns an array of rooms; UI stores them keyed by id.
 * @param {unknown} data
 * @returns {Record<string, object>}
 */
function roomsToMap(data) {
  if (Array.isArray(data)) {
    return Object.fromEntries(data.map((room) => [room.id, room]));
  }
  if (data && typeof data === 'object') {
    return data;
  }
  return {};
}

function generateRoomId() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** Set by the server in player:registered. Empty until login succeeds. */
const getPlayerId = () => sessionStorage.getItem('playerId');
/**
 * Available Among Us colors
 */
const PLAYER_COLORS = [
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

function getRandomColor() {
  return PLAYER_COLORS[Math.floor(Math.random() * PLAYER_COLORS.length)];
}

function getAvailableColors() {
  return PLAYER_COLORS;
}

export default Menu;
