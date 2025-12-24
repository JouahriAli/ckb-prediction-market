#!/bin/bash
# Simple HTTP server for CCC frontend

echo "========================================="
echo "  CKB Prediction Market - CCC Frontend"
echo "========================================="
echo ""
echo "Starting HTTP server on port 8002..."
echo ""
echo "Open in browser:"
echo "  http://localhost:8002/index.html"
echo ""
echo "Press Ctrl+C to stop"
echo ""

python3 -m http.server 8002
