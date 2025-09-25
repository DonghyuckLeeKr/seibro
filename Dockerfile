FROM mcr.microsoft.com/playwright:v1.47.2-jammy

WORKDIR /app

COPY web/package*.json ./
RUN npm ci --only=production
RUN npx playwright install-deps

COPY web .

RUN npm run build

ENV PORT=3000
EXPOSE 3000

CMD ["npm", "run", "start"]
