FROM node:lts-alpine
WORKDIR /musicBot
ADD . .
RUN yarn
CMD node app.js