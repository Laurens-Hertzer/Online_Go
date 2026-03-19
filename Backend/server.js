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
                { username: "test", password: "1" },
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
            console.log('Testnutzer erstellt');
        }

        console.log('Datenbank initialisiert');
    } catch (err) {
        console.error('Datenbankfehler:', err);
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
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24h
    },
});

app.use(cors({
    origin: process.env.ALLOWED_ORIGIN || "http://localhost:3000",
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

app.post("/register", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(422).json({ error: "Alle Felder müssen ausgefüllt werden." });
    }
    if (username.length < 3) {
        return res.status(422).json({ error: "Username muss mindestens 3 Zeichen lang sein." });
    }
    if (password.length < 8) {
        return res.status(422).json({ error: "Passwort muss mindestens 8 Zeichen lang sein." });
    }

    try {
        const existingUser = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({ error: "Username bereits vergeben." });
        }

        const passwordHash = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
            [username, passwordHash]
        );

        res.json({ message: "Account erfolgreich erstellt." });
    } catch (err) {
        console.error('Registrierungsfehler:', err);
        res.status(500).json({ error: "Serverfehler bei der Registrierung." });
    }
});

app.post("/login", async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(422).json({ error: "Benutzername und Passwort erforderlich." });
    }

    try {
        const result = await pool.query(
            'SELECT id, username, password_hash FROM users WHERE username = $1',
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ error: "Falscher Benutzername oder Passwort." });
        }

        const user = result.rows[0];
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: "Falscher Benutzername oder Passwort." });
        }

        req.session.userId = user.id;
        req.session.username = user.username;

        req.session.save((err) => {
            if (err) {
                console.error("[Login] Session konnte nicht gespeichert werden:", err);
                return res.status(500).json({ error: "Session-Fehler." });
            }
            console.log("[Login] Erfolgreich, userId:", req.session.userId);
            res.json({ message: "success", username: user.username });
        });
    } catch (err) {
        console.error("[Login] Fehler:", err);
        res.status(500).json({ error: "Interner Serverfehler." });
    }
});

app.get("/verify", (req, res) => {
    if (req.session.userId) {
        return res.send({ username: req.session.username });
    } else {
        return res.status(401).json({ error: "Nicht eingeloggt." });
    }
});

app.delete("/logout", (req, res) => {
    if (!req.session.userId) {
        return res.sendStatus(422);
    }
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: "Logout fehlgeschlagen." });
        }
        res.json({ message: "Erfolgreich ausgeloggt." });
    });
});

app.delete("/game/:gameId/resign", requireAuth, async (req, res) => {
    const game = games.get(req.params.gameId);
    if (!game) return res.sendStatus(404);
    
    const color = req.session.userId === game.player1Id ? "black" : 
                  req.session.userId === game.player2Id ? "white" : null;
    if (!color) return res.sendStatus(403);

    game.stopTimer();
    const winner = color === "black" ? "white" : "black";
    const resignData = JSON.stringify({ type: "resigned", loser: color, winner });
    
    if (game.player1?.readyState === WebSocket.OPEN) game.player1.send(resignData);
    if (game.player2?.readyState === WebSocket.OPEN) game.player2.send(resignData);
    
    if (game.player1) game.player1.currentGame = null;
    if (game.player2) game.player2.currentGame = null;
    
    setTimeout(() => {
        games.delete(game.id);
        broadcastGamesList();
    }, 500);
    
    res.sendStatus(200);
});

app.get('/', (req, res) => {
    if (!req.session.userId) {
        res.sendFile(path.join(__dirname, '../Frontend', 'index.html'));
    } else {
        res.sendFile(path.join(__dirname, '../Frontend', 'lobby.html'));
    }
});

app.get("/lobby.html", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "../Frontend", "lobby.html"));
});

app.get("/game.html", requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, "../Frontend", "game.html"));
});

app.use(express.static(path.join(__dirname, '../Frontend')));

app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "../Frontend/index.html"));
});

const server = app.listen(process.env.PORT || 3000, () => {
    console.log("[Server] Läuft auf Port", process.env.PORT || 3000);
});

server.on("upgrade", (req, socket, head) => {
    sessionMiddleware(req, {}, () => {
        if (!req.session.userId) {
            console.log("[WS] Nicht authentifizierte Verbindung abgelehnt");
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            ws.userId = req.session.userId;
            ws.username = req.session.username;
            wss.emit("connection", ws, req);
        });
    });
});

const wss = new WebSocket.Server({ noServer: true });

const games = new Map();
let gameIdCounter = 0;

class Game {
    constructor(creatorWs, timePerPlayer, boardSize) {
        this.id = `game_${gameIdCounter++}`;

        this.player1 = creatorWs;
        this.player1Id = creatorWs.userId;

        this.player2 = null;
        this.player2Id = null;

        this.player1Disconnected = false;
        this.player2Disconnected = false;
        this.deleteTimeout = null;

        const ms = (timePerPlayer || 600) * 1000;
        this.blackTime = ms;
        this.whiteTime = ms;

        this.turnStartedAt = null;
        this.timerInterval = null;

        this.boardSize = boardSize || 19;
        this.board = Array.from({ length: this.boardSize }, () => Array(this.boardSize).fill(null));

        this.blackCaptured = 0;
        this.whiteCaptured = 0;

        this.lastMoveWasPass = false;

        this.current = "black";
    }

    startTimer() {
        this.turnStartedAt = Date.now();
        this.timerInterval = setInterval(() => {
            const elapsed = Date.now() - this.turnStartedAt;
            const remaining = this.current === "black"
                ? this.blackTime - elapsed
                : this.whiteTime - elapsed;
            if (remaining <= 0) {
                this.stopTimer();
                const loser = this.current;
                const winner = loser === "black" ? "white" : "black";
                const msg = JSON.stringify({ type: "timeout", loser, winner });
                if (this.player1?.readyState === WebSocket.OPEN) this.player1.send(msg);
                if (this.player2?.readyState === WebSocket.OPEN) this.player2.send(msg);
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    }

    consumeTime() {
        if (!this.turnStartedAt) return;
        const elapsed = Date.now() - this.turnStartedAt;
        if (this.current === "black") {
            this.blackTime = Math.max(0, this.blackTime - elapsed);
        } else {
            this.whiteTime = Math.max(0, this.whiteTime - elapsed);
        }
        this.turnStartedAt = Date.now();
    }

    getTimers() {
        const elapsed = this.turnStartedAt ? Date.now() - this.turnStartedAt : 0;
        return {
            black: this.current === "black" ? Math.max(0, this.blackTime - elapsed) : this.blackTime,
            white: this.current === "white" ? Math.max(0, this.whiteTime - elapsed) : this.whiteTime,
        };
    }

    getColor(ws) {
        if (ws.userId === this.player1Id) return "black";
        if (ws.userId === this.player2Id) return "white";
        return null;
    }

    playMove(x, y, ws) {
        if (x < 0 || x >= this.boardSize || y < 0 || y >= this.boardSize) {
            return { ok: false, reason: "Ungültige Koordinaten" };
        }

        const color = this.getColor(ws);
        if (color !== this.current) {
            return { ok: false, reason: "Nicht dein Zug." };
        }

        if (this.board[y][x] !== null) {
            return { ok: false, reason: "Feld besetzt." };
        }

        this.board[y][x] = color;

        const opponent = color === "black" ? "white" : "black";
        const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];

        const captured = [];
        for (const [nx, ny] of neighbors) {
            if (nx < 0 || ny < 0 || nx >= this.boardSize || ny >= this.boardSize) continue;
            if (this.board[ny][nx] === opponent && canTakeStone(nx, ny, opponent, this.board, this.boardSize)) {
                removeGroup(nx, ny, opponent, this.board, captured, this.boardSize);
            }
        }

        if (color === "black") {
            this.blackCaptured += captured.length;
        } else {
            this.whiteCaptured += captured.length;
        }

        if (canTakeStone(x, y, color, this.board, this.boardSize)) {
            this.board[y][x] = null;
            return { ok: false, reason: "Selbstmord-Zug nicht erlaubt." };
        }

        this.consumeTime();
        this.current = this.current === "black" ? "white" : "black";
        this.lastMoveWasPass = false;
        return { ok: true, color, captured };
    }
}


wss.on("connection", (ws) => {
    console.log("[WS] Verbunden:", ws.username);
    sendGamesList(ws);

    ws.on("message", (msg) => {
        let data;
        try {
            data = JSON.parse(msg);
        } catch {
            console.warn("[WS] Ungültiges JSON von:", ws.username);
            return;
        }

        if (data.action === "create") {
            if (ws.currentGame) {
                ws.send(JSON.stringify({ type: "error", message: "Du bist bereits in einem Spiel." }));
                return;
            }

            const game = new Game(ws, data.timePerPlayer, data.boardSize);
            games.set(game.id, game);
            ws.currentGame = game;

            console.log("[Spiel] Erstellt:", game.id, "von", ws.username, "| Zeit:", data.timePerPlayer, "s | Brett:", data.boardSize);
            broadcastGamesList();
        }

        if (data.action === "join") {
            const game = games.get(data.gameId);

            if (!game) {
                ws.send(JSON.stringify({ type: "error", message: "Spiel nicht gefunden." }));
                return;
            }
            if (game.player2) {
                ws.send(JSON.stringify({ type: "error", message: "Spiel ist voll." }));
                return;
            }
            if (game.player1Id === ws.userId) {
                ws.send(JSON.stringify({ type: "error", message: "Du kannst nicht deinem eigenen Spiel beitreten." }));
                return;
            }

            game.player2 = ws;
            game.player2Id = ws.userId;
            ws.currentGame = game;

            game.startTimer();
            const timers = game.getTimers();
            game.player1.send(JSON.stringify({ type: "start", color: "black", gameId: game.id, timers, boardSize: game.boardSize }));
            game.player2.send(JSON.stringify({ type: "start", color: "white", gameId: game.id, timers, boardSize: game.boardSize }));

            console.log("[Spiel] Gestartet:", game.id);
            broadcastGamesList();
        }

        if (data.type === "move") {
            if (!ws.currentGame) return;

            const game = ws.currentGame;
            if (!game.player2) return;

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
                timers: game.getTimers(),
                territory: calculateTerritory(game.board, game.boardSize),
                blackCaptured: game.blackCaptured,
                whiteCaptured: game.whiteCaptured
            });

            if (game.player1?.readyState === WebSocket.OPEN) game.player1.send(moveData);
            if (game.player2?.readyState === WebSocket.OPEN) game.player2.send(moveData);
        }

        if (data.type === "rejoin") {
            const game = games.get(data.gameId);

            if (!game) {
                ws.send(JSON.stringify({ type: "error", message: "Spiel nicht mehr verfügbar." }));
                return;
            }

            const color = game.getColor(ws);
            if (!color) {
                console.warn("[WS] Unbefugter Rejoin von", ws.username, "für Spiel", data.gameId);
                ws.send(JSON.stringify({ type: "error", message: "Du bist nicht Teil dieses Spiels." }));
                return;
            }

            if (game.deleteTimeout) {
                clearTimeout(game.deleteTimeout);
                game.deleteTimeout = null;

                const other = color === "black" ? game.player2 : game.player1;
                if (other?.readyState === WebSocket.OPEN) {
                    other.send(JSON.stringify({ type: "opponent_returned" }));
                }
            }

            if (color === "black") {
                game.player1 = ws;
                game.player1Disconnected = false;
            } else {
                game.player2 = ws;
                game.player2Disconnected = false;
            }

            if (!game.player1Disconnected && !game.player2Disconnected && !game.timerInterval) {
                game.startTimer();
            }

            ws.currentGame = game;
            console.log("[Spiel] Rejoined:", game.id, "als", color, "von", ws.username);
            ws.send(JSON.stringify({
                type: "rejoin_success",
                color,
                timers: game.getTimers(),
                currentTurn: game.current,
                board: game.board,
                boardSize: game.boardSize,
                territory: {
                    ...calculateTerritory(game.board, game.boardSize),
                    blackCaptured: game.blackCaptured,
                    whiteCaptured: game.whiteCaptured
                }
            }));
        }

        if (data.type === "pass") {
            if (!ws.currentGame) return;
            const game = ws.currentGame;
            if (!game.player2) return;

            const color = game.getColor(ws);
            if (color !== game.current) {
                ws.send(JSON.stringify({ type: "error", message: "Nicht dein Zug." }));
                return;
            }

            const wasAlreadyPassed = game.lastMoveWasPass;
            game.lastMoveWasPass = true;

            if (wasAlreadyPassed) {
                game.stopTimer();
                const territory = calculateTerritory(game.board, game.boardSize);
                const blackScore = territory.blackTerritory + game.blackCaptured;
                const whiteScore = territory.whiteTerritory + game.whiteCaptured;
                const winner = blackScore > whiteScore ? "black" : whiteScore > blackScore ? "white" : "draw";

                const endData = JSON.stringify({
                    type: "game_over",
                    reason: "both_passed",
                    blackScore,
                    whiteScore,
                    winner
                });

                if (game.player1?.readyState === WebSocket.OPEN) game.player1.send(endData);
                if (game.player2?.readyState === WebSocket.OPEN) game.player2.send(endData);

                if (game.player1) game.player1.currentGame = null;
                if (game.player2) game.player2.currentGame = null;
                games.delete(game.id);
                broadcastGamesList();
                return; // ← wichtig
            }

            game.consumeTime();
            game.current = game.current === "black" ? "white" : "black";

            const passData = JSON.stringify({
                type: "passed",
                color,
                timers: game.getTimers()
            });
            if (game.player1?.readyState === WebSocket.OPEN) game.player1.send(passData);
            if (game.player2?.readyState === WebSocket.OPEN) game.player2.send(passData);
        }

        if (data.type === "resign") {
            if (!ws.currentGame) return;
            const game = ws.currentGame;

            const color = game.getColor(ws);
            const winner = color === "black" ? "white" : "black";

            game.stopTimer();

            const resignData = JSON.stringify({ type: "resigned", loser: color, winner });
            if (game.player1?.readyState === WebSocket.OPEN) game.player1.send(resignData);
            if (game.player2?.readyState === WebSocket.OPEN) game.player2.send(resignData);

            if (game.player1) game.player1.currentGame = null;
            if (game.player2) game.player2.currentGame = null;

            setTimeout(() => {
                games.delete(game.id);
                broadcastGamesList();
            }, 500);
        }
    });

    ws.on("close", () => {
        console.log("[WS] Getrennt:", ws.username);

        games.forEach((game, id) => {
            if (game.player1 === ws) {
                game.player1Disconnected = true;
                game.player1 = null;
            }
            if (game.player2 === ws) {
                game.player2Disconnected = true;
                game.player2 = null;
            }

            const oneDisconnected = game.player1Disconnected || game.player2Disconnected;

            if (oneDisconnected && !game.deleteTimeout) {
                game.consumeTime();
                game.stopTimer();

                const remaining = game.player1Disconnected ? game.player2 : game.player1;
                if (remaining?.readyState === WebSocket.OPEN) {
                    remaining.send(JSON.stringify({
                        type: "opponent_left",
                        message: "Dein Gegner hat die Verbindung getrennt. 30 Sekunden zum Wiederverbinden."
                    }));
                }

                game.deleteTimeout = setTimeout(() => {
                    const winner = game.player1Disconnected ? game.player2 : game.player1;
                    if (winner?.readyState === WebSocket.OPEN) {
                        winner.send(JSON.stringify({
                            type: "win_by_disconnect",
                            message: "Dein Gegner hat sich nicht wiederverbunden. Du gewinnst!"
                        }));
                    }
                    games.delete(id);
                    console.log("[Spiel] Gelöscht nach Timeout:", id);
                    broadcastGamesList();
                }, 30000);
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
            gameId: id,
            player1: game.player1Id ? game.player1?.username || "Wiederverbinden..." : null,
            player2: game.player2Id ? game.player2?.username || "Wiederverbinden..." : null,
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
    console.log("[WS] Spiele broadcast:", games.size, "Spiele");
}

function canTakeStone(x, y, color, board, boardSize = 19) {
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
            if (nx < 0 || ny < 0 || nx >= boardSize || ny >= boardSize) continue;
            if (board[ny][nx] === null) return true;
            if (board[ny][nx] === color) {
                if (hasLiberty(nx, ny)) return true;
            }
        }
        return false;
    }

    return !hasLiberty(x, y);
}

function removeGroup(x, y, color, board, captured = [], boardSize = 19) {
    if (x < 0 || y < 0 || x >= boardSize || y >= boardSize) return;
    if (board[y][x] !== color) return;
    board[y][x] = null;
    captured.push([x, y]);
    removeGroup(x - 1, y, color, board, captured, boardSize);
    removeGroup(x + 1, y, color, board, captured, boardSize);
    removeGroup(x, y - 1, color, board, captured, boardSize);
    removeGroup(x, y + 1, color, board, captured, boardSize);
}

function calculateTerritory(board, boardSize = 19) {
    const visited = new Set();
    let blackTerritory = 0;
    let whiteTerritory = 0;

    for (let y = 0; y < boardSize; y++) {
        for (let x = 0; x < boardSize; x++) {
            if (board[y][x] !== null) continue;
            const key = `${x},${y}`;
            if (visited.has(key)) continue;

            const region = [];
            const borders = new Set();
            const queue = [[x, y]];

            while (queue.length > 0) {
                const [cx, cy] = queue.pop();
                const k = `${cx},${cy}`;
                if (visited.has(k)) continue;

                if (board[cy][cx] !== null) {
                    borders.add(board[cy][cx]);
                    continue;
                }

                visited.add(k);
                region.push([cx, cy]);

                for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
                    if (nx < 0 || ny < 0 || nx >= boardSize || ny >= boardSize) continue;
                    if (!visited.has(`${nx},${ny}`)) queue.push([nx, ny]);
                }
            }

            if (borders.size === 1) {
                const owner = [...borders][0];
                if (owner === "black") blackTerritory += region.length;
                if (owner === "white") whiteTerritory += region.length;
            }
        }
    }

    return { blackTerritory, whiteTerritory };
}