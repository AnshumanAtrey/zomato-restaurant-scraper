FROM apify/actor-node-puppeteer-chrome:22

# Copy package.json first for layer caching
COPY --chown=myuser package*.json ./

# Install npm packages — production only
RUN npm --quiet set progress=false \
 && npm install --omit=dev --omit=optional \
 && echo "Installed npm packages:" \
 && (npm list --omit=dev --all || true) \
 && echo "Node.js version:" \
 && node --version \
 && echo "NPM version:" \
 && npm --version

# Copy source files
COPY --chown=myuser . ./

CMD ./start_xvfb_and_run_cmd.sh && npm start --silent
