"""Cálculo da O.S: o mesmo de server/os.js (calcular, ratear e lerItensEntrada).

Usado só na contingência, para a tela e a impressão mostrarem os mesmos totais que o
servidor vai gravar na sincronização. O servidor recalcula tudo ao receber.
"""

import math


def num(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0.0
    return n if math.isfinite(n) else 0.0


def r2(v):
    """Arredonda como o Math.round do JavaScript (meio para cima), em centavos."""
    return math.floor(num(v) * 100 + 0.5) / 100


def ler_itens(lista):
    itens = []
    for i, it in enumerate(lista or []):
        tipo = "S" if it.get("tipo") == "S" else "P"
        qtd_bruta = num(it.get("qtd"))
        qtd = (qtd_bruta if qtd_bruta > 0 else 1) if tipo == "S" else qtd_bruta
        vlr = max(0.0, num(it.get("vlr_unit")))
        bruto = r2(qtd * vlr)
        item = {
            "seq": i + 1,
            "id_identificador": int(num(it.get("id_identificador"))),
            "descricao": str(it.get("descricao") or "")[:200].strip(),
            "tipo": tipo,
            "unidade": (str(it.get("unidade") or "").strip()[:6]) or "UN",
            "qtd": qtd,
            "vlr_unit": vlr,
            "desc_item": min(bruto, max(0.0, r2(it.get("desc_item")))),
            "acres_item": max(0.0, r2(it.get("acres_item"))),
        }
        if item["id_identificador"] > 0 and item["qtd"] > 0:
            itens.append(item)
    return itens


def _base(it):
    return r2(num(it.get("qtd")) * num(it.get("vlr_unit")) - num(it.get("desc_item")) + num(it.get("acres_item")))


def ratear(itens, valor, campo):
    total = sum(max(0.0, _base(it)) for it in itens)
    for it in itens:
        it[campo] = 0.0
    v = r2(valor)
    if not (v > 0) or not (total > 0):
        return
    soma = 0.0
    for it in itens:
        it[campo] = r2(v * max(0.0, _base(it)) / total)
        soma = r2(soma + it[campo])
    resto = r2(v - soma)
    if resto:
        maior = itens[0]
        for b in itens[1:]:
            if _base(b) > _base(maior):
                maior = b
        maior[campo] = r2(maior[campo] + resto)


def calcular(os_):
    itens = [dict(it) for it in (os_.get("itens") or [])]
    ratear(itens, os_.get("desc_geral"), "rateio_desc")
    ratear(itens, os_.get("acres_geral"), "rateio_acres")
    bruto_p = bruto_s = desc_itens = acres_itens = 0.0
    for it in itens:
        bruto = r2(num(it.get("qtd")) * num(it.get("vlr_unit")))
        if it.get("tipo") == "S":
            bruto_s = r2(bruto_s + bruto)
        else:
            bruto_p = r2(bruto_p + bruto)
        desc_itens = r2(desc_itens + num(it.get("desc_item")))
        acres_itens = r2(acres_itens + num(it.get("acres_item")))
        it["total"] = r2(_base(it) - num(it.get("rateio_desc")) + num(it.get("rateio_acres")))
    desc_total = r2(desc_itens + num(os_.get("desc_geral")))
    acres_total = r2(acres_itens + num(os_.get("acres_geral")))
    total = r2(bruto_p + bruto_s - desc_total + acres_total + num(os_.get("frete")) + num(os_.get("deslocamento")))
    return {
        "itens": itens,
        "totais": {
            "bruto_produtos": bruto_p,
            "bruto_servicos": bruto_s,
            "desconto_total": desc_total,
            "acrescimo_total": acres_total,
            "frete": r2(os_.get("frete")),
            "deslocamento": r2(os_.get("deslocamento")),
            "total": max(0.0, total),
        },
    }


def pct_desconto(it):
    bruto = r2(num(it.get("qtd")) * num(it.get("vlr_unit")))
    return (num(it.get("desc_item")) / bruto * 100) if bruto > 0 else 0.0


def conferir_limites(os_, limites):
    """Sem servidor não há senha de liberação: desconto acima do limite fica bloqueado na contingência."""
    lim_item = num((limites or {}).get("item"))
    lim_geral = num((limites or {}).get("geral"))
    if lim_item > 0:
        for it in os_.get("itens") or []:
            if pct_desconto(it) > lim_item + 1e-9:
                return f"Desconto em \"{it.get('descricao')}\" passa de {lim_item:g}%. Na contingência não dá para liberar com senha."
    if lim_geral > 0:
        c = calcular({**os_, "desc_geral": 0, "acres_geral": 0})
        base = sum(max(0.0, num(i.get("total"))) for i in c["itens"])
        if base > 0 and num(os_.get("desc_geral")) / base * 100 > lim_geral + 1e-9:
            return f"Desconto geral passa de {lim_geral:g}%. Na contingência não dá para liberar com senha."
    return ""
