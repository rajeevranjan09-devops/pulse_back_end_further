// src/middleware/optionalAuth.js
import jwt from 'jsonwebtoken';

export default function optionalAuth(req, _res, next) {
  const h = req.headers['authorization'];
  if (h && h.startsWith('Bearer ')) {
    const token = h.slice(7);
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // we signed as { id: user._id }
      req.userId = decoded?.id || decoded?._id || decoded?.userId || null;
    } catch {
      // invalid/expired token – ignore and proceed unauthenticated
    }
  }
  next();
}