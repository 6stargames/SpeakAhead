# Regional signalling server.
# Build:  docker build -t aac-signaling ./signaling
# Run:    docker run -p 8081:8081 -e ALLOWED_ORIGINS=https://your.app aac-signaling
FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY hub.js server.js ./

ENV PORT=8081
ENV HOST=0.0.0.0
EXPOSE 8081

# Signalling holds no state, so a failed health check can always just be replaced.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "server.js"]
