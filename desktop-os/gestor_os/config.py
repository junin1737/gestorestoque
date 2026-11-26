"""Configuração do computador: endereço do servidor e impressoras.

Fica em %APPDATA%\\GestorOS\\config.json. Na primeira execução, se o instalador deixou o
arquivo servidor.txt ao lado do executável (pego do nome do instalador baixado no Gestor),
o endereço já vem preenchido.
"""

import json
import os
import socket
import sys
from pathlib import Path


def pasta_dados():
    base = os.environ.get("APPDATA") or str(Path.home())
    p = Path(base) / "GestorOS"
    p.mkdir(parents=True, exist_ok=True)
    return p


def pasta_programa():
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


ARQUIVO = "config.json"


def normalizar_servidor(valor):
    """Aceita 192.168.0.10, 192.168.0.10:5077, servidor-loja ou http://... e devolve http://host:porta."""
    s = str(valor or "").strip().rstrip("/")
    if not s:
        return ""
    if "://" not in s:
        s = "http://" + s
    esquema, resto = s.split("://", 1)
    host = resto.split("/", 1)[0]
    if ":" not in host:
        host += ":5077"
    return f"{esquema.lower()}://{host}"


def ler():
    caminho = pasta_dados() / ARQUIVO
    dados = {}
    if caminho.exists():
        try:
            dados = json.loads(caminho.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            dados = {}
    if not dados.get("servidor"):
        sugerido = pasta_programa() / "servidor.txt"
        if sugerido.exists():
            try:
                dados["servidor"] = normalizar_servidor(sugerido.read_text(encoding="utf-8").strip())
            except OSError:
                pass
    dados.setdefault("impressoras", {"a4": "", "termica": ""})
    dados.setdefault("maquina", nome_maquina())
    return dados


def gravar(dados):
    caminho = pasta_dados() / ARQUIVO
    tmp = caminho.with_suffix(".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(caminho)


def nome_maquina():
    """Nome curto do computador para o número provisório (C-CAIXA01-0001)."""
    nome = os.environ.get("COMPUTERNAME") or socket.gethostname() or "PC"
    limpo = "".join(ch for ch in nome.upper() if ch.isalnum())
    return (limpo or "PC")[:12]
