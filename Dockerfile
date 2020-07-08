FROM node:14

WORKDIR /app

COPY . /app/

RUN yarn

EXPOSE 3292

CMD [ "node", "bld/server-cli/main.js" ]
