# Among Us
A multiplayer web based clone of game among us built with Phaser 3, React, and Node.js.

**Live Demo:** [https://among-us-mocha.vercel.app](https://among-us-mocha.vercel.app)

## Project Structure
```
among-us/
├── frontend/                 # React + Phaser 3 frontend application
│   ├── src/                  # React components and game code
│   │   ├── game/             # Phaser 3 game logic
│   │   ├── components/       # React components
│   │   ├── assets/           # Game assets
│   │   └── main.tsx          # Frontend entry point
│   ├── vite/                 # Vite configuration files
│   ├── package.json          # Frontend dependencies
│   ├── tailwind.config.cjs   # Tailwind CSS configuration
│   ├── postcss.config.cjs    # PostCSS configuration
│   ├── .eslintrc.cjs         # ESLint configuration
│   └── index.html            # HTML entry point
├── backend/                  # Node.js + Express backend server
│   ├── src/                  # Backend source code
│   ├── package.json          # Backend dependencies
│   └── tsconfig.json         # TypeScript configuration
└── misc/                     # Miscellaneous files
```
## Important Files
### Frontend
```
/frontend/src/pages/Menu.jsx
Manages the initial player registeration and room select events.
```
```
/frontend/src/App.jsx
Manages the Game UI components visibility.
```
```
frontend/src/game/Game.js
Main phaser file, manages the whole game logic and connection with backend
```
### Backend
```
/backend/src/events/
Contains files to manage the entire socket.io events
```
```
backend/src/managers
Contains files to manage the game state, like player updates and game room updates
```

## Technology Stack
### Frontend
- **React** 19.0.0 - UI library
- **Phaser** 3.90.0 - Game framework
- **Vite** 6.3.1 - Build tool
- **Tailwind CSS** 4.1.18 - Styling
- **Socket.io Client** 4.8.3 - Real-time communication

### Backend
- **Node.js** - JavaScript runtime
- **Express** 5.2.1 - Web framework
- **Socket.io** 4.8.3 - Real-time communication

## Features
- Real-time multiplayer gameplay
- Multiplayer room management
- Socket.io for live player communication
- React for UI components like meeting screens

## Getting Started

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn

### Installation
1. Clone the repository:
```bash
git clone https://github.com/i250882-os/among-us.git
cd among-us
```

2. Install frontend dependencies:
```bash
cd frontend
npm install
cd ..
```

3. Install backend dependencies:
```bash
cd backend
npm install
cd ..
```

## Development
### Frontend Development

```bash
cd frontend
npm run dev
```

This starts the Vite development server with hot module replacement.

### Backend Development

```bash
cd backend
npm run dev
```

This starts the Express and Socket server

### Production Build

#### Frontend:
```bash
cd frontend
npm run build
```

#### Backend:
```bash
cd backend
npm start
```
## Configuration

The backend serves **both** the REST API and Socket.IO on a **single port** (default `3000`).

### Local development (recommended)

Leave `VITE_BACKEND_URL` / `VITE_SOCKET_URL` **unset**. The browser talks to the Vite origin (`http://localhost:8080`), and Vite proxies API + Socket.IO to the backend — no CORS setup needed.

`frontend/.env`:
```
VITE_PROXY_TARGET=http://localhost:3000
```

`backend/.env`:
```
PORT=3000
ALLOWED_ORIGIN=http://localhost:8080
```

### Production / direct backend

Set absolute URLs at **frontend build time** (API and sockets share one origin):
```
VITE_BACKEND_URL=https://your-backend.example.com
# optional override if sockets were ever on a different host:
# VITE_SOCKET_URL=https://your-backend.example.com
```

Backend allowed origins (full URLs, comma-separated):
```
ALLOWED_ORIGIN=https://your-frontend.example.com,http://localhost:8080
```

### TODO
- [ ] Improve lobby area UX
- [ ] Add tasks system
- [ ] Fix voting system bugs

## License
This project is licensed under the MIT License - see the LICENSE file for details.
