"""Atualização automática: o serviço do Gestor guarda o instalador mais novo.

O app pergunta a versão em /api/desktop/versao; se for mais nova, baixa /api/desktop/instalador
e roda em modo silencioso. O instalador fecha o app, atualiza e abre de novo.
"""

import os
import subprocess
import tempfile

from . import VERSAO
from .servidor import ServidorFora


def mais_nova(a, b):
    def partes(v):
        out = []
        for p in str(v or "0").split("."):
            try:
                out.append(int(p))
            except ValueError:
                out.append(0)
        return out
    pa, pb = partes(a), partes(b)
    n = max(len(pa), len(pb))
    pa += [0] * (n - len(pa))
    pb += [0] * (n - len(pb))
    return pa > pb


def verificar(servidor):
    try:
        r = servidor.get("/desktop/versao", tempo=5)
    except ServidorFora:
        return None
    if r.get("ok") and r.get("disponivel") and mais_nova(r.get("versao"), VERSAO):
        return {"versao": r.get("versao"), "data": r.get("data"), "tamanho": r.get("tamanho")}
    return None


def baixar_e_instalar(servidor):
    destino = os.path.join(tempfile.gettempdir(), "GestorOS-Setup-atualizacao.exe")
    servidor.baixar("/desktop/instalador", destino, tempo=300)
    criar = 0x00000008 | 0x00000200  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    subprocess.Popen([destino, "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS"],
                     close_fds=True, creationflags=criar)
    return destino
