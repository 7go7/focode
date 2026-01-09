FROM node:20

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Generate Prisma Client
RUN npx prisma generate

EXPOSE 3000

# Wait for DB, migrate, seed, then start
CMD npx prisma db push && node server.js
