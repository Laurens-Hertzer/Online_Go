//Imports
const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const cors = require("cors");
const path = require("path");
const WebSocket = require("ws");
const bcrypt = require("bcrypt");

//Definitions
const app = express();

//DB
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        const result = await pool.query('SELECT COUNT(*) FROM users');
        if (result.rows[0].count === '0') {
            const testUsers = [
                { username: "test" , password: "1" },
                { username: "test2", password: "2" },
                { username: "test3", password: "3" }
            ];
            
            for (const user of testUsers) {
                const hash = await bcrypt.hash(user.password, 10);
                await pool.query(
                    'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
                    [user.username, hash]
                );
            }
            console.log('Test-User erstellt');
        }
        
        console.log('Datenbank initialisiert');
    } catch (err) {
        console.error('Fehler beim Initialisieren der Datenbank:', err);
    }
}

initDatabase();

// CORS-Config
app.use(cors({
    origin: true,
    credentials: true
}));

//Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

//Authentication, Authorization
app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET || "supersecret",
    resave: false,
    saveUninitialized: false,
        cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Auto true in Render
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Cross-Origin
        maxAge: 24 * 60 * 60 * 1000 // 24h
    }
}));

app.post("/register", async(req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(422).json({ error: "You have to put in all the required inputs." })
    }
    
    if (username.length < 3) {
        return res.status(422).json({ error: "Username has to be bigger then 3 letters." });
    }
    if (password.length < 1) {
        return res.status(422).json({ error: "Passwort too short, not so difficult to remember a bigger one, I trust u ;)." });
    }

    try {
        const existingUser = await pool.query(
            'SELECT id FROM users WHERE username = $1',
            [username]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: "Username bereits vergeben" });
        }

        const passwordHash = await bcrypt.hash(password, 10);

        await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
            [username, passwordHash]
        );

        res.json({ message: "Account erfolgreich erstellt" });
    } catch (err) {
        console.error('Registrierungsfehler:', err);
        res.status(500).json({ error: "Serverfehler bei Registrierung" });
    }
});

app.post("/login", async(req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(422).json({ error: "I need your credentials twin." })
    }

    try {
        const result = await pool.query(
            'SELECT id, username,password_hash FROM users WHERE username = $1',
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Wrong username or password" });
        }

        const user = result.rows[0];

        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Wrong username or password" });
        }

        req.session.userId = user.id;
        req.session.username = user.username;

        res.json({ message: "success", username: user.username });
    } catch (err) {
        console.error('Login-Fehler:', err);
        res.status(500).json({ error: "Serverfehler beim Login" });
    }

});

app.get("/verify", (req, res) => {
    if (req.session.username) {
        return res.send({username: req.session.username});
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
        res.sendFile(path.join(__dirname, '../Frontend', 'lobby.html'));
    }
});

// All static files (CSS, JS, Pictures)
app.use(express.static(path.join(__dirname, '../Frontend')));

// Catch-All for SPA (anti404 when reloading)
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../Frontend/login.html")); 
});

const server = app.listen(process.env.PORT || 3000, () => {
     console.log("up n running"); 
});

const wss = new WebSocket.Server({ server });

// Matchmaking
const games = [];
const waiting = [];

class Game {
    constructor(ws) {
        this.player1 = ws;
        this.player2 = null;
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
    sendGamesList(ws);

    ws.on("message", (msg) => { 
        try {
            const data = JSON.parse(msg);
            if (data.action === "create") {
                const game = new Game(ws);
                games.push(game);
                ws.currentGame = game;

                broadcastGameList();
            }

           if (data.action === "join") {
                const game = games[data.gameIndex];

                if (game && !game.player2) {
                    game.player2 = ws;
                    ws.currentGame = game;
                    
                    game.player1.send(JSON.stringify({ type: "start", color: "black" }));
                    game.player2.send(JSON.stringify({ type: "start", color: "white" }));

                    broadcastGamesList();
            }
        }

            if (data.type === "move") {
                const game = ws.currentGame;
                const result = game.playMove(data.x, data.y);

                if (!result.ok) return;

                const moveData = JSON.stringify({
                    type: "update",
                    x: data.x,
                    y: data.y,
                    color: result.color
                });

                game.player1.send(moveData);
                if (game.player2) game.player2.send(moveData);
            }

    } catch (err) {
        console.error("Fehler beim Verarbeiten der Nachricht:", err);
    }
}); 

ws.on("close", () => {
        
        for (let i = games.length - 1; i >= 0; i--) {
            if (games[i].player1 === ws || games[i].player2 === ws) {
                console.log("Deleting Game", i);
                games.splice(i, 1);
            }
        }
        
        broadcastGamesList();
    });
});

function sendGamesList(ws) {
    const gamesList = games.map(g => ({
        player1: g.player1 ? 'Spieler' : null,
        player2: g.player2 ? 'Spieler' : null
    }));
    
    ws.send(JSON.stringify({ games: gamesList }));
}

// Sende Spieleliste an ALLE Clients
function broadcastGamesList() {
    const gamesList = games.map(g => ({
        player1: g.player1 ? 'Spieler' : null,
        player2: g.player2 ? 'Spieler' : null
    }));
    
    const message = JSON.stringify({ games: gamesList });
    
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
    
    console.log("📤 Spieleliste gesendet:", gamesList.length, "Spiele");
}