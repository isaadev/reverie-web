FROM node:20-slim

# Install ffmpeg + yt-dlp
RUN apt-get update && apt-get install -y \
      ffmpeg \
      python3 \
      python3-pip \
      curl \
      --no-install-recommends \
    && pip3 install yt-dlp --break-system-packages \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

EXPOSE 3000
ENV NODE_ENV=production
ENV PORT=3000

CMD ["npm", "start"]
