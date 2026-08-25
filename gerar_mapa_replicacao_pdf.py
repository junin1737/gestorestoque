from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle

output_path = r"C:\Work\Pessoal\Projetos\GestorEstoque\Mapa-Replicacao-Importacao.pdf"

doc = SimpleDocTemplate(output_path, pagesize=A4, rightMargin=24, leftMargin=24, topMargin=24, bottomMargin=24)
styles = getSampleStyleSheet()
story = []

story.append(Paragraph("Mapa de Replicacao - Entrada de Nota", styles["Title"]))
story.append(Paragraph("Base analisada: C:/Work/MT/Limpo/Clipp/Base/CLIPP.FDB", styles["Normal"]))
story.append(Paragraph("Comparacao: snapshot antes x depois da importacao", styles["Normal"]))
story.append(Spacer(1, 12))

story.append(Paragraph("Resumo", styles["Heading2"]))
story.append(Paragraph("- Total de tabelas alteradas: 32", styles["Normal"]))
story.append(Paragraph("- Foco para replicacao online: Estoque + Documento de compra + Financeiro + Auditoria", styles["Normal"]))
story.append(Spacer(1, 10))

data = [
    ["Prioridade", "Tabela", "Delta", "Papel na replicacao"],
    ["Alta", "TB_NFCOMPRA", "+1", "Cabecalho da nota de compra"],
    ["Alta", "TB_NFC_ITEM", "+29", "Itens da nota de compra"],
    ["Alta", "TB_NFCOMPRA_FMAPAGTO", "+1", "Forma de pagamento da compra"],
    ["Alta", "TB_NFC_CTAPAG", "+1", "Vinculo financeiro da compra"],
    ["Alta", "TB_ESTOQUE", "+29", "Cadastro principal de produtos"],
    ["Alta", "TB_EST_IDENTIFICADOR", "+29", "Identificador por item/variacao"],
    ["Alta", "TB_EST_PRODUTO", "+29", "Dados comerciais e saldo do produto"],
    ["Alta", "TB_EST_QTD_HISTORICO", "+29", "Historico de movimentacao de quantidade"],
    ["Alta", "TB_MOVDIARIO", "+2", "Movimento diario consolidado"],
    ["Alta", "TB_CONTA_PAGAR", "+1", "Titulo a pagar criado pela entrada"],
    ["Media", "TB_EST_TRIBUTOS", "+29", "Tributacao do produto (NF-e)"],
    ["Media", "TB_EST_TRIBUTOS_NFCE", "+29", "Tributacao do produto (NFC-e)"],
    ["Media", "TB_NFC_ITEM_ICMS", "+29", "Detalhes fiscais ICMS por item"],
    ["Media", "TB_NFC_ITEM_PIS", "+26", "Detalhes fiscais PIS por item"],
    ["Media", "TB_NFC_ITEM_COFINS", "+26", "Detalhes fiscais COFINS por item"],
    ["Media", "TB_NFC_ITEM_IPI", "+19", "Detalhes fiscais IPI por item"],
    ["Media", "TB_NFC_ITEM_ST", "+19", "Detalhes fiscais ST por item"],
    ["Media", "TB_NFC_ITEM_FCP", "+17", "Detalhes fiscais FCP por item"],
    ["Media", "TB_ESTOQUE_FORNECEDOR", "+29", "Vinculo produto-fornecedor"],
    ["Media", "TB_FORNECEDOR", "+2", "Cadastro de fornecedores envolvidos"],
    ["Media", "TB_CTAPAG_MOVTO", "+2", "Movimentacao de contas a pagar"],
    ["Baixa", "TB_PARAMETRO", "+4", "Ajustes de parametros internos"],
    ["Baixa", "TB_ARQUIVOS", "+1", "Metadado de arquivo/importacao"],
    ["Baixa", "TB_TAXA_UF", "+2", "Tabela de taxas por UF"],
    ["Baixa", "TB_USO_RECURSO", "+2", "Controle interno de uso de recurso"],
    ["Baixa", "TB_USO_RECURSO_MODULO", "+2", "Controle interno por modulo"],
    ["Baixa", "TB_FUNC_MOD_COLUNA_SIS", "+176", "Auditoria/config de colunas de modulo"],
    ["Baixa", "TB_FUNC_MOD_PARAMETRO_SIS", "+1", "Auditoria/config de parametro de modulo"],
]

table = Table(data, repeatRows=1, colWidths=[58, 150, 45, 260])
table.setStyle(
    TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1f4e78")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]
    )
)

story.append(table)
story.append(Spacer(1, 10))
story.append(Paragraph("Observacao: As tabelas de prioridade alta devem entrar primeiro no replicador (ordem: documento -> itens -> estoque -> financeiro).", styles["Normal"]))

doc.build(story)
print(output_path)
