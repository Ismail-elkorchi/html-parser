FROM gcr.io/oss-fuzz-base/base-builder-javascript@sha256:43ab627247213eb49fa7d767a3772083fd9515f661161a82af8dd9969087aee0

WORKDIR /src/html-parser

COPY . .

RUN npm ci
RUN npm run build
