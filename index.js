// server/index.js
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const { Pool } = require('pg');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || 'Vrps!234',
    port: process.env.DB_PORT || 5432,
    ssl: process.env.DB_HOST && process.env.DB_HOST.includes('rds.amazonaws.com') ? {
        rejectUnauthorized: false
    } : false
});

const parseHandicap = (hcpString) => {
    if (hcpString === null || hcpString === undefined || hcpString.trim() === '') return null;
    let value = parseFloat(hcpString);
    if (isNaN(value)) return null;
    if (typeof hcpString === 'string' && hcpString.trim().startsWith('+') && value > 0) {
        value = -value;
    }
    return Math.round(value * 10) / 10;
};

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const tempFilePath = `${__dirname}/temp_golfer_data.csv`;
    fs.writeFileSync(tempFilePath, req.file.buffer);

    const results = [];
    fs.createReadStream(tempFilePath)
        .pipe(csv({ mapHeaders: ({ header }) => header.trim() }))
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            fs.unlinkSync(tempFilePath);
            const client = await pool.connect();
            let importedCount = 0;
            let errorCount = 0;
            try {
                await client.query('BEGIN');
                for (const golfer of results) {
                    const { GHIN, Name, HI, Blue, Gold, Black, White, Green } = golfer;

                    if (GHIN && Name && HI !== null && !isNaN(parseFloat(HI))) {
                        try {
                            const finalHI = parseHandicap(HI);
                            const phBlue = parseHandicap(Blue);
                            const phGold = parseHandicap(Gold);
                            const phBlack = parseHandicap(Black);
                            const phWhite = parseHandicap(White);
                            const phGreen = parseHandicap(Green);

                            const queryText = `
                                INSERT INTO golfers (ghin_number, player_name, handicap_index, ph_blue, ph_gold, ph_black, ph_white, ph_green)
                                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                                    ON CONFLICT (ghin_number) DO UPDATE SET
                                    player_name = EXCLUDED.player_name,
                                                                     handicap_index = EXCLUDED.handicap_index,
                                                                     ph_blue = EXCLUDED.ph_blue,
                                                                     ph_gold = EXCLUDED.ph_gold,
                                                                     ph_black = EXCLUDED.ph_black,
                                                                     ph_white = EXCLUDED.ph_white,
                                                                     ph_green = EXCLUDED.ph_green;
                            `;
                            await client.query(queryText, [GHIN, Name, finalHI, phBlue, phGold, phBlack, phWhite, phGreen]);
                            importedCount++;
                        } catch (rowError) {
                            console.error(`Could not import row for GHIN ${GHIN} (${Name}). Reason:`, rowError.message);
                            errorCount++;
                        }
                    } else {
                        console.log(`Skipping invalid row: GHIN ${GHIN}, Name: ${Name}, HI: ${HI}`);
                        errorCount++;
                    }
                }
                await client.query('COMMIT');
            } catch (transactionError) {
                await client.query('ROLLBACK');
                return res.status(500).send({ message: 'A major error occurred during import.' });
            } finally {
                client.release();
            }
            res.status(200).send({
                message: `Import complete. Imported ${importedCount} golfers. Skipped ${errorCount} rows.`
            });
        });
});

app.get('/api/golfers', async (req, res) => {
    const client = await pool.connect();
    try {
        const result = await client.query('SELECT *, COALESCE(is_regular, FALSE) as is_regular FROM golfers ORDER BY player_name ASC');
        res.status(200).json(result.rows);
    } catch (error) {
        console.error('Error fetching golfers:', error);
        res.status(500).send({ message: 'Error fetching golfers.' });
    } finally {
        client.release();
    }
});

app.post('/api/golfers', async (req, res) => {
    const { playerName, handicapIndex } = req.body;
    if (!playerName || handicapIndex === undefined) {
        return res.status(400).send({ message: 'Player name and handicap are required.' });
    }

    const ghin_number = `GUEST-${crypto.randomBytes(2).toString('hex')}`;
    const hi = parseFloat(handicapIndex);

    if (isNaN(hi)) {
        return res.status(400).send({ message: 'Invalid handicap index.' });
    }

    try {
        const queryText = `
            INSERT INTO golfers (ghin_number, player_name, handicap_index)
            VALUES ($1, $2, $3)
                RETURNING *;
        `;
        const result = await pool.query(queryText, [ghin_number, playerName, hi]);
        const newGolfer = result.rows[0];
        res.status(201).json(newGolfer);
    } catch (error) {
        console.error('Error adding new golfer:', error);
        res.status(500).send({ message: 'Failed to add new golfer.' });
    }
});

app.put('/api/golfers/:ghin/toggle-regular', async (req, res) => {
    const { ghin } = req.params;
    try {
        const result = await pool.query(
            'UPDATE golfers SET is_regular = NOT COALESCE(is_regular, FALSE) WHERE ghin_number = $1 RETURNING is_regular',
            [ghin]
        );
        if (result.rowCount > 0) {
            res.status(200).json({ is_regular: result.rows[0].is_regular });
        } else {
            res.status(404).send({ message: 'Golfer not found.' });
        }
    } catch (error) {
        console.error(`Error toggling regular status for GHIN ${ghin}:`, error);
        res.status(500).send({ message: 'Error updating golfer status.' });
    }
});

// Create a new game
app.post('/api/games', async (req, res) => {
    const { gameName, gameType, numBalls, playersPerTeam, advantageReduction, date } = req.body;
    
    if (!gameName || !gameType) {
        return res.status(400).json({ message: 'Game name and game type are required.' });
    }

    try {
        const queryText = `
            INSERT INTO games (game_name, game_type, num_balls, players_per_team, advantage_reduction, game_date, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            RETURNING *;
        `;
        const result = await pool.query(queryText, [
            gameName, 
            gameType, 
            numBalls, 
            playersPerTeam, 
            advantageReduction, 
            date
        ]);
        
        const newGame = result.rows[0];
        res.status(201).json(newGame);
    } catch (error) {
        console.error('Error creating game:', error);
        res.status(500).json({ message: 'Failed to create game.' });
    }
});

app.post('/api/rounds', async (req, res) => {
    const { roundName, gameFormat, teams, numBalls } = req.body;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const roundResult = await client.query(
            'INSERT INTO rounds (round_name, game_format, num_balls) VALUES ($1, $2, $3) RETURNING round_id',
            [roundName, gameFormat, numBalls]
        );
        const roundId = roundResult.rows[0].round_id;
        for (const team of teams) {
            const teamResult = await client.query(
                'INSERT INTO round_teams (round_id, team_name) VALUES ($1, $2) RETURNING round_team_id',
                [roundId, team.name]
            );
            const teamId = teamResult.rows[0].round_team_id;
            for (const player of team.players) {
                for (let hole = 1; hole <= 18; hole++) {
                    await client.query(
                        'INSERT INTO scores (round_id, player_ghin, hole_number, team_id) VALUES ($1, $2, $3, $4)',
                        [roundId, player.ghin_number, hole, teamId]
                    );
                }
            }
        }
        await client.query('COMMIT');
        res.status(201).json({ roundId, message: 'Round created successfully!' });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error creating round:', error);
        res.status(500).json({ message: 'Failed to create round.' });
    } finally {
        client.release();
    }
});

app.post('/api/scores', async (req, res) => {
    const { roundId, playerGhin, holeNumber, score } = req.body;
    const scoreValue = score === '' || score === null ? null : parseInt(score, 10);
    const client = await pool.connect();
    try {
        const result = await client.query(
            'UPDATE scores SET score = $1 WHERE round_id = $2 AND player_ghin = $3 AND hole_number = $4',
            [scoreValue, roundId, playerGhin, holeNumber]
        );
        if (result.rowCount === 0) {
            return res.status(404).send('Score entry not found.');
        }
        res.status(200).send('Score updated successfully.');
    } catch (error) {
        console.error('Error updating score:', error);
        res.status(500).json({ message: 'Failed to update score.' });
    } finally {
        client.release();
    }
});

app.get('/api/rounds/:roundId', async (req, res) => {
    const { roundId } = req.params;
    const client = await pool.connect();
    try {
        const query = `
            SELECT s.*, r.game_format, r.num_balls
            FROM full_scores_view s
                     JOIN rounds r ON s.round_id = r.round_id
            WHERE s.round_id = $1
            ORDER BY s.team_name, s.player_name, s.hole_number ASC
        `;
        const scoresResult = await client.query(query, [roundId]);
        if (scoresResult.rows.length === 0) {
            return res.status(404).json({ message: 'Round not found.' });
        }
        res.status(200).json(scoresResult.rows);
    } catch (error) {
        console.error(`Error fetching data for round ${roundId}:`, error);
        res.status(500).json({ message: 'Failed to fetch round data.' });
    } finally {
        client.release();
    }
});


const server = app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

const wss = new WebSocketServer({ server });
const roundConnections = new Map();

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);

        if (data.type === 'subscribe') {
            const roundId = data.roundId;
            if (!roundConnections.has(roundId)) {
                roundConnections.set(roundId, new Set());
            }
            roundConnections.get(roundId).add(ws);
            ws.roundId = roundId;
        } else if (data.type === 'scoreUpdate') {
            const roundId = ws.roundId;
            if (roundConnections.has(roundId)) {
                roundConnections.get(roundId).forEach(client => {
                    if (client !== ws && client.readyState === ws.OPEN) {
                        client.send(JSON.stringify(data.payload));
                    }
                });
            }
        }
    });

    ws.on('close', () => {
        const roundId = ws.roundId;
        if (roundId && roundConnections.has(roundId)) {
            roundConnections.get(roundId).delete(ws);
        }
    });
});
