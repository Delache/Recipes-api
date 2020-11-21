FROM node:12.18.2-alpine3.9

# Used to install dev software
ARG DEV

ENV PORT=${PORT} \
    DEV=${DEV} \
    NODE_ENV=development

WORKDIR /usr/src/recipes/api

COPY package.json package.json

COPY . .

RUN ln -sf .env.prod .env \
    && yarn install --force --production --check-files

# VOLUME node_modules
# VOLUME yarn.lock

EXPOSE 9000

# Add nodemon to don't restart container at each modif
CMD ["yarn", "start"]
