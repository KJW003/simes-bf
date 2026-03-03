# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Accept API URL at build time (baked into Vite bundle)
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# Serve stage
FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html/testUi

EXPOSE 80
