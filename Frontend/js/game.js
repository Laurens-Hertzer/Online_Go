const svg = document.getElementById("goboard");
const gameId = sessionStorage.getItem("gameId");
const myColor = sessionStorage.getItem("myColor");
const timers = sessionStorage.getItem("timers");
const boardSize = parseInt(sessionStorage.getItem("boardSize")) || 19;

let currentTurn = "black";
let gameReady = false;
let localTimers = { black: 0, white: 0 };
let countdownInterval = null;
let localTerritory = { blackTerritory: 0, whiteTerritory: 0 };

for (let i = 0; i < boardSize; i++) {
    const h = document.createElementNS("http://www.w3.org/2000/svg", "line");
    h.setAttribute("x1", 0);
    h.setAttribute("y1", i);
    h.setAttribute("x2", boardSize - 1);
    h.setAttribute("y2", i);
    svg.appendChild(h);

    const v = document.createElementNS("http://www.w3.org/2000/svg", "line");
    v.setAttribute("x1", i);
    v.setAttribute("y1", 0);
    v.setAttribute("x2", i);
    v.setAttribute("y2", boardSize - 1);
    svg.appendChild(v);
}

svg.setAttribute("viewBox", `-1 -1 ${boardSize + 1} ${boardSize + 1}`);

const protocol = location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${protocol}//${location.host}`);

socket.onopen = () => {
    if (!gameId || !myColor) {
        // Should not happen if the user arrived here via lobby.html normally.
        // Could happen if someone navigates to game.html directly.
        console.error("[Game] Keine gameId der Farbe im SessionStorage");
        alert("Kein Spiel gefunden, zurück zur Lobby.");
        window.location.href = "lobby.html";
        return;
    }

    // Tell the server we are reconnecting to this game.
    // The server will verify via ws.userId that we actually belong to it.
    // We send myColor as a hint but the server does NOT trust it for auth —
    // it uses userId to determine the real color.
    socket.send(JSON.stringify({ type: "rejoin", gameId, color: myColor }));
};

socket.onmessage = (msg) => {
    const data = JSON.parse(msg.data);

    if (data.type === "rejoin_success") {
        gameReady = true;
        if (data.timers) localTimers = data.timers;
        currentTurn = data.currentTurn;
        if (data.territory) localTerritory = {
            blackTerritory: data.territory.blackTerritory ?? 0,
            whiteTerritory: data.territory.whiteTerritory ?? 0,
            blackCaptured: data.territory.blackCaptured ?? 0,
            whiteCaptured: data.territory.whiteCaptured ?? 0,
        };

        if (data.board) {
            rebuildBoard(data.board, data.boardSize);
        }

        startLocalCountdown();
        updateStatus();
    }

    if (data.type === "update") {
        placeStone(data.x, data.y, data.color, data.captured);
        if (data.timers) localTimers = data.timers;
        if (data.territory) localTerritory = {
            ...data.territory,
            blackCaptured: data.blackCaptured ?? 0,
            whiteCaptured: data.whiteCaptured ?? 0,
        };
        currentTurn = currentTurn === "black" ? "white" : "black";
        updateStatus();
    }

    if (data.type === "timeout") {
        gameReady = false;
        clearInterval(countdownInterval);
        clearGameSession();
        alert(`Time's up! ${data.winner} wins!`);
        window.location.href = "lobby.html";
    }
    if (data.type === "error") {
        console.error("[Server error]", data.message);
    }
    if (data.type === "opponent_left") {
        clearInterval(countdownInterval); 
        let seconds = 30;
        document.getElementById("status").textContent = `Gegner getrennt. Noch ${seconds}s...`;
        const disconnectInterval = setInterval(() => {
            seconds--;
            document.getElementById("status").textContent = `Gegner getrennt. Noch ${seconds}s...`;
            if (seconds <= 0) clearInterval(disconnectInterval);
        }, 1000);
    }

    if (data.type === "opponent_returned") {
        document.getElementById("status").textContent = "Gegner hat sich wiederverbunden!";
        startLocalCountdown();
        setTimeout(updateStatus, 3000);
    }
    if (data.type === "passed") {
        if (data.timers) localTimers = data.timers;
        currentTurn = currentTurn === "black" ? "white" : "black";
        updateStatus();
        // Status kurz anzeigen wer gepasst hat
        document.getElementById("status").textContent = `${data.color} hat gepasst`;
        setTimeout(updateStatus, 2000);
    }

    if (data.type === "resigned") {
        gameReady = false;
        clearInterval(countdownInterval);
        clearGameSession();
        const iWon = data.winner === myColor;
        alert(iWon ? "Dein Gegner hat aufgegeben, du gewinntst!" : "Du hast aufgegeben, du verlierst!");
        setTimeout(() => window.location.href = "lobby.html", 100);
    }

    if (data.type === "win_by_disconnect") {
        gameReady = false;
        clearInterval(countdownInterval);
        clearGameSession();
        alert("Du gewinnst, dein Gegner hat sich nicht wiederverbunden.");
        window.location.href = "lobby.html";
    }

    if (data.type === "game_over") {
        gameReady = false;
        clearInterval(countdownInterval);
        clearGameSession();
        const myScore = myColor === "black" ? data.blackScore : data.whiteScore;
        const oppScore = myColor === "black" ? data.whiteScore : data.blackScore;
        const result = data.winner === myColor ? "Du gewinnst!" : data.winner === "draw" ? "Unentschieden!" : "Du hast verloren!";
        alert(`Game over! ${result}\nDeine Punktzahl: ${myScore} | Gegner: ${oppScore}`);
        window.location.href = "lobby.html";
    }
};

socket.onerror = () => {
    console.error("[WS] Verbindungsfehler");
};

socket.onclose = () => {
    console.log("[WS] Verbindung getrennt");
    gameReady = false;
};

svg.addEventListener("click", (e) => {
    if (!gameReady) {
        return;
    }

    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;

    const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
    const x = Math.round(svgP.x);
    const y = Math.round(svgP.y);

    // Basic client-side bounds check — server validates again anyway
    if (x < 0 || x > boardSize - 1 || y < 0 || y > boardSize - 1) return;

    socket.send(JSON.stringify({ type: "move", x, y }));
});

// Nach den anderen Event Listenern
document.getElementById("pass-btn").addEventListener("click", () => {
    if (!gameReady) return;
    socket.send(JSON.stringify({ type: "pass" }));
});

document.getElementById("resign-btn").addEventListener("click", () => {
    if (!gameReady) return;
    if (confirm("Bist du sicher, dass du aufgeben möchtest?")) {
        socket.send(JSON.stringify({ type: "resign" }));
    }
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

    if (!gameReady) { statusEl.textContent = "Verbinde..."; return; }

    statusEl.textContent = currentTurn === myColor ? "Dein Zug" : "Zug des Gegners";

    const opponentColor = myColor === "black" ? "white" : "black";

    if (timeEl) {
        const myTime = myColor === "black" ? localTimers.black : localTimers.white;
        timeEl.textContent = `Du: ${formatTime(myTime)}`;
    }
    if (timeOpponentEl) {
        const oppTime = opponentColor === "black" ? localTimers.black : localTimers.white;
        timeOpponentEl.textContent = `Gegner: ${formatTime(oppTime)}`;
    }
    if (territoryEl) {
        const myTerritory = myColor === "black"
            ? localTerritory.blackTerritory + localTerritory.blackCaptured
            : localTerritory.whiteTerritory + localTerritory.whiteCaptured;
        territoryEl.textContent = `Dein Gebiet: ${myTerritory}`;
    }
    if (territoryOpponentEl) {
        const oppTerritory = myColor === "black"
            ? localTerritory.whiteTerritory + localTerritory.whiteCaptured
            : localTerritory.blackTerritory + localTerritory.blackCaptured;
        territoryOpponentEl.textContent = `Gebiet des Gegners: ${oppTerritory}`;
    }
}

function formatTime(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function rebuildBoard(board, size) {
    // Alle bestehenden Steine entfernen
    svg.querySelectorAll("circle").forEach(el => el.remove());

    // Brett neu zeichnen
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            if (board[y][x] !== null) {
                placeStone(x, y, board[y][x], []);
            }
        }
    }
}
function clearGameSession() {
    sessionStorage.removeItem("gameId");
    sessionStorage.removeItem("myColor");
    sessionStorage.removeItem("boardSize");
}