#!/bin/bash

echo ""
echo "  ========================================"
echo "    AdminBot - Discord Administration Bot"
echo "  ========================================"
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "  [ERROR] Node.js is not installed!"
    echo "  Install it from: https://nodejs.org"
    echo ""
    exit 1
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "  Installing dependencies..."
    npm install
    echo ""
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo "  No .env found — starting setup wizard..."
    echo ""
    node src/setup-wizard.js
    echo ""
    echo "  Deploying slash commands..."
    node src/deploy-commands.js
    echo ""
fi

# Start the bot
echo "  Starting AdminBot..."
echo "  Press Ctrl+C to stop."
echo "  Logs are saved in the /logs folder."
echo ""
node src/index.js
