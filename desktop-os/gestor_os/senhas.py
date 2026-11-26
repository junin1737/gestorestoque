"""Login da contingência: o mesmo usuário e senha do Gestor, conferidos no próprio computador.

Quando a pessoa entra no app com o servidor no ar, a tela de login do Gestor entrega a senha ao app,
que guarda só um hash PBKDF2 com sal. Sem servidor, a senha digitada é conferida contra esse hash.
Quem nunca entrou neste computador não consegue abrir a contingência nele.
"""

import hashlib
import hmac
import os

ITERACOES = 200_000


def gerar(senha):
    sal = os.urandom(16).hex()
    return hash_de(senha, sal), sal


def hash_de(senha, sal):
    return hashlib.pbkdf2_hmac("sha256", str(senha).encode("utf-8"), bytes.fromhex(sal), ITERACOES).hex()


def confere(senha, hash_, sal):
    if not hash_ or not sal:
        return False
    return hmac.compare_digest(hash_de(senha, sal), hash_)
