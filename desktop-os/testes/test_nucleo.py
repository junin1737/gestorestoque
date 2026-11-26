"""Testes do núcleo do app desktop (sem janela e sem servidor).

    cd desktop-os
    python -m unittest discover -s testes -v
"""

import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gestor_os import atualizacao, config, impressao, senhas, sincronizacao  # noqa: E402
from gestor_os.base_local import BaseLocal  # noqa: E402
from gestor_os.calculo import calcular, conferir_limites, ler_itens, r2  # noqa: E402

COPIA = {
    "gerado_em": "2026-11-26T10:00:00Z",
    "funcionarios": [{"id": 3, "nome": "RAFAEL SOUZA", "tecnico": True}],
    "statuses": [{"id": 1, "descricao": "Aberta", "ativo": True, "final": False}, {"id": 7, "descricao": "Finalizada", "ativo": True, "final": True}],
    "limites": {"item": 10, "geral": 10},
    "loja": {"nome": "Loja Exemplo", "endereco": "Rua 1", "telefone": "(62) 3333-4444"},
    "tema": "escuro",
    "clientes": [{"id": 2391, "nome": "Mariana Álves", "documento": "123.456.789-09", "telefone": "(62) 99812-4410", "endereco": "Rua 12"}],
    "itens": [
        {"id": 418, "descricao": "SSD Kingston 480GB", "servico": False, "unidade": "UN", "preco": 300, "cod_barras": "789", "referencia": "SNV2"},
        {"id": 9001, "descricao": "Formatação", "servico": True, "unidade": "UN", "preco": 100, "cod_barras": "", "referencia": ""},
    ],
    "os": [{"id": 1284, "versao": 1700000000000, "id_status": 1, "equipamento": "Notebook", "defeito": "Não liga",
            "cliente": {"id": 2391, "nome": "Mariana Álves"}, "id_cliente": 2391, "itens": [], "id_pedido": None}],
}


def os_exemplo(**extra):
    base = {"id_cliente": 2391, "equipamento": "Notebook", "defeito": "Não liga", "id_status": 1, "id_tecnico": 3,
            "itens": [{"id_identificador": 418, "descricao": "SSD", "tipo": "P", "qtd": 1, "vlr_unit": 300},
                      {"id_identificador": 9001, "descricao": "Formatação", "tipo": "S", "qtd": 0, "vlr_unit": 100}],
            "desc_geral": 40}
    base.update(extra)
    return base


class Calculo(unittest.TestCase):
    def test_rateio_do_exemplo_da_especificacao(self):
        c = calcular({"itens": ler_itens(os_exemplo()["itens"]), "desc_geral": 40})
        self.assertEqual([i["rateio_desc"] for i in c["itens"]], [30.0, 10.0])
        self.assertEqual(c["totais"]["total"], 360.0)

    def test_centavos_fecham_no_maior_item(self):
        itens = ler_itens([{"id_identificador": 1, "tipo": "P", "qtd": 1, "vlr_unit": 10},
                           {"id_identificador": 2, "tipo": "P", "qtd": 1, "vlr_unit": 10},
                           {"id_identificador": 3, "tipo": "P", "qtd": 1, "vlr_unit": 10}])
        c = calcular({"itens": itens, "desc_geral": 10})
        self.assertAlmostEqual(sum(i["rateio_desc"] for i in c["itens"]), 10.0)

    def test_servico_sem_quantidade_vira_um(self):
        self.assertEqual(ler_itens([{"id_identificador": 9, "tipo": "S", "qtd": 0, "vlr_unit": 50}])[0]["qtd"], 1)

    def test_arredonda_como_javascript(self):
        self.assertEqual(r2(0.125), 0.13)
        self.assertEqual(r2(2.675), 2.68)

    def test_limite_bloqueia_na_contingencia(self):
        msg = conferir_limites({"itens": [{"descricao": "SSD", "qtd": 1, "vlr_unit": 100, "desc_item": 20}]}, {"item": 10})
        self.assertIn("passa de 10%", msg)
        self.assertEqual(conferir_limites({"itens": [{"descricao": "SSD", "qtd": 1, "vlr_unit": 100, "desc_item": 5}]}, {"item": 10}), "")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = BaseLocal(os.path.join(self.tmp.name, "t.db"))
        self.base.guardar_copia(COPIA)

    def tearDown(self):
        self.base.con.close()
        self.tmp.cleanup()

    def test_busca_sem_acento_documento_e_codigo(self):
        self.assertEqual(self.base.buscar_clientes("mariana alves")[0]["id"], 2391)
        self.assertEqual(self.base.buscar_clientes("12345678909")[0]["id"], 2391)
        self.assertEqual(self.base.buscar_clientes("2391")[0]["id"], 2391)
        self.assertEqual(self.base.buscar_itens("ssd", False)[0]["id"], 418)
        self.assertEqual(self.base.buscar_itens("format", True)[0]["id"], 9001)
        self.assertEqual(self.base.buscar_itens("format", False), [])

    def test_numero_provisorio_por_computador(self):
        self.assertEqual(self.base.proximo_provisorio("CAIXA01"), "C-CAIXA01-0001")
        self.assertEqual(self.base.proximo_provisorio("CAIXA01"), "C-CAIXA01-0002")
        self.assertEqual(self.base.proximo_provisorio("BALCAO"), "C-BALCAO-0001")

    def test_nova_e_alterada_entram_na_fila(self):
        r = self.base.salvar_os(os_exemplo(), "CAIXA01", "Ana")
        self.assertEqual(r["numero"], "C-CAIXA01-0001")
        r2_ = self.base.salvar_os({**os_exemplo(), "_chave": "S1284", "solucao": "Troca do SSD"}, "CAIXA01", "Ana")
        self.assertEqual(r2_["numero"], "1284")
        pend = self.base.pendentes()
        self.assertEqual(len(pend), 2)
        alterada = [p for p in pend if p["id_servidor"] == 1284][0]
        self.assertEqual(alterada["versao_base"], 1700000000000)
        lista = self.base.listar_os()
        self.assertEqual({o["numero"] for o in lista}, {"1284", "C-CAIXA01-0001"})
        self.assertTrue(all(o["pendente"] for o in lista))
        aberta = self.base.abrir_os("S1284")
        self.assertEqual(aberta["solucao"], "Troca do SSD")

    def test_campos_obrigatorios(self):
        with self.assertRaises(ValueError):
            self.base.salvar_os({**os_exemplo(), "equipamento": ""}, "PC", "Ana")

    def test_os_ja_na_venda_nao_altera(self):
        copia = json.loads(json.dumps(COPIA))
        copia["os"][0]["id_pedido"] = 55
        self.base.guardar_copia(copia)
        with self.assertRaises(ValueError):
            self.base.salvar_os({**os_exemplo(), "_chave": "S1284"}, "PC", "Ana")


class ServidorFalso:
    def __init__(self, resultados):
        self.resultados = resultados
        self.enviado = None

    def post(self, caminho, corpo, tempo=0):
        self.enviado = (caminho, corpo)
        if caminho.endswith("manter-servidor"):
            return {"ok": True}
        return {"ok": True, "resultados": self.resultados(corpo)}


class Sincronizacao(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = BaseLocal(os.path.join(self.tmp.name, "t.db"))
        self.base.guardar_copia(COPIA)
        self.base.salvar_os(os_exemplo(), "PC", "Ana")
        self.base.salvar_os({**os_exemplo(), "_chave": "S1284"}, "PC", "Ana")

    def tearDown(self):
        self.base.con.close()
        self.tmp.cleanup()

    def test_envia_e_trata_conflito(self):
        def resp(corpo):
            out = []
            for it in corpo["itens"]:
                if it["id"]:
                    out.append({"provisorio": it["provisorio"], "status": "conflito", "id": it["id"], "servidor": {"id": 1284, "equipamento": "Notebook (servidor)"}})
                else:
                    out.append({"provisorio": it["provisorio"], "status": "criada", "id": 1300})
            return out
        srv = ServidorFalso(resp)
        rel = sincronizacao.sincronizar(srv, self.base)
        enviados = srv.enviado[1]["itens"]
        self.assertTrue(all("cliente" not in e["dados"] for e in enviados))
        nova = [e for e in enviados if not e["id"]][0]
        self.assertEqual(nova["provisorio"], "C-PC-0001")
        self.assertEqual(rel["enviadas"], 1)
        self.assertEqual(len(rel["conflitos"]), 1)
        conf = sincronizacao.conflitos(self.base)
        self.assertEqual(conf[0]["servidor"]["equipamento"], "Notebook (servidor)")
        r = sincronizacao.resolver(srv, self.base, conf[0]["provisorio"], "servidor")
        self.assertTrue(r["ok"])
        self.assertEqual(self.base.pendentes(), [])

    def test_resolver_ficando_com_a_local_forca(self):
        srv = ServidorFalso(lambda corpo: [{"provisorio": it["provisorio"], "status": "conflito" if it["id"] and not it.get("forcar") else "atualizada", "id": it["id"] or 1301} for it in corpo["itens"]])
        sincronizacao.sincronizar(srv, self.base)
        prov = sincronizacao.conflitos(self.base)[0]["provisorio"]
        r = sincronizacao.resolver(srv, self.base, prov, "local")
        self.assertTrue(r["ok"])
        self.assertTrue(srv.enviado[1]["itens"][0]["forcar"])

    def test_erro_fica_na_fila(self):
        srv = ServidorFalso(lambda corpo: [{"provisorio": it["provisorio"], "status": "erro", "erro": "Desconto acima do limite"} for it in corpo["itens"]])
        rel = sincronizacao.sincronizar(srv, self.base)
        self.assertEqual(rel["erros"], 2)
        self.assertEqual({p["situacao"] for p in self.base.pendentes()}, {"erro"})


class Outros(unittest.TestCase):
    def test_endereco_do_servidor(self):
        self.assertEqual(config.normalizar_servidor("192.168.0.10"), "http://192.168.0.10:5077")
        self.assertEqual(config.normalizar_servidor("192.168.0.10:6000/"), "http://192.168.0.10:6000")
        self.assertEqual(config.normalizar_servidor("http://servidor-loja"), "http://servidor-loja:5077")

    def test_versao(self):
        self.assertTrue(atualizacao.mais_nova("1.0.10", "1.0.9"))
        self.assertFalse(atualizacao.mais_nova("1.0.0", "1.0.0"))
        self.assertFalse(atualizacao.mais_nova("0.9", "1.0.0"))

    def test_senha_local(self):
        h, sal = senhas.gerar("segredo")
        self.assertTrue(senhas.confere("segredo", h, sal))
        self.assertFalse(senhas.confere("outra", h, sal))

    def test_texto_80mm(self):
        o = {**os_exemplo(), "cliente": {"nome": "Mariana Álves", "documento": "123.456.789-09"}, "solucao": "Troca do SSD",
             "itens": ler_itens(os_exemplo()["itens"]), "tecnico": {"nome": "RAFAEL"}}
        t = impressao.texto_80mm(o, {"nome": "Loja Exemplo"}, "fechamento", provisorio="C-PC-0001")
        self.assertIn("O.S C-PC-0001 - FECHAMENTO", t)
        self.assertIn("R$ 360,00", t)
        self.assertTrue(all(len(linha) <= impressao.LARGURA_80 for linha in t.splitlines()))
        bruto = impressao.escpos(t)
        self.assertTrue(bruto.startswith(b"\x1b@\x1bt\x02"))
        self.assertIn("Álves".encode("cp850"), bruto)


if __name__ == "__main__":
    unittest.main()
