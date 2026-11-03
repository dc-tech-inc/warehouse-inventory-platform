# One image: the API plus the built web app, served from the same origin.
FROM node:25-bookworm-slim
WORKDIR /app
ENV CI=true
RUN corepack enable
COPY . .
# The pnpm version is pinned in package.json ("packageManager").
RUN pnpm install --frozen-lockfile && pnpm build
ENV NODE_ENV=production \
    WEB_DIST=/app/apps/web/dist \
    PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["sh", "-c", "node apps/api/dist/bootstrap.js && node apps/api/dist/server.js"]
