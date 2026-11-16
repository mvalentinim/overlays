#!/bin/zsh
# Doppio clic: avvia il server in questa finestra e apre il pannello di regia.
# Chiudere la finestra (o Ctrl-C) ferma il server.
cd "$(dirname "$0")"
URL="http://127.0.0.1:4330/"
if curl -s -o /dev/null "$URL"; then open "$URL"; exit 0; fi
NODE="/opt/homebrew/bin/node"; [ -x "$NODE" ] || NODE="$(command -v node)"
( until curl -s -o /dev/null "$URL"; do sleep 0.3; done; open "$URL" ) &
exec "$NODE" server.js
