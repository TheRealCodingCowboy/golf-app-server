-- Database initialization script for Golf App
-- Run this on your AWS RDS instance

-- First connect as the master user (postgres) and create the application database and user
-- CREATE DATABASE golf_app_prod;
-- CREATE USER golfapp_user WITH PASSWORD 'your-secure-password';
-- GRANT ALL PRIVILEGES ON DATABASE golf_app_prod TO golfapp_user;
-- 
-- Then connect to the golf_app_prod database as golfapp_user and run the rest of this script:

-- Create golfers table
CREATE TABLE IF NOT EXISTS golfers (
    ghin_number VARCHAR(50) PRIMARY KEY,
    player_name VARCHAR(255) NOT NULL,
    handicap_index DECIMAL(4,1),
    ph_blue DECIMAL(4,1),
    ph_gold DECIMAL(4,1),
    ph_black DECIMAL(4,1),
    ph_white DECIMAL(4,1),
    ph_green DECIMAL(4,1),
    is_regular BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create games table
CREATE TABLE IF NOT EXISTS games (
    game_id SERIAL PRIMARY KEY,
    game_name VARCHAR(255) NOT NULL,
    game_type VARCHAR(50),
    num_balls INTEGER DEFAULT 1,
    players_per_team INTEGER DEFAULT 4,
    advantage_reduction INTEGER DEFAULT 25,
    game_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create rounds table
CREATE TABLE IF NOT EXISTS rounds (
    round_id SERIAL PRIMARY KEY,
    round_name VARCHAR(255),
    game_format VARCHAR(50),
    num_balls INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create round_teams table
CREATE TABLE IF NOT EXISTS round_teams (
    round_team_id SERIAL PRIMARY KEY,
    round_id INTEGER REFERENCES rounds(round_id),
    team_name VARCHAR(255) NOT NULL
);

-- Create scores table
CREATE TABLE IF NOT EXISTS scores (
    score_id SERIAL PRIMARY KEY,
    round_id INTEGER REFERENCES rounds(round_id),
    player_ghin VARCHAR(50) REFERENCES golfers(ghin_number),
    hole_number INTEGER CHECK (hole_number >= 1 AND hole_number <= 18),
    score INTEGER,
    team_id INTEGER REFERENCES round_teams(round_team_id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create view for scores with player and team info
CREATE OR REPLACE VIEW full_scores_view AS
SELECT 
    s.score_id,
    s.round_id,
    s.player_ghin as ghin_number,
    g.player_name,
    s.hole_number,
    s.score,
    s.team_id as round_team_id,
    rt.team_name,
    s.created_at,
    s.updated_at
FROM scores s
JOIN golfers g ON s.player_ghin = g.ghin_number
JOIN round_teams rt ON s.team_id = rt.round_team_id
ORDER BY s.round_id, rt.team_name, g.player_name, s.hole_number;