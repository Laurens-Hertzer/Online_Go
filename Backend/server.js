//Imports
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
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
//Proxy-Config for Render
app.set("trust proxy", 1);

//DB
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
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

//Authentication, Authorization
const sessionMiddleware = session({
    store: new pgSession({
        pool: pool,
        tableName: 'session',
        createTableIfMissing: true
    }),
    secret: process.env.SESSION_SECRET,
    resave: false, // don't save session if unmodified
    saveUninitialized: false, // don't create session until something stored
        cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Auto true in Render
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // Cross-Origin
        maxAge: 24 * 60 * 60 * 1000 // 24h
    },
});

// CORS-Config, allows communication between Frontend 
// and Backend when they are on different origins (e.g. Render) 
// and allows cookies to be sent for authentication. 
app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || "http://localhost:3000", //
    credentials: true
}));

//Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(sessionMiddleware);

function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ error: "Nicht eingeloggt" });
    }
    next();
}

app.post("/register", async(req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(422).json({ error: "You have to put in all the required inputs." })
    }
    
    if (username.length < 3) {
        return res.status(422).json({ error: "Username has to be bigger then 3 letters." });
    }
    if (password.length < 8) {
        return res.status(422).json({ error: "Passwort too short, not so difficult to remember a bigger one, I trust u ;)." });
    }

    try {
        const existingUser = await pool.query('SELECT id FROM users WHERE username = $1',[username]);
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
            'SELECT id, username, password_hash FROM users WHERE username = $1',
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

        req.session.save((err) => {
            if (err) {
                console.error("[Login] Session save failed:", err);
                return res.status(500).json({ error: "Session error." });
            }
            console.log("[Login] Session saved, userId:", req.session.userId);
            res.json({ message: "success", username: user.username });
        });
        } catch (err) {                          // ← das fehlte
        console.error("[Login] Error:", err);
        res.status(500).json({ error: "Internal server error." });
    }
});

app.get("/verify", (req, res) => {
    if (req.session.userId) {
        return res.send({username: req.session.username});
    } else {
        return res.status(401).json({error: "You have to log in first."});
    }
});

app.delete("/logout", (req, res) => {
    if (!req.session.userId) {
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
    if (!req.session.userId){
        res.sendFile(path.join(__dirname, '../Frontend', 'index.html'));
    }else{
        res.sendFile(path.join(__dirname, '../Frontend', 'lobby.html'));
    }
});

app.get("/lobby.html", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "../Frontend", "lobby.html"));
});

app.get("/game.html", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "../Frontend", "game.html"));
});

// All static files (CSS, JS, Pictures)
app.use(express.static(path.join(__dirname, '../Frontend')));

// Catch-All for SPA (anti404 when reloading) 
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../Frontend/index.html")); 
});

const server = app.listen(process.env.PORT || 3000, () => {
    console.log("[Server] Running on port", process.env.PORT || 3000);
});

server.on("upgrade", (req, socket, head) => {
    // Run the session middleware manually on the upgrade request
    // so we can read req.session
    sessionMiddleware(req, {}, () => {
        if (!req.session.userId) {
            console.log("[WS] Rejected unauthenticated connection attempt");
            socket.destroy(); // close the TCP connection, no WebSocket
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            // Attach user info directly to the ws object
            // Now we always know who this WebSocket belongs to
            ws.userId = req.session.userId;
            ws.username = req.session.username;
            wss.emit("connection", ws, req);
        });
    });
});

const wss = new WebSocket.Server({ noServer: true });

// Matchmaking
const games = new Map(); //Map instead of Array for better id handling.
let gameIdCounter = 0;

class Game {
    constructor(creatorWs) {
        this.id = `game_${gameIdCounter++}`;

        this.player1 = creatorWs;
        this.player1Id = creatorWs.userId;

        this.player2 = null;
        this.player2Id = null;

        this.player1Disconnected = false;
        this.player2Disconnected = false;
        this.deleteTimeout = null;

        this.board = Array.from({ length: 19},  () => Array(19).fill(null));
        this.current = "black"; //in go black starts btw
    }

    getColor(ws) {
        if (ws.userId === this.player1Id) return "black";
        if (ws.userId === this.player2Id) return "white";
        return null;
    }

    playMove(x, y, ws) {
    if (x < 0 || x > 18 || y < 0 || y > 18) {
        return { ok: false, reason: "Ungültige Koordinaten" };
    }

    const color = this.getColor(ws);
    if (color !== this.current) {
        return { ok: false, reason: "Not your turn." };
    }

    if (this.board[y][x] !== null) {
        return { ok: false, reason: "Feld besetzt" };
    }

    // Stein setzen
    this.board[y][x] = color;

    // Gegnerische Gruppen ohne Freiheiten entfernen
    const opponent = color === "black" ? "white" : "black";
    const neighbors = [[x-1,y],[x+1,y],[x,y-1],[x,y+1]];

    const captured = [];
    for (const [nx, ny] of neighbors) {
    if (nx < 0 || ny < 0 || nx >= 19 || ny >= 19) continue;
    if (this.board[ny][nx] === opponent && canTakeStone(nx, ny, opponent, this.board)) {
        removeGroup(nx, ny, opponent, this.board, captured); 
    }
}

    this.current = this.current === "black" ? "white" : "black";
    return { ok: true, color, captured };
}
}

wss.on("connection", (ws) => {
    console.log("[WS] User connected:", ws.username);
    sendGamesList(ws);

    ws.on("message", (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
        } catch {
            console.warn("[WS] Invalid JSON from:", ws.username);
            return;
        }

        if (data.action === "create") {
            // One game per user at a time
            if (ws.currentGame) {
                ws.send(JSON.stringify({ type: "error", message: "You are already in a game." }));
                return;
            }

            const game = new Game(ws);
            games.set(game.id, game);
            ws.currentGame = game;

            console.log("[Game] Created:", game.id, "by", ws.username);
            broadcastGamesList();
        }

        if (data.action === "join") {
            const game = games.get(data.gameId); // lookup by ID, not index

            if (!game) {
                ws.send(JSON.stringify({ type: "error", message: "Game not found." }));
                return;
            }
            if (game.player2) {
                ws.send(JSON.stringify({ type: "error", message: "Game is full." }));
                return;
            }
            if (game.player1Id === ws.userId) {
                ws.send(JSON.stringify({ type: "error", message: "You cannot join your own game." }));
                return;
            }

            game.player2 = ws;
            game.player2Id = ws.userId;
            ws.currentGame = game;

            game.player1.send(JSON.stringify({ type: "start", color: "black", gameId: game.id }));
            game.player2.send(JSON.stringify({ type: "start", color: "white", gameId: game.id }));

            console.log("[Game] Started:", game.id);
            broadcastGamesList();
        }


        if (data.type === "move") {
            if (!ws.currentGame) return;

            const game = ws.currentGame;
            if (!game.player2) return; // game hasn't started yet

            const result = game.playMove(data.x, data.y, ws);

            if (!result.ok) {
                ws.send(JSON.stringify({ type: "error", message: result.reason }));
                return;
            }

            const moveData = JSON.stringify({
                type: "update",
                x: data.x,
                y: data.y,
                color: result.color,
                captured: result.captured,
            });

            if (game.player1?.readyState === WebSocket.OPEN) game.player1.send(moveData);
            if (game.player2?.readyState === WebSocket.OPEN) game.player2.send(moveData);
        }

        if (data.type === "rejoin") {
            const game = games.get(data.gameId);

            if (!game) {
                ws.send(JSON.stringify({ type: "error", message: "Game no longer available." }));
                return;
            }

            // Check this user actually belongs to this game
            const color = game.getColor(ws); // uses ws.userId
            if (!color) {
                console.warn("[WS] Unauthorized rejoin attempt by", ws.username, "for game", data.gameId);
                ws.send(JSON.stringify({ type: "error", message: "You are not part of this game." }));
                return;
            }

            // Cancel the delete timeout if it was set
            if (game.deleteTimeout) {
                clearTimeout(game.deleteTimeout);
                game.deleteTimeout = null;
            }

            if (color === "black") {
                game.player1 = ws;
                game.player1Disconnected = false;
            } else {
                game.player2 = ws;
                game.player2Disconnected = false;
            }

            ws.currentGame = game;
            console.log("[Game] Rejoined:", game.id, "as", color, "by", ws.username);
            ws.send(JSON.stringify({ type: "rejoin_success", color }));
        }
    });

    ws.on("close", () => {
        console.log("[WS] User disconnected:", ws.username);

        games.forEach((game, id) => {
            if (game.player1 === ws) {
                game.player1Disconnected = true;
                game.player1 = null;
            }
            if (game.player2 === ws) {
                game.player2Disconnected = true;
                game.player2 = null;
            }

            // Only delete the game if BOTH players are gone,
            // and give them 30 seconds to rejoin first
            if (game.player1Disconnected && game.player2Disconnected) {
                game.deleteTimeout = setTimeout(() => {
                    games.delete(id);
                    console.log("[Game] Deleted after timeout:", id);
                    broadcastGamesList();
                }, 30000); // 30 seconds waiting period
            }
        });

        broadcastGamesList();
    });
});

//Functions

function getGamesListPayload() {
    const list = [];
    games.forEach((game, id) => {
        list.push({
            gameId: id, // send ID not index, frontend uses this for join
            player1: game.player1Id ? game.player1?.username || "Reconnecting..." : null,
            player2: game.player2Id ? game.player2?.username || "Reconnecting..." : null,
        });
    });
    return list;
}

function sendGamesList(ws) {
    ws.send(JSON.stringify({ games: getGamesListPayload() }));
}

function broadcastGamesList() {
    const message = JSON.stringify({ games: getGamesListPayload() });
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
    console.log("[WS] Games list broadcast:", games.size, "games");
}

function canTakeStone(x, y, color, board) {
    const visited = new Set();

    function hasLiberty(cx, cy) {
        const key = `${cx},${cy}`;
        if (visited.has(key)) return false;
        visited.add(key);

        const neighbors = [
            [cx - 1, cy],
            [cx + 1, cy],
            [cx, cy - 1],
            [cx, cy + 1],
        ];

        for (const [nx, ny] of neighbors) {
            if (nx < 0 || ny < 0 || nx >= 19 || ny >= 19) continue;
            if (board[ny][nx] === null) return true;
            if (board[ny][nx] === color) {
                if (hasLiberty(nx, ny)) return true;
            }
        }
        return false;
    }

    return !hasLiberty(x, y);
}

function removeGroup(x, y, color, board, captured = []) {
    if (x < 0 || y < 0 || x >= 19 || y >= 19) return;
    if (board[y][x] !== color) return;

    board[y][x] = null;
    captured.push([x, y]);

    removeGroup(x - 1, y, color, board, captured);
    removeGroup(x + 1, y, color, board, captured);
    removeGroup(x, y - 1, color, board, captured);
    removeGroup(x, y + 1, color, board, captured);
}