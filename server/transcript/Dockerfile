FROM node:24.16.0-slim

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8080
ENV TRANSCRIPT_RUNTIME_SELF_TEST=1

WORKDIR /app
COPY server/transcript/httpService.js ./httpService.js
COPY server/transcript/youtubeTranscriptService.js ./youtubeTranscriptService.js
COPY server/transcript/runtimeDiagnostics.js ./runtimeDiagnostics.js

EXPOSE 8080
CMD ["node", "--import", "./runtimeDiagnostics.js", "httpService.js"]
