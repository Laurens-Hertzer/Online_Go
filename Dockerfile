# Builder
FROM node:20-alpine AS build

RUN apk update && apk upgrade && apk add --no-cache git

WORKDIR /app

RUN git clone https://github.com/Laurens-Hertzer/Online_Go .

RUN npm install

# light at runtime
FROM node:20-alpine

WORKDIR /app

COPY --from=build /app .

# Express benutzt Port 3000 nicht 80!
EXPOSE 3000

CMD ["node", "Backend/server.js"]