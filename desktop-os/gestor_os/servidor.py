"""Conversa com a API do serviço do Gestor pela rede da loja.

A sessão é a mesma do login feito na tela (o cookie vem da janela do pywebview), então o app
não guarda senha para falar com o servidor.
"""

import json
import urllib.error
import urllib.request

from . import VERSAO

TEMPO_PADRAO = 8


class ServidorFora(Exception):
    """Não houve resposta do servidor (desligado, rede fora, endereço errado)."""


class Servidor:
    def __init__(self, base, maquina=""):
        self.base = (base or "").rstrip("/")
        self.maquina = maquina
        self.cookie = ""

    def definir_cookies(self, cookies):
        """Recebe a lista de window.get_cookies() (http.cookies.SimpleCookie) ou um dict nome->valor."""
        partes = []
        if isinstance(cookies, dict):
            partes = [f"{k}={v}" for k, v in cookies.items()]
        else:
            for c in cookies or []:
                try:
                    for nome, morsel in c.items():
                        partes.append(f"{nome}={morsel.value}")
                except AttributeError:
                    continue
        self.cookie = "; ".join(partes)

    def _pedido(self, metodo, caminho, corpo=None, tempo=TEMPO_PADRAO, bruto=False):
        url = f"{self.base}/api{caminho}"
        dados = None
        cab = {
            "User-Agent": f"GestorOS-Desktop/{VERSAO}",
            "X-Device-Id": f"gestoros-{self.maquina}",
            "X-Device-Name": self.maquina,
        }
        if corpo is not None:
            dados = json.dumps(corpo).encode("utf-8")
            cab["Content-Type"] = "application/json"
        if self.cookie:
            cab["Cookie"] = self.cookie
        req = urllib.request.Request(url, data=dados, method=metodo, headers=cab)
        try:
            with urllib.request.urlopen(req, timeout=tempo) as resp:
                conteudo = resp.read()
        except urllib.error.HTTPError as err:
            conteudo = err.read()
            if bruto:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as err:
            raise ServidorFora(str(err)) from err
        if bruto:
            return conteudo
        try:
            return json.loads(conteudo.decode("utf-8"))
        except ValueError:
            return {"ok": False, "error": "Resposta inválida do servidor."}

    def get(self, caminho, tempo=TEMPO_PADRAO):
        return self._pedido("GET", caminho, tempo=tempo)

    def post(self, caminho, corpo, tempo=TEMPO_PADRAO):
        return self._pedido("POST", caminho, corpo or {}, tempo=tempo)

    def texto(self, caminho, tempo=TEMPO_PADRAO):
        """Resposta em texto (HTML da impressão)."""
        try:
            return self._pedido("GET", caminho, tempo=tempo, bruto=True).decode("utf-8")
        except urllib.error.HTTPError as err:
            raise RuntimeError(err.read().decode("utf-8", "replace") or f"Erro {err.code}") from err

    def baixar(self, caminho, destino, tempo=120):
        conteudo = self._pedido("GET", caminho, tempo=tempo, bruto=True)
        with open(destino, "wb") as f:
            f.write(conteudo)
        return destino

    def no_ar(self, tempo=4):
        """O serviço responde? (/api/health é livre, não precisa de sessão)."""
        try:
            r = self.get("/health", tempo=tempo)
            return bool(r.get("ok", True))
        except ServidorFora:
            return False

    def logado(self):
        try:
            r = self.get("/sessao", tempo=5)
            return bool(r.get("ok") and r.get("usuario"))
        except ServidorFora:
            return False
