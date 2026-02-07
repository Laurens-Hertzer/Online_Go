//Imports
const express = require("express");
const session = require("express-session");
const cors = require("cors");
const path = require("path");
const WebSocket = require("ws")

/*const swaggerUi = require("swagger-ui-express");
const swaggerDocument = require("./swagger-output.json");*/
/*app.use(
  "/swagger-ui",
  swaggerUi.serve,
  swaggerUi.setup(swaggerDocument)
);*/

//Definitions

const app = express();

//Middleware
app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//Routing
//app.use("/gamecontrol" , gamecontrol);

//Correct ID placement, needed later for correct saving of games, users, etc.
//const nextId = () => Math.max(...tasks.map((task) => task.id)) + 1;

//Authentication, Authorization
app.use(session({
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: false,
    cookie: {
httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Automatisch true auf Render
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Wichtig für Cross-Origin
        maxAge: 24 * 60 * 60 * 1000 // 24 Stunden
    }
}));

const users = [
    { username: "test" , password: "1" },
    { username: "test2", password: "2" },
    { username: "test3", password: "3" }
]

app.post("/register", (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(422).json({ error: "You have to put in all the required inputs." })
    }
    if (!req.session.createdAccounts) {
        req.session.createdAccounts = 0;
    } 
    if (req.session.createdAccounts >= 5) {
        return res.status(429).json({ error: "Maximale Anzahl an Accounts erreicht, du brauchst nicht so viele." });
    }
    users.push({... {username, password} });
    req.session.createdAccounts++;
    res.json({ message: "Account erstellt" });
});

app.post("/login", (req, res) => {
    // #swagger.tags = ['Auth']
    const { username, password } = req.body;

    const foundUser = users.find(user => user.username === username && user.password === password);
    if (!foundUser) {
        return res.status(401).json({ error: "Wrong credentials or no such user" });
    }

    req.session.username = req.body.username;
    res.json({ message: "sucess" });
});

app.get("/verify", (req, res) => {
    if (req.session.username) {
        return res.send(req.session.username);
    } else {
        return res.status(401).json({error: "You have to log in first."});
    }
});

app.delete("/logout", (req, res) => {
    if (!req.session.username) {
        return res.sendStatus(422);
    }
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: "Logout failed (how'd'ya manage that lol)" });
        }
        res.json({ message: "Succesful logout" });
    });
});

app.get('/', (req, res) => {
    if (!req.session.username){
        res.sendFile(path.join(__dirname, '../Frontend', 'login.html'));
    }else{
        res.sendFile(path.join(__dirname, '../Frontend', 'index.html'));
    }
});

// All static files (CSS, JS, Pictures)
app.use(express.static(path.join(__dirname, '../Frontend')));

// Catch-All für SPA (anti404 when reloading)
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../Frontend/index.html")); 
});

const server = app.listen(process.env.PORT || 3000, () => {
     console.log("up n running"); 
});

const wss = new WebSocket.Server({ server });

// Matchmaking
const waiting = [];

class Game {
    constructor() {
        this.board = Array.from({ length: 19},  () => Array(19).fill(null));
        this.current = "black";
    }

    playMove(x, y) {
        if (this.board[y][x] !== null) {
            return { ok: false, reason: "Feld besetztz"};
        }

        const color = this.current;
        this.board[y][x] = color;
        this.current = this.current === "black" ? "white" : "black";
        return { ok: true, color };
    }
}

// WebSocket Handling

wss.on("connection", (ws) => {
    if (waiting.length === 0) {
        waiting.push(ws);
        ws.send(JSON.stringify({ type: "waiting" }));
    }else{
        const opponent = waiting.shift();
        const game = new Game();

        ws.game = game;
        opponent.game = game;

        game.players = [ws, opponent];

        ws.send(JSON.stringify({ type: "start", color: "black" }));
        opponent.send(JSON.stringify({ type: "start", color: "white" }));
    }
ws.on("message", (msg) => { 
    const data = JSON.parse(msg); 
    if (data.type === "move") {
         const result = ws.game.playMove(data.x, data.y); 
         if (!result.ok) return; 
         
         ws.game.players.forEach(p => 
            p.send(JSON.stringify({ 
                type: "update", 
                x: data.x, 
                y: data.y, 
                color: result.color 
            })) 
        ); 
    } 
}); 
ws.on("close", () => {
        // Delete from waiting list
        const idx = waiting.indexOf(ws);
        if (idx !== -1) {
            waiting.splice(idx, 1);
        }
    });
});
