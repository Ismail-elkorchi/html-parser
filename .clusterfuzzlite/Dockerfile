FROM gcr.io/oss-fuzz-base/base-builder-javascript

WORKDIR /src/html-parser

COPY . .

RUN npm ci
RUN npm run build
