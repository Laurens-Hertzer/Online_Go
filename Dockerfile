# Builder
FROM node:20-alpine AS build

WORKDIR /app

# No Git clone needed because of context in docker-compose
COPY package*.json ./
RUN npm install

COPY . .

# Runtime
FROM node:20-alpine

WORKDIR /app

COPY --from=build /app .

EXPOSE 3000

CMD ["node", "Backend/server.js"]