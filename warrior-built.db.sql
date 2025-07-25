CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    isSubscribed BOOLEAN DEFAULT FALSE
);