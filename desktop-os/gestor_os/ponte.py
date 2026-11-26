"""Métodos que as telas chamam por window.pywebview.api.

Vale para a tela do Gestor (carregada do servidor) e para as telas locais da contingência.
Cada método devolve um dict simples ({ok, ...}) porque passa por JSON.
"""

import json

from . import VERSAO, config, impressao, senhas, sincronizacao
from .calculo import calcular, conferir_limites
from .servidor import ServidorFora


def _erro(err):
    return {"ok": False, "error": str(err)}


class Ponte:
    def __init__(self, app):
        self._app = app

    # ------------------------------------------------------------------ geral

    def info(self):
        a = self._app
        return {
            "ok": True,
            "versao": VERSAO,
            "maquina": a.cfg.get("maquina"),
            "servidor": a.cfg.get("servidor", ""),
            "modo": a.modo,
            "tema": a.base.copia("tema", "claro"),
            "copia_em": a.base.copia("gerado_em"),
            "pendentes": len(a.base.pendentes()),
        }

    # ------------------------------------------------------------------ configuração do servidor

    def config_testar(self, endereco):
        from .servidor import Servidor
        url = config.normalizar_servidor(endereco)
        if not url:
            return _erro("Informe o endereço do servidor.")
        ok = Servidor(url, self._app.cfg.get("maquina")).no_ar(tempo=5)
        return {"ok": ok, "url": url, "error": "" if ok else f"Não houve resposta em {url}. Confira o IP e se o Gestor está aberto no servidor."}

    def config_salvar(self, endereco):
        r = self.config_testar(endereco)
        if not r["ok"]:
            return r
        self._app.trocar_servidor(r["url"])
        return {"ok": True}

    def tentar_servidor(self):
        return {"ok": self._app.tentar_servidor()}

    def entrar_contingencia(self):
        self._app.entrar_contingencia()
        return {"ok": True}

    def abrir_config(self):
        self._app.abrir_tela("config.html")
        return {"ok": True}

    # ------------------------------------------------------------------ login (tela do Gestor)

    def lembrar_login(self, id_usuario, nome, senha):
        """A tela de login do Gestor chama depois do login aceito pelo servidor."""
        try:
            h, sal = senhas.gerar(senha)
            self._app.base.lembrar_usuario(int(id_usuario), str(nome or ""), h, sal)
            return {"ok": True}
        except Exception as err:  # noqa: BLE001
            return _erro(err)

    # ------------------------------------------------------------------ impressoras

    def impressoras(self):
        nomes, padrao = impressao.listar()
        return {"ok": impressao.disponivel(), "lista": nomes, "padrao": padrao, "escolhidas": self._app.cfg.get("impressoras", {})}

    def salvar_impressoras(self, escolha):
        escolha = escolha or {}
        self._app.cfg["impressoras"] = {"a4": str(escolha.get("a4") or ""), "termica": str(escolha.get("termica") or "")}
        config.gravar(self._app.cfg)
        return {"ok": True}

    def imprimir_teste(self, escolha):
        escolha = escolha or {}
        try:
            if escolha.get("termica"):
                texto = "TESTE DE IMPRESSAO\nGestor O.S - 80 mm\n" + "-" * 48 + "\nAcentos: ação, pão, você\n\n\n"
                impressao.imprimir_raw(escolha["termica"], impressao.escpos(texto), "Teste Gestor O.S")
            if escolha.get("a4") or not escolha.get("termica"):
                self._app.imprimir_html(impressao.html_simples("Teste de impressão do Gestor O.S (A4 / meia folha)."), escolha.get("a4") or "")
            return {"ok": True}
        except Exception as err:  # noqa: BLE001
            return _erro(err)

    def imprimir_os(self, id_os, formato, modelo):
        """Chamado pela tela do Gestor (servidor no ar). 80 mm vai cru para a térmica; o resto pelo WebView2."""
        a = self._app
        imp = a.cfg.get("impressoras", {})
        try:
            a.atualizar_cookies()
            if formato == "80" and imp.get("termica"):
                r = a.servidor.get(f"/os/{int(id_os)}")
                if not r.get("ok"):
                    return _erro(r.get("error") or "O.S não encontrada.")
                texto = impressao.texto_80mm(r["os"], a.base.copia("loja") or {}, modelo)
                impressao.imprimir_raw(imp["termica"], impressao.escpos(texto), f"O.S {id_os}")
                return {"ok": True, "mensagem": f"O.S {id_os} enviada para {imp['termica']}."}
            html = a.servidor.texto(f"/os/{int(id_os)}/impressao?formato={formato}&modelo={modelo}")
            a.imprimir_html(html, imp.get("a4") or "")
            destino = imp.get("a4") or "a impressora escolhida na hora"
            return {"ok": True, "mensagem": f"O.S {id_os} enviada para {destino}."}
        except ServidorFora as err:
            return _erro(f"O servidor não respondeu: {err}")
        except Exception as err:  # noqa: BLE001 - impressora desligada, sem papel etc.
            return {"ok": False, "tratado": True, "error": f"Não foi possível imprimir: {err}"}

    # ------------------------------------------------------------------ contingência

    def ctg_usuarios(self):
        return {"ok": True, "usuarios": self._app.base.usuarios()}

    def ctg_login(self, id_usuario, senha):
        u = self._app.base.usuario(int(id_usuario or 0))
        if not u or not senhas.confere(senha, u.get("hash"), u.get("sal")):
            return _erro("Usuário ou senha não conferem.")
        self._app.usuario_ctg = {"id": u["id"], "nome": u["nome"]}
        return {"ok": True, "usuario": self._app.usuario_ctg}

    def ctg_dados(self):
        b = self._app.base
        return {
            "ok": True,
            "statuses": b.copia("statuses", []),
            "tecnicos": [f for f in (b.copia("funcionarios", []) or []) if f.get("tecnico")],
            "limites": b.copia("limites", {}),
            "usuario": self._app.usuario_ctg,
            "copia_em": b.copia("gerado_em"),
        }

    def ctg_listar(self, termo=""):
        if not self._app.usuario_ctg:
            return _erro("Entre com seu usuário.")
        return {"ok": True, "os": self._app.base.listar_os(termo)}

    def ctg_abrir(self, chave):
        o = self._app.base.abrir_os(str(chave))
        if not o:
            return _erro("O.S não encontrada neste computador.")
        return {"ok": True, "os": o, "calculo": calcular(o)}

    def ctg_calcular(self, dados):
        return {"ok": True, "calculo": calcular(dados or {})}

    def ctg_salvar(self, dados):
        a = self._app
        if not a.usuario_ctg:
            return _erro("Entre com seu usuário.")
        msg = conferir_limites(dados or {}, a.base.copia("limites", {}))
        if msg:
            return _erro(msg)
        try:
            r = a.base.salvar_os(dados or {}, a.cfg["maquina"], a.usuario_ctg["nome"])
            return {"ok": True, **r}
        except ValueError as err:
            return _erro(err)

    def ctg_clientes(self, termo):
        return {"ok": True, "clientes": self._app.base.buscar_clientes(termo)}

    def ctg_itens(self, termo, servico):
        return {"ok": True, "itens": self._app.base.buscar_itens(termo, bool(servico))}

    def ctg_imprimir(self, chave, formato, modelo):
        a = self._app
        o = a.base.abrir_os(str(chave))
        if not o:
            return _erro("O.S não encontrada.")
        prov = o.get("_provisorio") if not str(chave).startswith("S") else ""
        texto = impressao.texto_80mm(o, a.base.copia("loja") or {}, modelo, provisorio=prov or "")
        imp = a.cfg.get("impressoras", {})
        try:
            if formato == "80" and imp.get("termica"):
                impressao.imprimir_raw(imp["termica"], impressao.escpos(texto), f"O.S {chave}")
            else:
                a.imprimir_html(impressao.html_simples(texto, f"O.S {chave}"), imp.get("a4") or "")
            return {"ok": True}
        except Exception as err:  # noqa: BLE001
            return _erro(f"Não foi possível imprimir: {err}")

    def ctg_voltar_servidor(self):
        if not self._app.servidor.no_ar():
            return _erro("O servidor ainda não responde.")
        self._app.voltar_ao_servidor()
        return {"ok": True}

    # ------------------------------------------------------------------ sincronização

    def sync_estado(self):
        b = self._app.base
        return {
            "ok": True,
            "pendentes": [{"provisorio": p["provisorio"], "id": p["id_servidor"], "situacao": p["situacao"], "erro": p["erro"],
                           "cliente": (json.loads(p["dados"]).get("cliente") or {}).get("nome", "")} for p in b.pendentes()],
            "conflitos": sincronizacao.conflitos(b),
            "ultimo": self._app.ultimo_relatorio,
        }

    def sync_agora(self):
        rel = self._app.sincronizar(imprimir_resumo=True)
        return {"ok": True, "relatorio": rel}

    def sync_resolver(self, provisorio, escolha):
        self._app.atualizar_cookies()
        try:
            return sincronizacao.resolver(self._app.servidor, self._app.base, provisorio, escolha)
        except ServidorFora as err:
            return _erro(f"O servidor não respondeu: {err}")
