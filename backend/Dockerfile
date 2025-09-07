# ---- Build/runtime (no compile step, we just install + run) ----
FROM node:20

# Create non-root work dir
WORKDIR /app

# Install only production deps
COPY package.json ./
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src ./src

# App runs on 5000 in code; we'll map it via Service/Ingress
ENV NODE_ENV=production
EXPOSE 3000

# Run as non-root
USER node

CMD ["node", "src/server.js"]
