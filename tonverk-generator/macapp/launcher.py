"""Entry point of the bundled macOS app (PyInstaller)."""
import sys

from tvgen.macapp import main

sys.exit(main())
