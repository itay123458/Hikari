FROM node:20-alpine

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev \
    && node --input-type=module -e "await import('discord.js'); await import('sharp'); await import('pg');"

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
