// src/middleware/auth.js
const jwt = require('jsonwebtoken');

exports.protect = (req, res, next) => {
    // 1. Check for token in the Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // 401: Unauthorized
        return res.status(401).json({ message: 'No token provided, access denied.' });
    }

    const token = authHeader.split(' ')[1]; // Get token from "Bearer <token>"

    try {
        // 2. Verify and decode the token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // 3. Attach user data (id and role) to the request object
        req.user = decoded; 
        
        // 4. Continue to the next handler/controller function
        next();

    } catch (err) {
        // If token is invalid or expired
        // 403: Forbidden (but often 401 is used for token errors)
        return res.status(401).json({ message: 'Token is not valid or has expired.' });
    }
};

// Middleware to restrict access based on user role
exports.authorize = (roles = []) => {
    // roles is an array, e.g., ['admin', 'staff']
    if (typeof roles === 'string') {
        roles = [roles];
    }

    return (req, res, next) => {
        // Check if the user's role is included in the allowed roles array
        if (!roles.includes(req.user.role)) {
            // 403: Forbidden
            return res.status(403).json({ 
                message: `User role ${req.user.role} is not authorized to access this resource.` 
            });
        }
        next();
    };
};