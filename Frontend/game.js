const svg = document.getElementById("goboard");
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const socket = new WebSocket(`${protocol}//${location.host}`);

const gameId =sessionStorage.getItem("gameId");
const myColor = sessionStorage.getItem("myColor");
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

socket.onopen = () => {
  console.log('✅ WebSocket connected');
  
  // WICHTIG: Rejoin zum Spiel
  if (gameId && myColor) {
    console.log('📤 Sending rejoin for game:', gameId);
    socket.send(JSON.stringify({ 
      type: "rejoin", 
      gameId: gameId,
      color: myColor
    }));
  } else {
    console.error(' Keine gameId oder color gespeichert!');
    alert('Fehler: Keine Spiel-Information gefunden. Zurück zur Lobby.');
    window.location.href = 'lobby.html';
  }
};

socket.onmessage = (msg) => {
  const data = JSON.parse(msg.data);

  if (data.type === "update") {
    placeStone(data.x, data.y, data.color);
  }
};

svg.addEventListener("click", (e) => {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;

  const svgP = pt.matrixTransform(svg.getScreenCTM().inverse());
  const x = Math.round(svgP.x);
  const y = Math.round(svgP.y);

  socket.send(JSON.stringify({ type: "move", x, y }));
});

function placeStone(x, y, color) {
  const stone = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  stone.setAttribute("cx", x);
  stone.setAttribute("cy", y);
  stone.setAttribute("r", 0.45);
  stone.setAttribute("fill", color);
  svg.appendChild(stone);
}
