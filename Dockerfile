FROM node:22-bookworm
WORKDIR /e2e
COPY package.json ./
RUN npm install && npx playwright install --with-deps chromium
COPY . .
ENTRYPOINT ["npm", "test"]
