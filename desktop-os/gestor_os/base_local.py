"""Base temporária do computador (SQLite) para a contingência.

- copia: o que o servidor mandou da última vez (clientes, itens, técnicos, status, O.S em aberto).
- os_local: O.S abertas ou alteradas em contingência, esperando a sincronização.
- usuarios: hash da senha de quem já entrou no app neste computador (login sem servidor).
"""

import json
import sqlite3
import threading
import unicodedata
from datetime import datetime

from .calculo import calcular, ler_itens

ESQUEMA = """
CREATE TABLE IF NOT EXISTS copia (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clientes (id INTEGER PRIMARY KEY, nome TEXT, documento TEXT, telefone TEXT, endereco TEXT, busca TEXT);
CREATE TABLE IF NOT EXISTS itens (id INTEGER PRIMARY KEY, descricao TEXT, servico INTEGER, unidade TEXT, preco REAL, cod_barras TEXT, referencia TEXT, busca TEXT);
CREATE TABLE IF NOT EXISTS os_servidor (id INTEGER PRIMARY KEY, versao INTEGER, dados TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS os_local (
  provisorio TEXT PRIMARY KEY,
  id_servidor INTEGER,
  versao_base INTEGER,
  dados TEXT NOT NULL,
  criado_em TEXT,
  alterado_em TEXT,
  usuario TEXT,
  situacao TEXT DEFAULT 'pendente',
  erro TEXT
);
CREATE TABLE IF NOT EXISTS sequencia (maquina TEXT PRIMARY KEY, ultimo INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS usuarios (id INTEGER PRIMARY KEY, nome TEXT, hash TEXT, sal TEXT, visto_em TEXT);
CREATE TABLE IF NOT EXISTS historico_sync (id INTEGER PRIMARY KEY AUTOINCREMENT, em TEXT, resumo TEXT);
CREATE INDEX IF NOT EXISTS ix_clientes_busca ON clientes(busca);
CREATE INDEX IF NOT EXISTS ix_itens_busca ON itens(busca);
"""


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s or "")) if unicodedata.category(c) != "Mn").upper()


def so_digitos(s):
    return "".join(ch for ch in str(s or "") if ch.isdigit())


def agora():
    return datetime.now().strftime("%Y-%m-%dT%H:%M:%S")


class BaseLocal:
    def __init__(self, caminho):
        self.caminho = str(caminho)
        self._trava = threading.RLock()
        self.con = sqlite3.connect(self.caminho, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        with self._trava:
            self.con.executescript(ESQUEMA)
            self.con.commit()

    # ------------------------------------------------------------------ cópia do servidor

    def guardar_copia(self, dados):
        """Troca a cópia inteira de uma vez (transação): ou fica a nova, ou fica a anterior."""
        with self._trava, self.con:
            c = self.con
            c.execute("DELETE FROM clientes")
            c.executemany(
                "INSERT INTO clientes (id, nome, documento, telefone, endereco, busca) VALUES (?, ?, ?, ?, ?, ?)",
                [(x["id"], x.get("nome", ""), x.get("documento", ""), x.get("telefone", ""), x.get("endereco", ""),
                  f"{sem_acento(x.get('nome'))} {so_digitos(x.get('documento'))} {x['id']}") for x in dados.get("clientes", [])],
            )
            c.execute("DELETE FROM itens")
            c.executemany(
                "INSERT INTO itens (id, descricao, servico, unidade, preco, cod_barras, referencia, busca) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [(x["id"], x.get("descricao", ""), 1 if x.get("servico") else 0, x.get("unidade", "UN"), x.get("preco", 0),
                  x.get("cod_barras", ""), x.get("referencia", ""),
                  f"{sem_acento(x.get('descricao'))} {sem_acento(x.get('referencia'))} {x.get('cod_barras', '')} {x['id']}")
                 for x in dados.get("itens", [])],
            )
            c.execute("DELETE FROM os_servidor")
            c.executemany(
                "INSERT INTO os_servidor (id, versao, dados) VALUES (?, ?, ?)",
                [(o["id"], int(o.get("versao") or 0), json.dumps(o, ensure_ascii=False)) for o in dados.get("os", [])],
            )
            for chave in ("funcionarios", "statuses", "limites", "perfil", "loja", "tema"):
                c.execute("INSERT OR REPLACE INTO copia (chave, valor) VALUES (?, ?)", (chave, json.dumps(dados.get(chave), ensure_ascii=False)))
            c.execute("INSERT OR REPLACE INTO copia (chave, valor) VALUES ('gerado_em', ?)", (json.dumps(dados.get("gerado_em") or agora()),))

    def copia(self, chave, padrao=None):
        with self._trava:
            r = self.con.execute("SELECT valor FROM copia WHERE chave = ?", (chave,)).fetchone()
        if not r:
            return padrao
        try:
            return json.loads(r["valor"])
        except ValueError:
            return padrao

    def tem_copia(self):
        return self.copia("gerado_em") is not None

    # ------------------------------------------------------------------ buscas da tela

    def buscar_clientes(self, termo, limite=12):
        t = str(termo or "").strip()
        if not t:
            return []
        with self._trava:
            if t.isdigit() and len(t) <= 9:
                rows = self.con.execute("SELECT * FROM clientes WHERE id = ? UNION ALL SELECT * FROM clientes WHERE busca LIKE ? AND id <> ? LIMIT ?",
                                        (int(t), f"%{t}%", int(t), limite)).fetchall()
            else:
                d = so_digitos(t)
                if len(d) in (11, 14):
                    rows = self.con.execute("SELECT * FROM clientes WHERE busca LIKE ? LIMIT ?", (f"%{d}%", limite)).fetchall()
                else:
                    partes = [p for p in sem_acento(t).split() if p]
                    sql = "SELECT * FROM clientes WHERE " + " AND ".join("busca LIKE ?" for _ in partes) + " ORDER BY nome LIMIT ?"
                    rows = self.con.execute(sql, [f"%{p}%" for p in partes] + [limite]).fetchall()
        return [dict(r) for r in rows]

    def cliente(self, id_cliente):
        with self._trava:
            r = self.con.execute("SELECT * FROM clientes WHERE id = ?", (int(id_cliente or 0),)).fetchone()
        return dict(r) if r else None

    def buscar_itens(self, termo, servico, limite=25):
        t = str(termo or "").strip()
        if not t:
            return []
        flag = 1 if servico else 0
        with self._trava:
            if t.isdigit():
                rows = self.con.execute("SELECT * FROM itens WHERE servico = ? AND (id = ? OR cod_barras = ?) LIMIT ?",
                                        (flag, int(t) if len(t) < 10 else -1, t, limite)).fetchall()
                if rows:
                    return [dict(r) for r in rows]
            partes = [p for p in sem_acento(t).split() if p]
            sql = "SELECT * FROM itens WHERE servico = ? AND " + " AND ".join("busca LIKE ?" for _ in partes) + " ORDER BY descricao LIMIT ?"
            rows = self.con.execute(sql, [flag] + [f"%{p}%" for p in partes] + [limite]).fetchall()
        return [dict(r) for r in rows]

    # ------------------------------------------------------------------ O.S

    def proximo_provisorio(self, maquina):
        """C-CAIXA01-0001: o nome do computador evita repetir o número de outro computador."""
        with self._trava, self.con:
            r = self.con.execute("SELECT ultimo FROM sequencia WHERE maquina = ?", (maquina,)).fetchone()
            n = (r["ultimo"] if r else 0) + 1
            self.con.execute("INSERT OR REPLACE INTO sequencia (maquina, ultimo) VALUES (?, ?)", (maquina, n))
        return f"C-{maquina}-{n:04d}"

    def listar_os(self, termo=""):
        """O.S do servidor (cópia) com as alterações locais por cima, e as novas da contingência."""
        with self._trava:
            servidor = {r["id"]: json.loads(r["dados"]) for r in self.con.execute("SELECT * FROM os_servidor")}
            locais = [dict(r) for r in self.con.execute("SELECT * FROM os_local ORDER BY criado_em")]
        lista = []
        alteradas = {l["id_servidor"]: l for l in locais if l["id_servidor"]}
        for id_, o in servidor.items():
            loc = alteradas.get(id_)
            dados = json.loads(loc["dados"]) if loc else o
            lista.append(self._resumo(dados, chave=f"S{id_}", numero=str(id_), local=loc))
        for l in locais:
            if l["id_servidor"]:
                continue
            lista.append(self._resumo(json.loads(l["dados"]), chave=l["provisorio"], numero=l["provisorio"], local=l))
        t = sem_acento(termo).strip()
        if t:
            lista = [o for o in lista if t in sem_acento(f"{o['numero']} {o['cliente']} {o['equipamento']}")]
        return lista

    @staticmethod
    def _resumo(o, chave, numero, local):
        cli = o.get("cliente") or {}
        return {
            "chave": chave,
            "numero": numero,
            "cliente": cli.get("nome") or o.get("cli_nome") or "",
            "equipamento": o.get("equipamento", ""),
            "id_status": o.get("id_status"),
            "tecnico": (o.get("tecnico") or {}).get("nome", "") if isinstance(o.get("tecnico"), dict) else "",
            "previsao": o.get("previsao", ""),
            "pendente": bool(local and local["situacao"] != "sincronizada"),
            "situacao": local["situacao"] if local else "servidor",
            "erro": local["erro"] if local else "",
        }

    def abrir_os(self, chave):
        with self._trava:
            if chave.startswith("S") and chave[1:].isdigit():
                id_ = int(chave[1:])
                loc = self.con.execute("SELECT * FROM os_local WHERE id_servidor = ?", (id_,)).fetchone()
                if loc:
                    return {**json.loads(loc["dados"]), "_chave": chave, "_provisorio": loc["provisorio"]}
                r = self.con.execute("SELECT dados FROM os_servidor WHERE id = ?", (id_,)).fetchone()
                return {**json.loads(r["dados"]), "_chave": chave} if r else None
            loc = self.con.execute("SELECT * FROM os_local WHERE provisorio = ?", (chave,)).fetchone()
            return {**json.loads(loc["dados"]), "_chave": chave, "_provisorio": chave} if loc else None

    def salvar_os(self, dados, maquina, usuario):
        """Grava na base do computador. O.S do servidor alterada aqui guarda a versão que tinha (conflito)."""
        chave = dados.get("_chave") or ""
        itens = ler_itens(dados.get("itens"))
        cli = self.cliente(dados.get("id_cliente")) or dados.get("cliente") or {}
        limpo = {
            "tipo": "E" if dados.get("tipo") == "E" else "I",
            "modalidade": "R" if dados.get("modalidade") == "R" else "P",
            "id_status": int(dados.get("id_status") or 0) or None,
            "id_tecnico": int(dados.get("id_tecnico") or 0) or None,
            "quem_trouxe": str(dados.get("quem_trouxe") or "")[:100],
            "equipamento": str(dados.get("equipamento") or "")[:300].strip(),
            "defeito": str(dados.get("defeito") or "")[:2000].strip(),
            "solucao": str(dados.get("solucao") or "")[:2000],
            "obs": str(dados.get("obs") or "")[:1000],
            "previsao": str(dados.get("previsao") or "")[:10],
            "entrega": str(dados.get("entrega") or "")[:16],
            "id_cliente": int(dados.get("id_cliente") or 0),
            "cliente": {"id": cli.get("id"), "nome": cli.get("nome", ""), "documento": cli.get("documento", ""),
                        "telefone": cli.get("telefone", ""), "endereco": cli.get("endereco", "")},
            "desc_geral": max(0.0, float(dados.get("desc_geral") or 0)),
            "acres_geral": max(0.0, float(dados.get("acres_geral") or 0)),
            "frete": max(0.0, float(dados.get("frete") or 0)),
            "deslocamento": max(0.0, float(dados.get("deslocamento") or 0)),
            "itens": itens,
        }
        if not limpo["id_cliente"]:
            raise ValueError("Escolha o cliente.")
        if not limpo["equipamento"]:
            raise ValueError("Descreva o equipamento.")
        if not limpo["defeito"]:
            raise ValueError("Descreva o defeito apresentado.")
        tec = next((f for f in (self.copia("funcionarios") or []) if f.get("id") == limpo["id_tecnico"]), None)
        limpo["tecnico"] = {"id": tec["id"], "nome": tec["nome"]} if tec else None
        limpo["total"] = calcular(limpo)["totais"]["total"]
        with self._trava, self.con:
            if chave.startswith("S") and chave[1:].isdigit():
                id_ = int(chave[1:])
                loc = self.con.execute("SELECT provisorio, versao_base FROM os_local WHERE id_servidor = ?", (id_,)).fetchone()
                if loc:
                    provisorio = loc["provisorio"]
                    self.con.execute("UPDATE os_local SET dados = ?, alterado_em = ?, situacao = 'pendente', erro = NULL WHERE provisorio = ?",
                                     (json.dumps({**limpo, "id": id_}, ensure_ascii=False), agora(), provisorio))
                else:
                    srv = self.con.execute("SELECT versao, dados FROM os_servidor WHERE id = ?", (id_,)).fetchone()
                    if not srv:
                        raise ValueError("O.S não encontrada na cópia deste computador.")
                    if json.loads(srv["dados"]).get("id_pedido"):
                        raise ValueError("Esta O.S já foi para a venda: na contingência só dá para consultar.")
                    provisorio = f"A-{maquina}-{id_}"
                    self.con.execute(
                        "INSERT INTO os_local (provisorio, id_servidor, versao_base, dados, criado_em, alterado_em, usuario) VALUES (?, ?, ?, ?, ?, ?, ?)",
                        (provisorio, id_, srv["versao"], json.dumps({**limpo, "id": id_}, ensure_ascii=False), agora(), agora(), usuario))
                return {"chave": chave, "numero": str(id_)}
            if chave:
                self.con.execute("UPDATE os_local SET dados = ?, alterado_em = ?, situacao = 'pendente', erro = NULL WHERE provisorio = ?",
                                 (json.dumps(limpo, ensure_ascii=False), agora(), chave))
                return {"chave": chave, "numero": chave}
        provisorio = self.proximo_provisorio(maquina)
        with self._trava, self.con:
            self.con.execute(
                "INSERT INTO os_local (provisorio, id_servidor, versao_base, dados, criado_em, alterado_em, usuario) VALUES (?, NULL, NULL, ?, ?, ?, ?)",
                (provisorio, json.dumps({**limpo, "emissao_br": datetime.now().strftime("%d/%m/%Y %H:%M")}, ensure_ascii=False), agora(), agora(), usuario))
        return {"chave": provisorio, "numero": provisorio}

    # ------------------------------------------------------------------ sincronização

    def pendentes(self):
        with self._trava:
            rows = self.con.execute("SELECT * FROM os_local WHERE situacao IN ('pendente', 'erro') ORDER BY criado_em").fetchall()
        return [dict(r) for r in rows]

    def marcar(self, provisorio, situacao, erro=None, id_servidor=None):
        with self._trava, self.con:
            if id_servidor:
                self.con.execute("UPDATE os_local SET situacao = ?, erro = ?, id_servidor = COALESCE(id_servidor, ?) WHERE provisorio = ?",
                                 (situacao, erro, id_servidor, provisorio))
            else:
                self.con.execute("UPDATE os_local SET situacao = ?, erro = ? WHERE provisorio = ?", (situacao, erro, provisorio))

    def remover_local(self, provisorio):
        with self._trava, self.con:
            self.con.execute("DELETE FROM os_local WHERE provisorio = ?", (provisorio,))

    def limpar_sincronizadas(self):
        with self._trava, self.con:
            self.con.execute("DELETE FROM os_local WHERE situacao = 'sincronizada'")

    def registrar_sync(self, resumo):
        with self._trava, self.con:
            self.con.execute("INSERT INTO historico_sync (em, resumo) VALUES (?, ?)", (agora(), json.dumps(resumo, ensure_ascii=False)))

    # ------------------------------------------------------------------ usuários (login sem servidor)

    def lembrar_usuario(self, id_, nome, hash_, sal):
        with self._trava, self.con:
            self.con.execute("INSERT OR REPLACE INTO usuarios (id, nome, hash, sal, visto_em) VALUES (?, ?, ?, ?, ?)",
                             (int(id_), nome, hash_, sal, agora()))

    def usuarios(self):
        with self._trava:
            return [dict(r) for r in self.con.execute("SELECT id, nome, visto_em FROM usuarios ORDER BY nome")]

    def usuario(self, id_):
        with self._trava:
            r = self.con.execute("SELECT * FROM usuarios WHERE id = ?", (int(id_),)).fetchone()
        return dict(r) if r else None
