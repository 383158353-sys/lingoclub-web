FROM node:22-slim

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080

WORKDIR /app
COPY server/transcript/httpService.js ./httpService.js
COPY server/transcript/youtubeTranscriptService.js ./youtubeTranscriptService.js

EXPOSE 8080
CMD ["node", "httpService.js"]
