"""Ponto de entrada do executável (PyInstaller): GestorOS.exe."""

import sys

from gestor_os.app import main

if __name__ == "__main__":
    sys.exit(main())
