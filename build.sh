#!/bin/bash
cat src/p1.html src/p2.html src/p3.html src/p4.html src/p5.html src/p6.html src/p7.html > index.html
echo "✅ Built index.html ($(wc -c < index.html) bytes)"
