FROM node:14-alpine

WORKDIR /app

COPY . /app/

RUN yarn

RUN yarn test

EXPOSE 3292

CMD [ "node", "bld/server-cli/main.js" ]
