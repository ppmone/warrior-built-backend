const express = require('express');
const db = require('./db'); // Import the SQLite database connection
const router = express.Router();

// Get subscription status for a user
router.get('/users/:id/subscription', (req, res) => {
    const userId = req.params.id;
    db.get('SELECT isSubscribed FROM users WHERE id = ?', [userId], (err, row) => {
        if (err) {
            console.error('Error fetching subscription status:', err.message);
            res.status(500).send('Database error');
        } else if (row) {
            res.json({ isSubscribed: row.isSubscribed });
        } else {
            res.status(404).send('User not found');
        }
    });
});

// Update subscription status for a user
router.post('/users/:id/subscription', (req, res) => {
    const userId = req.params.id;
    const { isSubscribed } = req.body;
    db.run(
        'UPDATE users SET isSubscribed = ? WHERE id = ?',
        [isSubscribed, userId],
        function (err) {
            if (err) {
                console.error('Error updating subscription status:', err.message);
                res.status(500).send('Database error');
            } else if (this.changes > 0) {
                res.send('Subscription updated successfully');
            } else {
                res.status(404).send('User not found');
            }
        }
    );
});

// Create a new user
router.post('/users', (req, res) => {
    const { id, email } = req.body;
    db.run(
        'INSERT INTO users (id, email) VALUES (?, ?)',
        [id, email],
        function (err) {
            if (err) {
                console.error('Error creating user:', err.message);
                res.status(500).send('Database error');
            } else {
                res.send('User created successfully');
            }
        }
    );
});

module.exports = router;