"""Impressão direta, sem passar pelo navegador.

- 80 mm (térmica): texto ESC/POS mandado cru (RAW) para a fila do Windows. Sai na hora, sem diálogo.
- A4 e meia folha: o HTML da O.S (o mesmo do Gestor) é impresso pelo WebView2 na impressora escolhida
  (ver App.imprimir_html). Sem impressora escolhida, abre o diálogo de impressão.
"""

import textwrap
from datetime import datetime

from .calculo import calcular, num

LARGURA_80 = 48  # colunas da fonte A numa térmica de 80 mm

try:  # pywin32 só existe no Windows
    import win32print  # type: ignore
except ImportError:  # pragma: no cover - testes fora do Windows
    win32print = None


def disponivel():
    return win32print is not None


def listar():
    if not win32print:
        return [], ""
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    nomes = sorted({p[2] for p in win32print.EnumPrinters(flags)}, key=str.lower)
    try:
        padrao = win32print.GetDefaultPrinter()
    except Exception:  # noqa: BLE001 - sem impressora padrão
        padrao = ""
    return nomes, padrao


def imprimir_raw(impressora, dados, titulo="O.S"):
    if not win32print:
        raise RuntimeError("Impressão direta só funciona no Windows.")
    h = win32print.OpenPrinter(impressora)
    try:
        win32print.StartDocPrinter(h, 1, (titulo, None, "RAW"))
        try:
            win32print.StartPagePrinter(h)
            win32print.WritePrinter(h, dados)
            win32print.EndPagePrinter(h)
        finally:
            win32print.EndDocPrinter(h)
    finally:
        win32print.ClosePrinter(h)


# ---------------------------------------------------------------------------- texto 80 mm

def moeda(v):
    s = f"{num(v):,.2f}"
    return "R$ " + s.replace(",", "X").replace(".", ",").replace("X", ".")


def qtd_txt(v):
    n = num(v)
    return (f"{n:.3f}".rstrip("0").rstrip(".")).replace(".", ",") if n % 1 else str(int(n))


def _linha_valor(rotulo, valor, largura=LARGURA_80):
    esp = max(1, largura - len(rotulo) - len(valor))
    return f"{rotulo}{' ' * esp}{valor}"


def _quebrar(texto, largura=LARGURA_80, recuo=""):
    saida = []
    for par in str(texto or "").splitlines() or [""]:
        saida.extend(textwrap.wrap(par, width=largura, initial_indent=recuo, subsequent_indent=recuo) or [""])
    return saida


def texto_80mm(os_, loja=None, modelo="abertura", provisorio=""):
    """Comprovante da O.S em texto puro, 48 colunas."""
    loja = loja or {}
    fechamento = modelo == "fechamento"
    numero = provisorio or str(os_.get("numero") or os_.get("id") or "")
    linhas = []
    if loja.get("nome"):
        linhas += [s.center(LARGURA_80) for s in _quebrar(loja["nome"])]
    for extra in (loja.get("endereco"), loja.get("telefone")):
        if extra:
            linhas += [s.center(LARGURA_80) for s in _quebrar(extra)]
    linhas.append("=" * LARGURA_80)
    titulo = f"O.S {numero} - {'FECHAMENTO' if fechamento else 'ABERTURA'}"
    linhas.append(titulo.center(LARGURA_80))
    if provisorio:
        linhas.append("(numero provisorio - contingencia)".center(LARGURA_80))
    linhas.append(f"Emissao: {os_.get('emissao_br') or datetime.now().strftime('%d/%m/%Y %H:%M')}")
    linhas.append("-" * LARGURA_80)
    cli = os_.get("cliente") or {}
    linhas += _quebrar(f"Cliente: {cli.get('nome', '')}")
    if cli.get("documento"):
        linhas.append(f"CPF/CNPJ: {cli['documento']}")
    if cli.get("telefone"):
        linhas.append(f"Telefone: {cli['telefone']}")
    if os_.get("quem_trouxe"):
        linhas += _quebrar(f"Quem trouxe: {os_['quem_trouxe']}")
    linhas.append("-" * LARGURA_80)
    linhas += _quebrar(f"Equipamento: {os_.get('equipamento', '')}")
    linhas += _quebrar(f"Defeito: {os_.get('defeito', '')}")
    if os_.get("previsao"):
        p = str(os_["previsao"])[:10].split("-")
        linhas.append(f"Previsao: {'/'.join(reversed(p))}")
    tec = os_.get("tecnico") or {}
    if tec.get("nome"):
        linhas.append(f"Tecnico: {tec['nome']}")
    if fechamento:
        if os_.get("solucao"):
            linhas += _quebrar(f"Solucao: {os_['solucao']}")
        c = calcular(os_)
        if c["itens"]:
            linhas.append("-" * LARGURA_80)
            for it in c["itens"]:
                linhas += _quebrar(it["descricao"])
                linhas.append(_linha_valor(f"  {qtd_txt(it['qtd'])} x {moeda(it['vlr_unit'])}", moeda(it["total"])))
        t = c["totais"]
        linhas.append("-" * LARGURA_80)
        if t["desconto_total"]:
            linhas.append(_linha_valor("Desconto", moeda(t["desconto_total"])))
        if t["acrescimo_total"]:
            linhas.append(_linha_valor("Acrescimo", moeda(t["acrescimo_total"])))
        if t["frete"]:
            linhas.append(_linha_valor("Frete", moeda(t["frete"])))
        if t["deslocamento"]:
            linhas.append(_linha_valor("Deslocamento", moeda(t["deslocamento"])))
        linhas.append(_linha_valor("TOTAL", moeda(t["total"])))
    linhas.append("")
    linhas.append("")
    linhas.append("_" * 34)
    linhas.append("Assinatura do cliente")
    linhas += ["", "", ""]
    return "\n".join(linhas)


def escpos(texto):
    """ESC @ (inicia), ESC t 2 (página CP850, com acento), texto e corte parcial."""
    corpo = texto.replace("\n", "\r\n").encode("cp850", errors="replace")
    return b"\x1b@" + b"\x1bt\x02" + corpo + b"\r\n\x1dV\x42\x00"


def texto_resumo_sync(relatorio, maquina):
    """Resumo impresso depois da sincronização (o que foi enviado e o que ficou pendente)."""
    linhas = ["RESUMO DA SINCRONIZACAO".center(LARGURA_80), f"Computador: {maquina}",
              f"Em: {datetime.now().strftime('%d/%m/%Y %H:%M')}", "-" * LARGURA_80]
    for r in relatorio.get("linhas", []):
        linhas += _quebrar(r)
    linhas += ["-" * LARGURA_80, relatorio.get("titulo", ""), "", "", ""]
    return "\n".join(linhas)


def html_simples(texto, titulo="Gestor O.S"):
    """Para imprimir em A4 o mesmo texto (resumo da sincronização, O.S da contingência)."""
    esc = texto.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return (f"<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'><title>{titulo}</title>"
            "<style>@page{margin:12mm}body{font:12px/1.45 Consolas,'Courier New',monospace;color:#111}pre{white-space:pre-wrap;margin:0}</style>"
            f"</head><body><pre>{esc}</pre></body></html>")
