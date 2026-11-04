FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js move-booking.js shift-bookings.js app.js index.html styles.css seating.css ./

EXPOSE 3000

CMD ["node", "server.js"]
