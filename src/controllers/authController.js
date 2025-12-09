// src/controllers/authController.js
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// 1. Register User
exports.register = async (req, res) => {
    try {
        // FIXED: Destructure first_name and last_name
        const { first_name, last_name, email, password } = req.body;

        // Check if user already exists
        const [existingUser] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: 'Email already exists' });
        }

        // Hash the password (encrypt it)
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // FIXED: Save separate names to database
        // Ensure your database table 'users' has columns 'first_name' and 'last_name'
        const sql = 'INSERT INTO users (first_name, last_name, email, password_hash) VALUES (?, ?, ?, ?)';
        
        await db.query(sql, [first_name, last_name, email, hashedPassword]);

        res.status(201).json({ message: 'User registered successfully!' });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error during registration' });
    }
};

// 2. Login User
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        // Find user
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        const user = users[0];

        // Check password
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        // Generate Token (JWT)
        // We include email in the token so we can display it immediately on the frontend if needed
        const token = jwt.sign(
            { id: user.id, role: user.role, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        res.json({ 
            message: 'Login successful', 
            token: token, 
            user: { 
                id: user.id, 
                // FIXED: Return first and last name instead of full_name
                first_name: user.first_name, 
                last_name: user.last_name,
                role: user.role 
            } 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error during login' });
    }
};