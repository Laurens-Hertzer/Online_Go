const svg = document.getElementById("goboard");

const gameId =sessionStorage.getItem("gameId");
const myColor = sessionStorage.getItem("myColor");

let gameReady = false;

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
        console.log("[Game] Ready");
        updateStatus();
    }

    // A move was played (by either player) — draw the stone
    if (data.type === "update") {
        placeStone(data.x, data.y, data.color);
        currentTurn = currentTurn === "black" ? "white" : "black"; // flip turn
        updateStatus(); // refresh whose turn it is
    }

    if (data.type === "error") {
        console.error("[Server error]", data.message);
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
        captured.forEach(({ x, y }) => {
            const id = `stone-${x}-${y}`;
            const stoneEl = document.getElementById(id);
            if (stoneEl) {
                svg.removeChild(stoneEl);
            }
        });
    }
    const stone = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    stone.setAttribute("id", id);
    stone.setAttribute("cx", x);
    stone.setAttribute("cy", y);
    stone.setAttribute("r", 0.45);
    stone.setAttribute("fill", color);
    svg.appendChild(stone);
}




// Tracks whose turn it is locally so we can show it in the UI.
// The server is the real authority — this is display only.
let currentTurn = "black"; // black always starts in Go

function updateStatus() {
    const statusEl = document.getElementById("status");
    if (!statusEl) return; // only runs if you have a status element in your HTML

    if (!gameReady) {
        statusEl.textContent = "Connecting...";
        return;
    }

    if (currentTurn === myColor) {
        statusEl.textContent = "Your turn";
    } else {
        statusEl.textContent = "Opponent's turn";
    }
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