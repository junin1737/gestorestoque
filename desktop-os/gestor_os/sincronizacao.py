"""Sincronização das O.S da contingência quando o servidor volta.

O servidor responde cada O.S separadamente:
- criada / ja_sincronizada: ganhou o número definitivo; a local sai da fila.
- atualizada: a alteração feita aqui foi gravada.
- conflito: a mesma O.S mudou no servidor depois da cópia. Fica esperando o usuário escolher
  entre a versão daqui e a do servidor (tela de sincronização). Tudo vai para o histórico da O.S.
- erro: fica na fila com o motivo (ex.: desconto acima do limite), para corrigir e mandar de novo.
"""

import json

from .servidor import ServidorFora


def montar_envio(pendentes):
    itens = []
    for p in pendentes:
        dados = json.loads(p["dados"])
        for k in ("_chave", "_provisorio", "cliente", "tecnico", "total", "emissao_br", "id"):
            dados.pop(k, None)
        itens.append({
            "provisorio": p["provisorio"],
            "id": p["id_servidor"] or None,
            "versao": p["versao_base"] or None,
            "dados": dados,
        })
    return itens


def sincronizar(servidor, base):
    """Manda tudo o que está pendente. Devolve o relatório para a tela e para o resumo impresso."""
    pendentes = base.pendentes()
    relatorio = {"titulo": "", "linhas": [], "conflitos": [], "enviadas": 0, "erros": 0}
    if not pendentes:
        relatorio["titulo"] = "Nada para sincronizar."
        return relatorio
    try:
        r = servidor.post("/os/desktop/sincronizar", {"itens": montar_envio(pendentes)}, tempo=120)
    except ServidorFora as err:
        relatorio["titulo"] = f"O servidor não respondeu: {err}"
        relatorio["erros"] = len(pendentes)
        return relatorio
    if not r.get("ok"):
        relatorio["titulo"] = r.get("error") or "O servidor recusou a sincronização."
        relatorio["erros"] = len(pendentes)
        return relatorio
    for res in r.get("resultados", []):
        prov = res.get("provisorio")
        situacao = res.get("status")
        if situacao in ("criada", "ja_sincronizada"):
            base.marcar(prov, "sincronizada", None, res.get("id"))
            relatorio["linhas"].append(f"{prov} -> O.S {res.get('id')} (nova)")
            relatorio["enviadas"] += 1
        elif situacao == "atualizada":
            base.marcar(prov, "sincronizada", None, res.get("id"))
            relatorio["linhas"].append(f"O.S {res.get('id')}: alteracao enviada")
            relatorio["enviadas"] += 1
        elif situacao == "conflito":
            base.marcar(prov, "conflito", json.dumps(res.get("servidor") or {}, ensure_ascii=False))
            relatorio["linhas"].append(f"O.S {res.get('id')}: alterada tambem no servidor - escolher a versao")
            relatorio["conflitos"].append(prov)
        else:
            base.marcar(prov, "erro", res.get("erro") or "Erro na sincronização.")
            relatorio["linhas"].append(f"{prov}: NAO enviada - {res.get('erro')}")
            relatorio["erros"] += 1
    partes = [f"{relatorio['enviadas']} enviada(s)"]
    if relatorio["conflitos"]:
        partes.append(f"{len(relatorio['conflitos'])} com conflito")
    if relatorio["erros"]:
        partes.append(f"{relatorio['erros']} com erro")
    relatorio["titulo"] = "Sincronização: " + ", ".join(partes) + "."
    base.registrar_sync(relatorio)
    base.limpar_sincronizadas()
    return relatorio


def conflitos(base):
    with base._trava:  # noqa: SLF001 - leitura simples da própria base
        rows = base.con.execute("SELECT * FROM os_local WHERE situacao = 'conflito' ORDER BY criado_em").fetchall()
    lista = []
    for r in rows:
        try:
            servidor = json.loads(r["erro"] or "{}")
        except ValueError:
            servidor = {}
        lista.append({"provisorio": r["provisorio"], "id": r["id_servidor"], "local": json.loads(r["dados"]), "servidor": servidor})
    return lista


def resolver(servidor, base, provisorio, escolha):
    """escolha 'local': grava a versão daqui por cima. 'servidor': descarta a daqui."""
    with base._trava:  # noqa: SLF001
        r = base.con.execute("SELECT * FROM os_local WHERE provisorio = ?", (provisorio,)).fetchone()
    if not r:
        return {"ok": False, "error": "Esta O.S não está mais na fila."}
    if escolha == "servidor":
        resp = servidor.post("/os/desktop/manter-servidor", {"id": r["id_servidor"], "provisorio": provisorio})
        if not resp.get("ok"):
            return {"ok": False, "error": resp.get("error") or "O servidor não registrou a escolha."}
        base.remover_local(provisorio)
        return {"ok": True}
    envio = montar_envio([dict(r)])[0]
    envio["forcar"] = True
    resp = servidor.post("/os/desktop/sincronizar", {"itens": [envio]}, tempo=60)
    res = (resp.get("resultados") or [{}])[0] if resp.get("ok") else {"status": "erro", "erro": resp.get("error")}
    if res.get("status") in ("atualizada", "criada", "ja_sincronizada"):
        base.remover_local(provisorio)
        return {"ok": True}
    base.marcar(provisorio, "erro", res.get("erro") or "Erro ao gravar a versão deste computador.")
    return {"ok": False, "error": res.get("erro") or "Erro ao gravar."}
