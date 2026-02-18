const game_list = document.getElementById("game-list");
const create_game_btn = document.getElementById("create-game-btn");

let socket;
let games = [];

window.addEventListener('DOMContentLoaded', () => {
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
        console.log('Received:', data);
        
        if (data.games) {
            games = data.games;
            renderGameList();
        }
        
        if (data.type === 'start') {
            console.log('You start as', data.color);
            window.location.href = 'game.html';
        }
        
        // Warte auf Gegner
        if (data.type === 'waiting') {
            console.log('Nobody there at the moment to play with you, please hold on...');
        }
    };
    
    socket.onerror = (error) => {
        console.error('WebSocket Error 😩:', error);
    };
    
    socket.onclose = () => {
        console.log('WebSocket closed');
    };
}

function renderGameList() {
    if (games.length === 0) {
        game_list.innerHTML = '<li>Keine Spiele vorhanden. Erstelle eins!</li>';
        return;
    }
    
    game_list.innerHTML = games.map((game, index) => `
        <li>
            <span>Spiel ${index + 1}: ${game.player1 || 'Wartet...'} ${game.player2 ? 'vs ' + game.player2 : ''}</span>
            ${!game.player2 ? `<button onclick="joinGame(${index})">Beitreten</button>` : '<span>Voll</span>'}
        </li>
    `).join('');
}

// Neues Spiel erstellen
create_game_btn.addEventListener('click', () => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: 'create' }));
        console.log('Creating a new game');
    } else {
        console.error('WebSocket not connected');
    }
});

function joinGame(index) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ action: 'join', gameIndex: index }));
        console.log('Joining you into a game, hold on:', index);
    }
}
