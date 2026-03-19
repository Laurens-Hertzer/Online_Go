let socket;
let gameList;
let createGameBtn;
let logoutBtn;
let myUsername = null;

fetch("/verify", { credentials: "include" })
    .then(res => res.json())
    .then(data => { myUsername = data.username; });

window.addEventListener('DOMContentLoaded', () => {
    gameList = document.getElementById("game-list");
    createGameBtn = document.getElementById("create-game-btn");
    logoutBtn = document.getElementById("logout-btn");
    const savedGameId = sessionStorage.getItem("gameId");
    const savedColor = sessionStorage.getItem("myColor");

    if (savedGameId && savedColor) {
        const rejoinBanner = document.createElement("div");
        rejoinBanner.innerHTML = `
        <span>Du hast ein laufendes Spiel.</span>
        <button id="rejoin-btn">Weiterspielen</button>
        <button id="abandon-btn">Aufgeben</button>
    `;
        rejoinBanner.id = "rejoin-banner";
        document.body.insertBefore(rejoinBanner, document.body.firstChild);

        document.getElementById("rejoin-btn").addEventListener("click", () => {
            window.location.href = "game.html";
        });

        document.getElementById("abandon-btn").addEventListener("click", () => {
            fetch(`/game/${savedGameId}/resign`, {
                method: "DELETE",
                credentials: "include"
            }).finally(() => {
                sessionStorage.removeItem("gameId");
                sessionStorage.removeItem("myColor");
                sessionStorage.removeItem("boardSize");
                rejoinBanner.remove();
            });
        });
    }

    createGameBtn.addEventListener("click", () => {
        showTimerModal((seconds, boardSize) => {
            socket.send(JSON.stringify({ action: "create", timePerPlayer: seconds, boardSize }));
        });
        createGameBtn.disabled = true;
    });

    document.getElementById("rules-btn").addEventListener("click", () => {
        document.getElementById("rules-modal").style.display = "flex";
    });

    document.getElementById("rules-close").addEventListener("click", () => {
        document.getElementById("rules-modal").style.display = "none";
    });

    logoutBtn.addEventListener("click", () => {
        fetch(`/logout`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            credentials: "include"
        })
            .then(async res => {
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || "Logout fehlgeschlagen");
                }
                return res.json();
            })
            .then(() => {
                window.location.href = "/";
            })
            .catch(err => console.error("Logout error:", err));
    });
    connectWebSocket();
});

function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}`);

    socket.onopen = () => {
        console.log("[WS] Verbindung hergestellt");
    };
    socket.onmessage = (event) => {
        const data = JSON.parse(event.data);

        if (data.games) {
            renderGameList(data.games);
        }

        if (data.type === "start") {
            sessionStorage.setItem("gameId", data.gameId);
            sessionStorage.setItem("myColor", data.color);
            sessionStorage.setItem("boardSize", data.boardSize); // ← neu
            window.location.href = "game.html";
        }

        if (data.type === 'error') {
            console.error('Error from server:', data.message);
            alert('Error: ' + data.message);
        }
    };

    socket.onerror = () => {
        console.error("[WS] Verbindungsfehler");
    };

    socket.onclose = () => {
        console.log("[WS] Verbindung getrennt");
    };
}

function renderGameList(games) {
    if (games.length === 0) {
        gameList.innerHTML = "<li>Keine Spiele, erstelle eins!</li>";
        return;
    }

    gameList.innerHTML = games
        .map(
            (game, index) => `
    <li>
        <span>Spiel ${index + 1}: ${game.player1 || "Warte..."} ${game.player2 ? "vs " + game.player2 : ""}</span>
        ${!game.player2 && game.player1 !== myUsername
                    ? `<button onclick="joinGame('${game.gameId}')">Beitreten</button>`
                    : game.player2 ? "<span>Voll</span>" : "<span>Dein Spiel</span>"
                }
            </li>
        `
        )
        .join("");
}

function joinGame(gameId) {
    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: "join", gameId }));
    }
}

// In lobby.js
function showTimerModal(onConfirm) {
    const modal = document.getElementById("timer-modal");
    modal.style.display = "flex";

    document.getElementById("timer-confirm").onclick = () => {
        const minutes = parseInt(document.getElementById("timer-input").value) || 10;
        const boardSize = parseInt(document.getElementById("board-size-input").value) || 19;
        modal.style.display = "none";
        onConfirm(minutes * 60, boardSize);
    };
}