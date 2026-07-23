#!/usr/bin/env bash
# Ntox one-liner installer, macOS / Linux
# Run: curl -fsSL https://raw.githubusercontent.com/Ntooxx/Ntox/main/install.sh | bash

set -e

echo ""
echo -e "  \033[36mNtox installer\033[0m"
echo ""

# Check Node.js
if ! command -v node &> /dev/null; then
  echo -e "  \033[31mNode.js 18+ required. Install from https://nodejs.org\033[0m"
  exit 1
fi

NODE_VERSION=$(node -v 2>/dev/null)
echo -e "  Node.js: \033[32m$NODE_VERSION\033[0m"

echo -e "  \033[33mInstalling ntox...\033[0m"
npm install -g ntox@latest

if [ $? -eq 0 ]; then
  echo -e "  \033[32mDone! Run 'ntox' to start, or 'ntox setup' to configure.\033[0m"
else
  echo -e "  \033[31mInstall failed. Try: npm install -g ntox\033[0m"
fi
