let socket;
let gameList;
let createGameBtn;
let time;

window.addEventListener('DOMContentLoaded', () => {
    gameList = document.getElementById("game-list");
    createGameBtn = document.getElementById("create-game-btn");

    createGameBtn.addEventListener("click", () => {
    showTimerModal((seconds) => {
        socket.send(JSON.stringify({ action: "create", timePerPlayer: seconds }));
    });
});
    connectWebSocket();
});

function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(`${protocol}//${location.host}`);
    
    socket.onopen = () => {
    console.log('WebSocket connected');
};
socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.games) {
            renderGameList(data.games);
        }
        
        if (data.type === 'start') {
            console.log('You start as', data.color);
            sessionStorage.setItem("gameId", data.gameId); 
            sessionStorage.setItem("myColor", data.color);
            window.location.href = 'game.html';
        }
        
        if (data.type === 'error') {
            console.error('Error from server:', data.message);
            alert('Error: ' + data.message);
        }
    };

    socket.onerror = () => {
        console.error('WebSocket Error 😩');
    };

    socket.onclose = () => {
        console.log('WebSocket closed');
        
    };
}

function renderGameList(games) {
    if (games.length === 0) {
        gameList.innerHTML = "<li>No games yet. Create one!</li>";
        return;
    }

    gameList.innerHTML = games
        .map(
            (game, index) => `
        <li>
            <span>Game ${index + 1}: ${game.player1 || "Waiting..."} ${game.player2 ? "vs " + game.player2 : ""}</span>
            ${
                !game.player2
                    ? `<button onclick="joinGame('${game.gameId}')">Join</button>`
                    : "<span>Full</span>"
            }
        </li>
    `
        )
        .join("");
}

function joinGame(gameId) {
    if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: "join", gameId }));
        console.log("[Game] Joining game:", gameId);
    }
}

// In lobby.js
function showTimerModal(onConfirm) {
    const modal = document.getElementById("timer-modal");
    modal.style.display = "flex";

    document.getElementById("timer-confirm").onclick = () => {
        const minutes = parseInt(document.getElementById("timer-input").value) || 10;
        modal.style.display = "none";
        onConfirm(minutes * 60);
    };
}

// Beim Create-Button statt direktem send:
createGameBtn.addEventListener("click", () => {
    showTimerModal((seconds) => {
        socket.send(JSON.stringify({ action: "create", timePerPlayer: seconds }));
    });
});