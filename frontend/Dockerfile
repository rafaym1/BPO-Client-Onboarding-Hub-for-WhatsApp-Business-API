FROM node:20-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

COPY . .
EXPOSE 3000

# dev server: the code is bind-mounted by docker-compose so edits hot-reload
CMD ["npm", "run", "dev"]
