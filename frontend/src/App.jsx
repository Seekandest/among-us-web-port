import {useState, useEffect, useRef} from 'react';
import {PhaserGame} from './PhaserGame';
import net from './services/net.js';
import Menu from './pages/Menu.jsx';
import styles from './App.module.css';
import Button from "./components/Button.jsx";
import Meeting from "./components/Meeting.jsx";
import EndGame from "./components/EndGame.jsx";
import NetHud from "./components/NetHud.jsx";
import {EventBus} from './game/EventBus';
import RoleIndicator from "./components/RoleIndicator.jsx";
import { ToastContainer } from "./components/Toast.jsx";
const PAGES = {MENU: 'lobby', WAITING: 'waiting', GAME: 'game', GAMEEND: 'gameend'};

const toast = (message, type = 'info', duration = 3000) => {
  if (window.showToast) window.showToast(message, type, duration);
};

function App() {
  const [currentPage, setCurrentPage] = useState(PAGES.MENU);
  const [roomId, setRoomId] = useState(null);
  const roomIdRef = useRef(null)
  const [isConnected, setIsConnected] = useState(net.connected);
  const playerIdRef = useRef(null);
  const [error, setError] = useState(null);
  const debug = useRef(import.meta.env.VITE_DEBUG === 'true');
  // Meeting state
  const [meetingActive, setMeetingActive] = useState(false);
  const [meetingData, setMeetingData] = useState(null);
  const [timeRemaining, setTimeRemaining] = useState(30000);
  const [gameResult, setGameResult] = useState(null);
  const [isLocalPlayerImposter, setIsLocalPlayerImposter] = useState(false);
  const [isLocalPlayerHost, setIsLocalPlayerHost] = useState(false);
  const LocalImposterRef = useRef(false); // TODO remove unwanted states with ref
  const [roleIndicator, setRoleIndicator] = useState(false);
  // The connection lives in Electron's main process; we only remember whether it dropped.
  const lostConnectionRef = useRef(false);
  // A game:started that arrived while the waiting-lobby scene was not running yet (e.g. we were
  // still on the end screen when the host started the next game): replayed when the lobby is ready.
  const pendingStartRef = useRef(null);
  const sceneRef = useRef(null);

  useEffect(() => {
    if (!net.available) return;

    const handleConnect = () => {
      setIsConnected(true);
      // The server deleted our player when the connection dropped: start again from a clean page.
      if (lostConnectionRef.current) window.location.reload();
    };
    const handleDisconnect = (reason) => {
      setIsConnected(false);
      lostConnectionRef.current = true;
      toast(`Connection lost (${reason}), reconnecting…`, 'error', 0);
    };

    const startLobbyScene = (data) => {
      EventBus.emit('start-game', data);
    };
    const lobbyIsRunning = () => {
      const scene = sceneRef.current;
      return Boolean(scene && scene.scene && scene.scene.key === 'WaitingLobby' && scene.sys && scene.sys.isActive());
    };

    // Private message: only WE receive our role, as a plain boolean.
    const handleStartGame = (data) => {
      console.log('Game started event received in App:', data, roomIdRef.current);
      if (data.roomId !== roomIdRef.current) return;
      const start = {...data, playerId: playerIdRef.current};
      setGameResult(null);
      setMeetingActive(false);
      setMeetingData(null);
      setCurrentPage(PAGES.GAME);
      if (lobbyIsRunning()) startLobbyScene(start);
      else pendingStartRef.current = start;
      Promise.resolve(data.isImposter).then((val) => {
        LocalImposterRef.current = val;
        setIsLocalPlayerImposter(val);
        setRoleIndicator(true);
      });
    };

    const handleSceneReady = (scene) => {
      sceneRef.current = scene;
      if (scene?.scene?.key === 'WaitingLobby' && pendingStartRef.current) {
        const start = pendingStartRef.current;
        pendingStartRef.current = null;
        startLobbyScene(start);
      }
    };

    // Meeting Event from Phaser
    const handleMeetingStarted = (data) => {
      console.log('Meeting started in App:', data);
      setMeetingData(data);
      setMeetingActive(true);
      setTimeRemaining(data.durationMs ?? 30000); // the server decides the meeting length
    };

    const handleMeetingEnded = (data) => {
      console.log('Meeting ended in App:', data);
      setMeetingActive(false);
      setMeetingData(null);
    };

    const handleGameEnd = (data) => {
      console.log('Game end event received in App:', data);
      setGameResult(data);
      setMeetingActive(false);
      setMeetingData(null);
      setCurrentPage(PAGES.GAMEEND);
    };

    const handleVote = (data) => {
      setMeetingData(prev => {
        if (!prev || !prev.players || !prev.players[data.callerId]) return prev;
        return {...prev, players: {...prev.players, [data.callerId]: {...prev.players[data.callerId], voted: true}}};
      });
    };
    const handleNotif = (data) => toast(data.message, 'info', 3000);
    const handleHost = (data) => setIsLocalPlayerHost(data.hostId === playerIdRef.current);

    net.on('connect', handleConnect);
    net.on('disconnect', handleDisconnect);
    net.on('game:started', handleStartGame);
    net.on('meeting:voted', handleVote);
    net.on('game:notif', handleNotif);
    net.on('room:host', handleHost);

    EventBus.on('current-scene-ready', handleSceneReady);
    EventBus.on('meeting:started', handleMeetingStarted);
    EventBus.on('meeting:ended', handleMeetingEnded);
    EventBus.on('game:ended', handleGameEnd);

    net.ready.then(() => setIsConnected(net.connected));

    return () => {
      net.off('connect', handleConnect);
      net.off('disconnect', handleDisconnect);
      net.off('game:started', handleStartGame);
      net.off('meeting:voted', handleVote);
      net.off('game:notif', handleNotif);
      net.off('room:host', handleHost);
      EventBus.off('current-scene-ready', handleSceneReady);
      EventBus.off('meeting:started', handleMeetingStarted);
      EventBus.off('meeting:ended', handleMeetingEnded);
      EventBus.off('game:ended', handleGameEnd);
    };
  }, []);

  const handleJoinRoom = (data) => {
    const joinedRoomId = data.roomId;
    playerIdRef.current = data.playerId;

    console.log('Joining room with ID:', joinedRoomId);
    setRoomId(joinedRoomId);
    roomIdRef.current = joinedRoomId;
    setCurrentPage(PAGES.WAITING);
    setIsLocalPlayerHost(data.isHost);
  };
  const handleStartGameBtn = () => {
    net.emit('game:start', {});
  }
  const handleBackToMenu = () => {
    // The IPC message reaches the main process before the reload, which then sends it to the server.
    net.emit('room:leave', {});
    setRoomId(null);
    setCurrentPage(PAGES.MENU);
    window.location.reload();
  };
  // After a game the server puts everybody back in the waiting room (scores are kept).
  const handlePlayAgain = () => {
    setGameResult(null);
    setMeetingActive(false);
    setMeetingData(null);
    setIsLocalPlayerImposter(false);
    LocalImposterRef.current = false;
    setRoleIndicator(false);
    setCurrentPage(PAGES.WAITING);
  };

  // Timer countdown for meeting (display only: the server owns the real timer)
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

  const handleVoteCallBack = (data) => {
    net.emit('meeting:vote', {votedForId: data.votedForId});
  }

  if (!net.available) {
    return (
      <div id="app" style={{color: 'white', padding: 40, fontFamily: 'sans-serif', textAlign: 'center'}}>
        <h1>Among Us Arena</h1>
        <p>This page needs the desktop client, which owns the TCP / UDP socket.</p>
        <p>Start the game with <code>npm run tcp</code> or <code>npm run udp</code>.</p>
      </div>
    );
  }

  return (
    <div id="app">
      <ToastContainer />
      <NetHud />
      {error && <p className={styles.error}>{error}</p>}
      {debug.current && <div className={`${styles.statusBadge} ${isConnected ? styles.connected : styles.disconnected}`}>
        {isConnected ? 'Connected' : 'Disconnected'}
      </div>}
      {roleIndicator && <RoleIndicator
        role={{imposter: LocalImposterRef.current}}
        onAnimationEnd={() => {setRoleIndicator(false)}}
      />}

      {currentPage === PAGES.MENU && (
        <Menu onJoinGame={handleJoinRoom}/>
      )}

      {currentPage === PAGES.GAMEEND && (
        <EndGame
          result={gameResult}
          localPlayerId={playerIdRef.current}
          onPlayAgain={handlePlayAgain}
          onBackToMenu={handleBackToMenu}
          isLocalPlayerImposter={isLocalPlayerImposter}
        />
      )}

      {(currentPage === PAGES.GAME || currentPage === PAGES.WAITING) && (
        <div className={styles.gameContainer}>
          <PhaserGame/>
          {
            currentPage === PAGES.WAITING && (
              isLocalPlayerHost
                ? <Button
                  onClick={handleStartGameBtn}
                  children="Start Game"
                  className={styles.startBtn}
                />
                : <Button
                  children="Waiting for Host to Start"
                  className={styles.startBtn}
                />
            )
          }
          <button className={styles.backButton} onClick={handleBackToMenu}>Leave</button>
          <div className={styles.roomTag}>
            Room: {roomId}
          </div>

          {meetingActive && meetingData && (
            <Meeting
              players={meetingData.players}
              currentPlayerId={playerIdRef.current}
              onVote={handleVoteCallBack}
              timeRemaining={timeRemaining}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default App
