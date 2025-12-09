// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const db = require('../config/db'); // 👈 IMPORT DATABASE CONNECTION

exports.protect = async (req, res, next) => { // 👈 Make this ASYNC
    let token;

    // 1. Check for token in headers
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ message: 'Not authorized, no token.' });
    }

    try {
        // 2. Verify Token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // 3. 👇 FETCH FULL USER FROM DB (The Critical Fix)
        // We select everything (*) so we get first_name, last_name, phone_number, credits, etc.
        const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [decoded.id]);

        if (rows.length === 0) {
            return res.status(401).json({ message: 'User belonging to this token no longer exists.' });
        }

        // Attach the FULL user database row to the request
        req.user = rows[0]; 
        
        next();

    } catch (err) {
        console.error("Auth Middleware Error:", err);
        return res.status(401).json({ message: 'Not authorized, token failed.' });
    }
};

// Middleware to restrict access based on user role
exports.authorize = (roles = []) => {
    if (typeof roles === 'string') {
        roles = [roles];
    }

    return (req, res, next) => {
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ 
                message: `User role ${req.user.role} is not authorized.` 
            });
        }
        next();
    };
};