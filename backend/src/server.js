import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import session from 'express-session';
import dotenv from 'dotenv';

import passport from './config/passport.js';
import { connectDB } from './config/db.js';

import authRoutes from './routes/auth.js';
import githubRoutes from './routes/github.js';
import pipelineRoutes from './routes/pipeline.js';
import meRoutes from './routes/me.js';
import aiRoutes from './routes/ai.js';

import { swaggerUi, specs } from './config/swagger.js';

dotenv.config();
connectDB();

const app = express();

// ----- CORS (single block, with credentials) -----
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // swagger/curl/no-origin
      if (allowedOrigins.includes(origin)) return cb(null, true);
      return cb(new Error('CORS not allowed from origin: ' + origin), false);
    },
    credentials: true,
  })
);

app.use(bodyParser.json());

// ----- Session (single block) -----
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // only true when behind HTTPS
    },
  })
);

// ----- Passport -----
app.use(passport.initialize());
app.use(passport.session());

// ----- Health -----
app.get('/healthz', (_, res) => res.status(200).send('ok'));

// ----- Routes -----
app.use('/ai', aiRoutes);
app.use('/me', meRoutes);

// For the demo we don’t require session on /github/* (env PAT will be used)
app.use('/github', githubRoutes);

app.use('/pipelines', pipelineRoutes);
app.use('/auth', authRoutes);

// ----- Swagger -----
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));

// ----- Start -----
const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Server running on port ${port}`));