const svg = document.getElementById("goboard");
const gameId =sessionStorage.getItem("gameId");
const myColor = sessionStorage.getItem("myColor");
const timers = sessionStorage.getItem("timers");
const boardSize = parseInt(sessionStorage.getItem("boardSize")) || 19;

// SVG viewBox anpassen:
svg.setAttribute("viewBox", `-1 -1 ${boardSize + 1} ${boardSize + 1}`);

// Linien dynamisch:
for (let i = 0; i < boardSize; i++) {
    // x1/y1/x2/y2 mit boardSize - 1 als Maximum
    h.setAttribute("x2", boardSize - 1);
    v.setAttribute("y2", boardSize - 1);
}

// Klick-Koordinaten Grenzcheck:
if (x < 0 || x >= boardSize || y < 0 || y >= boardSize) return;

let currentTurn = "black";
let gameReady = false;
let localTimers = { black: 0, white: 0 };
let countdownInterval = null;
let localTerritory = { blackTerritory: 0, whiteTerritory: 0 };

// Linien erzeugen
for (let i = 0; i < 19; i++) {
  const h = document.createElementNS("http://www.w3.org/2000/svg", "line");
  h.setAttribute("x1", 0);
  h.setAttribute("y1", i);
  h.setAttribute("x2", 18);
  h.setAttribute("y2", i);
  svg.appendChild(h);

  const v = document.createElementNS("http://www.w3.org/2000/svg", "line");
  v.setAttribute("x1", i);
  v.setAttribute("y1", 0);
  v.setAttribute("x2", i);
  v.setAttribute("y2", 18);
  svg.appendChild(v);
}

const protocol = location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${protocol}//${location.host}`);

socket.onopen = () => {
if (!gameId || !myColor) {
        // Should not happen if the user arrived here via lobby.html normally.
        // Could happen if someone navigates to game.html directly.
        console.error("[Game] No gameId or color in sessionStorage");
        alert("No game found. Returning to lobby.");
        window.location.href = "lobby.html";
        return;
    }

    // Tell the server we are reconnecting to this game.
    // The server will verify via ws.userId that we actually belong to it.
    // We send myColor as a hint but the server does NOT trust it for auth —
    // it uses userId to determine the real color.
    socket.send(JSON.stringify({ type: "rejoin", gameId, color: myColor }));
    console.log("[Game] Rejoining:", gameId, "as", myColor);
};

socket.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    // Server confirmed we are in the game — allow moves now
    if (data.type === "rejoin_success") {
        gameReady = true;
        if (data.timers) localTimers = data.timers;
        console.log("[Game] Ready");
        startLocalCountdown();
        updateStatus();
    }

    if (data.type === "update") {
        placeStone(data.x, data.y, data.color, data.captured);
        if (data.timers) localTimers = data.timers;
        if (data.territory) localTerritory = data.territory; // ← neu
        currentTurn = currentTurn === "black" ? "white" : "black";
        updateStatus();
    }

    if (data.type === "timeout") {
    gameReady = false;
    clearInterval(countdownInterval);
    alert(`Time's up! ${data.winner} wins!`);
    window.location.href = "lobby.html";
    }
    if (data.type === "error") {
        console.error("[Server error]", data.message);
    }
    if (data.type === "opponent_left") {
    console.log("[Game] Opponent disconnected");
    // Nur informieren, nicht sofort weiterleiten
    document.getElementById("status").textContent = "Opponent disconnected. Waiting 30s...";
}

if (data.type === "opponent_returned") {
    document.getElementById("status").textContent = currentTurn === myColor ? "Your turn" : "Opponent's turn";
}

if (data.type === "win_by_disconnect") {
    gameReady = false;
    clearInterval(countdownInterval);
    alert("You win! Your opponent didn't reconnect.");
    window.location.href = "lobby.html";
}
};

socket.onerror = () => {
    console.error("[WS] Connection error");
};

socket.onclose = () => {
    console.log("[WS] Connection closed");
    gameReady = false;
};

svg.addEventListener("click", (e) => {
    if (!gameReady) {
        console.log("[Game] Not ready yet");
        return;
    }

    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;

    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    const x = Math.round(svgP.x);
    const y = Math.round(svgP.y);

    // Basic client-side bounds check — server validates again anyway
    if (x < 0 || x > 18 || y < 0 || y > 18) return;

    socket.send(JSON.stringify({ type: "move", x, y }));
});

//functions
function placeStone(x, y, color, captured) {
    if (captured && captured.length > 0) {
        captured.forEach(([cx, cy]) => {          // ← Array destructuring, not Objekt
            const id = `stone-${cx}-${cy}`;
            const stoneEl = document.getElementById(id);
            if (stoneEl) stoneEl.remove();
        });
    }

    const id = `stone-${x}-${y}`;                
    const stone = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    stone.setAttribute("id", id);
    stone.setAttribute("cx", x);
    stone.setAttribute("cy", y);
    stone.setAttribute("r", 0.45);
    stone.setAttribute("fill", color);
    svg.appendChild(stone);
}
function startLocalCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        if (currentTurn === "black") {
            localTimers.black = Math.max(0, localTimers.black - 1000);
        } else {
            localTimers.white = Math.max(0, localTimers.white - 1000);
        }
        updateStatus();
    }, 1000);
}
function updateStatus() {
    const statusEl = document.getElementById("status");
    const timeEl = document.getElementById("time");
    const timeOpponentEl = document.getElementById("time-opponent");
    const territoryEl = document.getElementById("territory");
    const territoryOpponentEl = document.getElementById("territory-opponent");

    if (!statusEl) return;

    if (!gameReady) { statusEl.textContent = "Connecting..."; return; }

    statusEl.textContent = currentTurn === myColor ? "Your turn" : "Opponent's turn";

    const opponentColor = myColor === "black" ? "white" : "black";

    if (timeEl) {
        const myTime = myColor === "black" ? localTimers.black : localTimers.white;
        timeEl.textContent = `You: ${formatTime(myTime)}`;
    }
    if (timeOpponentEl) {
        const oppTime = opponentColor === "black" ? localTimers.black : localTimers.white;
        timeOpponentEl.textContent = `Opponent: ${formatTime(oppTime)}`;
    }
    if (territoryEl) {
        const myTerritory = myColor === "black" ? localTerritory.blackTerritory : localTerritory.whiteTerritory;
        territoryEl.textContent = `Your territory: ${myTerritory}`;
    }
    if (territoryOpponentEl) {
        const oppTerritory = myColor === "black" ? localTerritory.whiteTerritory : localTerritory.blackTerritory;
        territoryOpponentEl.textContent = `Opponent's territory: ${oppTerritory}`;
    }
}

function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function removeGroup(x, y, color, board) {
    if (x < 0 || y < 0 || x >= 19 || y >= 19) return;
    if (board[y][x] !== color) return;

    board[y][x] = null;

    removeGroup(x - 1, y, color, board);
    removeGroup(x + 1, y, color, board);
    removeGroup(x, y - 1, color, board);
    removeGroup(x, y + 1, color, board);
}