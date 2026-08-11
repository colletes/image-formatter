#!/bin/bash
# Navega para o diretório onde o script está localizado
cd "$(dirname "$0")"

echo "Iniciando o servidor Vite..."
npm run dev &
VITE_PID=$!

# Aguarda 2 segundos para garantir que o Vite subiu
sleep 2

echo "Iniciando o App Electron..."
npm start

# Quando o Electron fechar, encerra o Vite
echo "Encerrando..."
kill $VITE_PID
